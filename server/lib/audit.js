'use strict';
// Server-side, append-only, hash-chained audit trail. Every row's hash covers the previous
// row's hash, so editing or deleting any historic row breaks the chain and is detected.
const crypto = require('crypto');
const { pool, query, int } = require('../db');

const GENESIS = '0'.repeat(64);
const SECRET_KEYS = /(password|hash|secret|token|api_key|recovery|mfa_|(?:^|_)pin(?:_|$)|^confirmPin$|^proof$|^challenge$)/i;
const THROTTLE = new Map();

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '[redacted]' : redact(v)]));
  }
  return value;
}
const toJson = (value, max = 20000) => {
  if (value === undefined || value === null) return null;
  const text = JSON.stringify(redact(value));
  return text.length > max ? `${text.slice(0, max)}…[truncated]` : text;
};

const sqlTime = date => date.toISOString().slice(0, 19).replace('T', ' ');
const isoFromSql = s => `${String(s).replace(' ', 'T')}.000Z`;

function digest(prevHash, row, isoTime) {
  const payload = JSON.stringify([row.id, row.user_id, row.user_name, row.role, row.action, row.entity_type, row.entity_id, row.detail, row.before_json, row.after_json, row.ip, isoTime]);
  return crypto.createHash('sha256').update(`${prevHash}|${payload}`).digest('hex');
}

function actorFrom(req, actor) {
  if (actor) return actor;
  const p = req?.profile;
  return p ? { id: p.id, name: p.name, role: p.role } : { id: null, name: 'system', role: null };
}

async function appendAudit(conn, req, { action, entity_type = null, entity_id = null, detail = null, before, after, actor }) {
  const who = actorFrom(req, actor);
  const created = new Date(); created.setMilliseconds(0);
  const row = {
    id: crypto.randomUUID(),
    user_id: who.id || null,
    user_name: who.name || null,
    role: who.role || null,
    action: String(action).slice(0, 120),
    entity_type: entity_type ? String(entity_type).slice(0, 60) : null,
    entity_id: entity_id ? String(entity_id).slice(0, 120) : null,
    detail: detail ? String(detail).slice(0, 4000) : null,
    before_json: toJson(before),
    after_json: toJson(after),
    ip: req?.ip ? String(req.ip).slice(0, 64) : null,
  };
  const [last] = await conn.query('SELECT hash FROM activity_logs WHERE hash IS NOT NULL ORDER BY seq DESC LIMIT 1 FOR UPDATE');
  const prev = last[0]?.hash || GENESIS;
  const hash = digest(prev, row, created.toISOString());
  await conn.execute(
    `INSERT INTO activity_logs (id, user_id, user_name, role, action, entity_type, entity_id, detail, before_json, after_json, ip, user_agent, request_id, prev_hash, hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.user_id, row.user_name, row.role, row.action, row.entity_type, row.entity_id, row.detail, row.before_json, row.after_json, row.ip,
      req?.get ? String(req.get('user-agent') || '').slice(0, 255) : null, req?.id ? String(req.id).slice(0, 40) : null, prev, hash, sqlTime(created)],
  );
  return row.id;
}

async function withAuditLock(conn, work) {
  const [[lock]] = await conn.query("SELECT GET_LOCK('sicc_audit_chain', 15) AS got");
  if (lock.got !== 1) throw new Error('Audit log is busy; the action was not recorded.');
  try { return await work(); }
  finally { await conn.query("SELECT RELEASE_LOCK('sicc_audit_chain')").catch(() => {}); }
}

async function audit(req, event = {}) {
  const conn = await pool.getConnection();
  try { return await withAuditLock(conn, () => appendAudit(conn, req, event)); }
  finally { conn.release(); }
}

async function auditTransaction(req, work) {
  const conn = await pool.getConnection();
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await conn.beginTransaction();
        const { data, event } = await work(conn);
        if (!event) {
          await conn.commit();
          return data;
        }
        return await withAuditLock(conn, async () => {
          await appendAudit(conn, req, event);
          await conn.commit();
          return data;
        });
      } catch (error) {
        await conn.rollback();
        if (error.code !== 'ER_LOCK_DEADLOCK' || attempt >= 2) throw error;
      }
    }
  } finally { conn.release(); }
}

// For high-volume read events (viewing lists / records): at most one entry per key per window.
async function auditThrottled(req, key, windowMs, entry) {
  const now = Date.now();
  if (now - (THROTTLE.get(key) || 0) < windowMs) return null;
  THROTTLE.set(key, now);
  if (THROTTLE.size > 5000) for (const [k, t] of THROTTLE) if (now - t > windowMs) THROTTLE.delete(k);
  return audit(req, entry);
}

async function verifyChain() {
  let lastSeq = 0; let prev = null; let checked = 0;
  for (;;) {
    const rows = await query(
      `SELECT seq, id, user_id, user_name, role, action, entity_type, entity_id, detail, before_json, after_json, ip, prev_hash, hash, created_at
       FROM activity_logs WHERE hash IS NOT NULL AND seq > ? ORDER BY seq ASC LIMIT ${int(1000, { max: 1000 })}`, [lastSeq]);
    if (!rows.length) break;
    for (const r of rows) {
      if (prev !== null && r.prev_hash !== prev) return { ok: false, checked, firstBadSeq: r.seq, reason: 'A row is missing or out of order (chain link broken).' };
      const expected = digest(r.prev_hash, r, isoFromSql(r.created_at));
      if (expected !== r.hash) return { ok: false, checked, firstBadSeq: r.seq, reason: 'A row was modified after it was written.' };
      prev = r.hash; lastSeq = r.seq; checked += 1;
    }
  }
  return { ok: true, checked, firstBadSeq: null, reason: null };
}

async function recordRevision(conn, { entity_type, entity_id, snapshot, reason, actor }) {
  const sql = 'INSERT INTO record_revisions (id, entity_type, entity_id, revision_json, reason, changed_by, changed_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)';
  const values = [crypto.randomUUID(), entity_type, String(entity_id), JSON.stringify(snapshot), reason ? String(reason).slice(0, 400) : null, actor?.id || null, actor?.name || null];
  if (conn) await conn.execute(sql, values); else await query(sql, values);
}

module.exports = { audit, auditTransaction, auditThrottled, verifyChain, recordRevision, redact, digest, GENESIS };
