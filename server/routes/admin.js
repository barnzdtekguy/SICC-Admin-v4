'use strict';
const express = require('express');
const crypto = require('crypto');
const { query, int } = require('../db');
const { config } = require('../config');
const { asyncRoute, HttpError, sendData, str, validDate, todayStr, addDays, normalizePhone, pick } = require('../http');
const { secured, requirePerm, exportLimiter, messageLimiter } = require('../middleware');
const { PRIVILEGED } = require('../permissions');
const { audit, verifyChain } = require('../lib/audit');
const { encrypt, decrypt, isEncrypted } = require('../lib/crypto');
const { toCsv } = require('../lib/csv');
const { sendSms, sendWhatsAppTemplate, toIntlNumber } = require('../lib/messaging');

const router = express.Router();

// ---------------------------------------------------------------- health
router.get('/health', asyncRoute(async (_req, res) => {
  await query('SELECT 1');
  res.json({ ok: true, time: new Date().toISOString() });
}));

// ---------------------------------------------------------------- reference data
router.get('/meta/departments', ...secured, asyncRoute(async (_req, res) => sendData(res, await query('SELECT id, name, color FROM departments WHERE is_active = 1 ORDER BY sort_order, name'))));
router.get('/meta/kdf-areas', ...secured, asyncRoute(async (_req, res) => sendData(res, await query('SELECT id, name FROM kdf_areas WHERE is_active = 1 ORDER BY sort_order, name'))));

// ---------------------------------------------------------------- audit
// Client-reported logging was forgeable and has been removed; the server records every action itself.
router.post('/activity-logs', ...secured, (_req, res) => res.status(200).json({ data: { ignored: true, note: 'Activity is now recorded by the server.' } }));

router.get('/activity-logs', ...secured, requirePerm('audit.read'), asyncRoute(async (req, res) => {
  const limit = int(req.query.limit, { min: 1, max: 500, fallback: 50 });
  sendData(res, await query(`SELECT id, seq, user_id, user_name, role, action, entity_type, entity_id, detail, ip, created_at FROM activity_logs ORDER BY seq DESC LIMIT ${limit}`));
}));

router.get('/audit', ...secured, requirePerm('audit.read'), asyncRoute(async (req, res) => {
  const where = []; const values = [];
  for (const [param, column] of [['action', 'action'], ['entity_type', 'entity_type'], ['entity_id', 'entity_id'], ['user_id', 'user_id']]) {
    if (req.query[param]) { where.push(`${column} = ?`); values.push(String(req.query[param])); }
  }
  if (req.query.q) { where.push('(detail LIKE ? OR user_name LIKE ? OR action LIKE ?)'); const like = `%${String(req.query.q).slice(0, 80).replace(/[\\%_]/g, m => `\\${m}`)}%`; values.push(like, like, like); }
  if (validDate(req.query.from)) { where.push('created_at >= ?'); values.push(`${req.query.from} 00:00:00`); }
  if (validDate(req.query.to)) { where.push('created_at < ?'); values.push(`${addDays(req.query.to, 1)} 00:00:00`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pageSize = int(req.query.pageSize, { min: 1, max: 200, fallback: 50 });
  const page = int(req.query.page, { min: 1, max: 100000, fallback: 1 });
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM activity_logs ${whereSql}`, values);
  const cols = req.query.include === 'changes' ? ', before_json, after_json, user_agent, request_id' : '';
  const items = await query(`SELECT id, seq, user_id, user_name, role, action, entity_type, entity_id, detail, ip, created_at${cols} FROM activity_logs ${whereSql} ORDER BY seq DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, values);
  sendData(res, { items, total, page, pageSize });
}));

router.get('/audit/verify', ...secured, requirePerm('audit.read'), asyncRoute(async (req, res) => {
  const result = await verifyChain();
  await audit(req, { action: 'audit.verify', detail: result.ok ? `Chain intact (${result.checked} entries)` : `TAMPERING DETECTED at entry ${result.firstBadSeq}: ${result.reason}` });
  sendData(res, result);
}));

// ---------------------------------------------------------------- assignments
const ASSIGNMENT_FIELDS = ['task', 'assignee', 'priority', 'due_date', 'status'];
router.get('/assignments', ...secured, requirePerm('assignments.manage'), asyncRoute(async (_req, res) => sendData(res, await query('SELECT * FROM assignments ORDER BY created_at DESC LIMIT 1000'))));
function cleanAssignment(b, partial) {
  const out = {};
  if (!partial || b.task !== undefined) out.task = str(b.task, { max: 500, required: true, field: 'Task' });
  if (!partial || b.assignee !== undefined) out.assignee = str(b.assignee, { max: 160, required: true, field: 'Assignee' });
  if (b.priority !== undefined) out.priority = str(b.priority, { max: 40 }) || 'Normal';
  if (b.status !== undefined) out.status = str(b.status, { max: 40 }) || 'Active';
  if (b.due_date !== undefined) { if (b.due_date && !validDate(b.due_date)) throw new HttpError(400, 'Enter a valid due date.'); out.due_date = b.due_date || null; }
  return out;
}
router.post('/assignments', ...secured, requirePerm('assignments.manage'), asyncRoute(async (req, res) => {
  const data = { id: crypto.randomUUID(), ...cleanAssignment(pick(req.body || {}, ASSIGNMENT_FIELDS), false), created_by: req.profile.id };
  const fields = Object.keys(data);
  await query(`INSERT INTO assignments (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`, fields.map(f => data[f]));
  await audit(req, { action: 'assignment.create', entity_type: 'assignment', entity_id: data.id, detail: `${data.task} → ${data.assignee}` });
  sendData(res, (await query('SELECT * FROM assignments WHERE id = ?', [data.id]))[0], 201);
}));
router.patch('/assignments/:id', ...secured, requirePerm('assignments.manage'), asyncRoute(async (req, res) => {
  const updates = cleanAssignment(pick(req.body || {}, ASSIGNMENT_FIELDS), true);
  const fields = Object.keys(updates);
  if (!fields.length) throw new HttpError(400, 'Provide at least one assignment field to update.');
  const r = await query(`UPDATE assignments SET ${fields.map(f => `${f} = ?`).join(', ')} WHERE id = ?`, [...fields.map(f => updates[f]), req.params.id]);
  if (!r.affectedRows) throw new HttpError(404, 'Assignment not found.');
  await audit(req, { action: 'assignment.update', entity_type: 'assignment', entity_id: req.params.id, after: updates });
  sendData(res, (await query('SELECT * FROM assignments WHERE id = ?', [req.params.id]))[0]);
}));
router.delete('/assignments/:id', ...secured, requirePerm('assignments.manage'), asyncRoute(async (req, res) => {
  const row = (await query('SELECT * FROM assignments WHERE id = ?', [req.params.id]))[0];
  if (!row) throw new HttpError(404, 'Assignment not found.');
  await query('DELETE FROM assignments WHERE id = ?', [req.params.id]);
  await audit(req, { action: 'assignment.delete', entity_type: 'assignment', entity_id: row.id, detail: row.task, before: row });
  sendData(res, { success: true });
}));

// ---------------------------------------------------------------- SMS settings (key never leaves the server)
async function smsConfig() {
  const row = (await query('SELECT * FROM sms_config WHERE id = 1 LIMIT 1'))[0];
  const key = row?.api_key ? decrypt(row.api_key) : '';
  return { apiKey: key, senderId: row?.sender_id || 'SICC' };
}
router.get('/sms-config', ...secured, requirePerm('sms.config'), asyncRoute(async (_req, res) => {
  const { apiKey, senderId } = await smsConfig();
  sendData(res, { id: 1, sender_id: senderId, configured: Boolean(apiKey), api_key_hint: apiKey ? `••••${apiKey.slice(-4)}` : '' });
}));
router.put('/sms-config', ...secured, requirePerm('sms.config'), asyncRoute(async (req, res) => {
  const senderId = String(req.body?.sender_id || 'SICC').trim();
  if (!/^[A-Za-z0-9 ]{1,11}$/.test(senderId)) throw new HttpError(400, 'Sender ID must be 1–11 letters or numbers.');
  const incoming = String(req.body?.api_key || '').trim();
  const current = await smsConfig();
  const apiKey = incoming || current.apiKey; // blank = keep the stored key
  await query('INSERT INTO sms_config (id, api_key, sender_id) VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE api_key = VALUES(api_key), sender_id = VALUES(sender_id)', [apiKey ? encrypt(apiKey) : '', senderId]);
  await audit(req, { action: 'sms.config_update', entity_type: 'sms_config', entity_id: '1', detail: incoming ? 'API key replaced' : 'Sender ID updated' });
  sendData(res, { id: 1, sender_id: senderId, configured: Boolean(apiKey), api_key_hint: apiKey ? `••••${apiKey.slice(-4)}` : '' });
}));

// ---------------------------------------------------------------- messaging
async function resolveAudience(audience = {}) {
  const where = ['deleted_at IS NULL', 'phone IS NOT NULL', "phone <> ''"]; const values = [];
  if (audience.kind === 'department' && audience.value) { where.push('department = ?'); values.push(audience.value); }
  else if (audience.kind === 'kdf_area' && audience.value) { where.push('kdf_area = ?'); values.push(audience.value); }
  else if (audience.kind === 'status' && audience.value) { where.push('status = ?'); values.push(audience.value); }
  else if (audience.kind === 'selected' && Array.isArray(audience.member_ids) && audience.member_ids.length) {
    const ids = audience.member_ids.slice(0, 1000).map(String);
    where.push(`id IN (${ids.map(() => '?').join(',')})`); values.push(...ids);
  } else if (audience.kind !== 'all') throw new HttpError(400, 'Choose who should receive this message.');
  return query(`SELECT id, first_name, last_name, phone FROM members WHERE ${where.join(' AND ')} LIMIT 1000`, values);
}

router.post('/messages/sms', ...secured, requirePerm('messages.send'), messageLimiter, asyncRoute(async (req, res) => {
  const message = str(req.body?.message, { max: 459, required: true, field: 'Message' });
  const members = await resolveAudience(req.body?.audience);
  const numbers = [...new Set(members.map(m => toIntlNumber(m.phone)).filter(Boolean))];
  if (!numbers.length) throw new HttpError(400, 'No valid phone numbers found for that audience.');
  const { apiKey, senderId } = await smsConfig();
  if (!apiKey) throw new HttpError(400, 'SMS is not configured. Add the provider API key in Settings first.');
  const result = await sendSms({ apiKey, senderId, numbers, message });
  const id = crypto.randomUUID();
  await query('INSERT INTO message_log (id, channel, audience, recipients, body_excerpt, status, provider_response, sent_by, sent_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, 'sms', JSON.stringify(req.body?.audience || {}).slice(0, 200), numbers.length, message.slice(0, 200), result.ok ? 'sent' : 'failed', String(result.detail || '').slice(0, 500), req.profile.id, req.profile.name]);
  await audit(req, { action: 'message.sms', entity_type: 'message', entity_id: id, detail: `${numbers.length} recipients — ${result.ok ? 'sent' : `FAILED: ${result.detail}`}` });
  if (!result.ok) throw new HttpError(502, `The SMS provider rejected the message: ${result.detail}`);
  sendData(res, { recipients: numbers.length });
}));

router.get('/messages/status', ...secured, requirePerm('messages.send'), asyncRoute(async (_req, res) => {
  const { apiKey } = await smsConfig();
  sendData(res, { sms: Boolean(apiKey), whatsapp: Boolean(config.whatsapp.token && config.whatsapp.phoneId) });
}));

router.get('/messages/log', ...secured, requirePerm('messages.send'), asyncRoute(async (_req, res) => sendData(res, await query('SELECT * FROM message_log ORDER BY created_at DESC LIMIT 100'))));

router.post('/messages/whatsapp', ...secured, requirePerm('messages.send'), messageLimiter, asyncRoute(async (req, res) => {
  if (!config.whatsapp.token || !config.whatsapp.phoneId) throw new HttpError(400, 'WhatsApp Business is not configured on the server.');
  const template = str(req.body?.template, { max: 100, required: true, field: 'Template name' });
  const members = await resolveAudience(req.body?.audience);
  const targets = members.map(m => ({ to: toIntlNumber(m.phone), name: m.first_name })).filter(t => t.to);
  if (!targets.length) throw new HttpError(400, 'No valid phone numbers found for that audience.');
  let sent = 0; let failed = 0;
  for (const t of targets.slice(0, 500)) {
    const r = await sendWhatsAppTemplate({ to: t.to, template, language: req.body?.language || 'en', params: [t.name, ...(req.body?.params || [])].slice(0, 5) });
    if (r.ok) sent += 1; else failed += 1;
  }
  await query('INSERT INTO message_log (id, channel, audience, recipients, body_excerpt, status, sent_by, sent_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [crypto.randomUUID(), 'whatsapp', JSON.stringify(req.body?.audience || {}).slice(0, 200), sent, `template:${template}`, failed ? 'partial' : 'sent', req.profile.id, req.profile.name]);
  await audit(req, { action: 'message.whatsapp', detail: `${sent} sent, ${failed} failed (template ${template})` });
  sendData(res, { sent, failed });
}));

// ---------------------------------------------------------------- notifications + web push
router.get('/notifications', ...secured, asyncRoute(async (req, res) => {
  const items = await query('SELECT id, type, title, body, link, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40', [req.profile.id]);
  const [{ unread }] = await query('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL', [req.profile.id]);
  sendData(res, { items, unread });
}));
router.post('/notifications/read-all', ...secured, asyncRoute(async (req, res) => { await query('UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL', [req.profile.id]); sendData(res, { success: true }); }));
router.post('/notifications/:id/read', ...secured, asyncRoute(async (req, res) => { await query('UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?', [req.params.id, req.profile.id]); sendData(res, { success: true }); }));

router.get('/push/public-key', ...secured, (_req, res) => sendData(res, { publicKey: config.vapid.publicKey || null }));
router.post('/push/subscribe', ...secured, asyncRoute(async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth || String(endpoint).length > 500 || !/^https:\/\//.test(endpoint)) throw new HttpError(400, 'Invalid push subscription.');
  await query('INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth)', [crypto.randomUUID(), req.profile.id, endpoint, String(keys.p256dh).slice(0, 255), String(keys.auth).slice(0, 255)]);
  sendData(res, { success: true });
}));
router.post('/push/unsubscribe', ...secured, asyncRoute(async (req, res) => { await query('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', [String(req.body?.endpoint || ''), req.profile.id]); sendData(res, { success: true }); }));

// ---------------------------------------------------------------- reports + exports (management only, audited)
function range(req) {
  const to = validDate(req.query.to) ? req.query.to : todayStr();
  const from = validDate(req.query.from) ? req.query.from : addDays(to, -89);
  return { from, to };
}

router.get('/reports/overview', ...secured, requirePerm('reports.org'), asyncRoute(async (req, res) => {
  const { from, to } = range(req);
  const [byService, byDept, weekly, members, followUps] = await Promise.all([
    query('SELECT service, COUNT(*) AS sessions, SUM(count) AS total, ROUND(AVG(count)) AS average FROM attendance WHERE date BETWEEN ? AND ? AND dept_key = \'\' GROUP BY service ORDER BY total DESC', [from, to]),
    query('SELECT dept_name AS department, COUNT(*) AS sessions, SUM(COALESCE(dept_count, count)) AS total FROM attendance WHERE date BETWEEN ? AND ? AND dept_key <> \'\' GROUP BY dept_name ORDER BY total DESC', [from, to]),
    query('SELECT YEARWEEK(date, 3) AS week, MIN(date) AS week_start, SUM(count) AS total FROM attendance WHERE date BETWEEN ? AND ? AND dept_key = \'\' GROUP BY YEARWEEK(date, 3) ORDER BY week', [from, to]),
    query('SELECT status, COUNT(*) AS n FROM members WHERE deleted_at IS NULL AND date_registered BETWEEN ? AND ? GROUP BY status', [from, to]),
    query('SELECT status, COUNT(*) AS n FROM follow_ups WHERE deleted_at IS NULL AND created_at >= ? AND created_at < ? GROUP BY status', [`${from} 00:00:00`, `${addDays(to, 1)} 00:00:00`]),
  ]);
  sendData(res, { from, to, byService, byDept, weekly, newMembers: members, followUps });
}));

async function sendCsv(req, res, filename, columns, rows, action, detail) {
  await audit(req, { action, detail: `${detail} (${rows.length} rows)` });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}-${todayStr()}.csv"`);
  res.send(toCsv(columns, rows));
}

router.get('/exports/members.csv', ...secured, requirePerm('exports.run'), exportLimiter, asyncRoute(async (req, res) => {
  const rows = await query('SELECT * FROM members WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 20000');
  const cols = ['first_name', 'last_name', 'phone', 'address', 'date_of_birth', 'kdf_area', 'department', 'affinity_group', 'status', 'spiritual_status', 'registered_by_name', 'date_registered'].map(key => ({ key, label: key.replace(/_/g, ' ') }));
  await sendCsv(req, res, 'members', cols, rows, 'export.members', 'Exported member list');
}));
router.get('/exports/attendance.csv', ...secured, requirePerm('exports.run'), exportLimiter, asyncRoute(async (req, res) => {
  const { from, to } = range(req);
  const rows = await query('SELECT * FROM attendance WHERE date BETWEEN ? AND ? ORDER BY date DESC', [from, to]);
  const cols = ['date', 'service', 'count', 'dept_name', 'dept_count', 'status', 'recorded_by_name', 'verified_by_name'].map(key => ({ key, label: key.replace(/_/g, ' ') }));
  await sendCsv(req, res, 'attendance', cols, rows, 'export.attendance', `Exported attendance ${from}..${to}`);
}));
router.get('/exports/audit.csv', ...secured, requirePerm('exports.run'), exportLimiter, asyncRoute(async (req, res) => {
  const rows = await query('SELECT seq, created_at, user_name, role, action, entity_type, entity_id, detail, ip FROM activity_logs ORDER BY seq DESC LIMIT 20000');
  const cols = ['seq', 'created_at', 'user_name', 'role', 'action', 'entity_type', 'entity_id', 'detail', 'ip'].map(key => ({ key, label: key.replace(/_/g, ' ') }));
  await sendCsv(req, res, 'audit-log', cols, rows, 'export.audit', 'Exported audit log');
}));

// ---------------------------------------------------------------- department / KDF reports (previously the text was discarded)
router.post('/reports/submit', ...secured, asyncRoute(async (req, res) => {
  const role = req.profile.role;
  const kind = role === 'department_leader' ? 'department' : role === 'kdf_coordinator' ? 'kdf' : null;
  if (!kind) throw new HttpError(403, 'Only department leaders and KDF coordinators submit these reports.');
  const body = str(req.body?.body, { max: 8000, required: true, field: 'The report' });
  const scope = kind === 'department' ? req.profile.department : req.profile.kdf_area;
  const id = crypto.randomUUID();
  await query('INSERT INTO submitted_reports (id, kind, scope, body, submitted_by, submitted_by_name) VALUES (?, ?, ?, ?, ?, ?)', [id, kind, scope || null, body, req.profile.id, req.profile.name]);
  await audit(req, { action: 'report.submit', entity_type: 'submitted_report', entity_id: id, detail: `${kind} report: ${scope || 'no scope'}` });
  const { notifyRoles } = require('../lib/notify');
  await notifyRoles(PRIVILEGED, { type: 'report', title: `${kind === 'kdf' ? 'KDF area' : 'Department'} report from ${req.profile.name}`, body: scope || undefined, link: '/app/insights' });
  sendData(res, { id }, 201);
}));
router.get('/reports/submitted', ...secured, requirePerm('reports.org'), asyncRoute(async (_req, res) => sendData(res, await query('SELECT * FROM submitted_reports ORDER BY created_at DESC LIMIT 100'))));

// ---------------------------------------------------------------- role-aware morning brief
router.get('/brief', ...secured, asyncRoute(async (req, res) => {
  const p = req.profile; const today = todayStr(); const out = { role: p.role, today };
  const md = today.slice(5);
  const overdueSql = "status = 'In Progress' AND deleted_at IS NULL AND created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)";
  if (PRIVILEGED.includes(p.role)) {
    const [trend, newNow, newPrev, overdue, pending, birthdays, unverified, followups] = await Promise.all([
      query("SELECT date, service, count FROM attendance WHERE dept_key = '' ORDER BY date DESC, created_at DESC LIMIT 8"),
      query('SELECT COUNT(*) AS n FROM members WHERE deleted_at IS NULL AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)'),
      query('SELECT COUNT(*) AS n FROM members WHERE deleted_at IS NULL AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 14 DAY) AND created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)'),
      query(`SELECT COUNT(*) AS n FROM follow_ups WHERE ${overdueSql}`),
      query("SELECT COUNT(*) AS n FROM correction_requests WHERE status = 'pending'"),
      query("SELECT COUNT(*) AS n FROM members WHERE deleted_at IS NULL AND date_of_birth IS NOT NULL AND DATE_FORMAT(date_of_birth, '%m-%d') = ?", [md]),
      query("SELECT COUNT(*) AS n FROM attendance WHERE status = 'recorded' AND created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 DAY)"),
      query("SELECT COUNT(*) AS n FROM follow_ups WHERE deleted_at IS NULL AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)"),
    ]);
    Object.assign(out, { attendanceTrend: trend.reverse(), newMembers7d: newNow[0].n, newMembersPrev7d: newPrev[0].n, overdueFollowUps: overdue[0].n, pendingApprovals: pending[0].n, birthdaysToday: birthdays[0].n, unverifiedAttendance: unverified[0].n, followUps7d: followups[0].n });
  } else if (p.role === 'pastor') {
    const [mine, overdue, quiet, birthdays] = await Promise.all([
      query('SELECT COUNT(*) AS n FROM members WHERE deleted_at IS NULL AND registered_by = ?', [p.id]),
      query(`SELECT id, member_name, created_at FROM follow_ups WHERE ${overdueSql} AND pastor_id = ? ORDER BY created_at LIMIT 10`, [p.id]),
      query(`SELECT m.id, m.first_name, m.last_name, m.status FROM members m WHERE m.deleted_at IS NULL AND m.registered_by = ? AND NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.member_id = m.id AND f.deleted_at IS NULL AND f.created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 14 DAY)) ORDER BY m.created_at DESC LIMIT 10`, [p.id]),
      query("SELECT id, first_name, last_name FROM members WHERE deleted_at IS NULL AND registered_by = ? AND date_of_birth IS NOT NULL AND DATE_FORMAT(date_of_birth, '%m-%d') = ? LIMIT 10", [p.id, md]),
    ]);
    Object.assign(out, { myMembers: mine[0].n, overdue, needsContact: quiet, birthdays });
  } else if (p.role === 'kdf_coordinator') {
    const [total, converts, covered, overdue] = await Promise.all([
      query('SELECT COUNT(*) AS n FROM members WHERE deleted_at IS NULL AND kdf_area = ?', [p.kdf_area || '']),
      query("SELECT COUNT(*) AS n FROM members WHERE deleted_at IS NULL AND kdf_area = ? AND status = 'New Convert'", [p.kdf_area || '']),
      query("SELECT COUNT(DISTINCT member_id) AS n FROM follow_ups WHERE deleted_at IS NULL AND kdf_area = ? AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 DAY)", [p.kdf_area || '']),
      query(`SELECT COUNT(*) AS n FROM follow_ups WHERE ${overdueSql} AND kdf_area = ?`, [p.kdf_area || '']),
    ]);
    Object.assign(out, { area: p.kdf_area, members: total[0].n, newConverts: converts[0].n, coveragePct: total[0].n ? Math.round((covered[0].n / total[0].n) * 100) : 0, overdueFollowUps: overdue[0].n });
  } else if (p.role === 'department_leader') {
    const [recent, members] = await Promise.all([
      query('SELECT date, service, count, dept_count, status FROM attendance WHERE dept_name = ? ORDER BY date DESC LIMIT 6', [p.department || '']),
      query('SELECT COUNT(*) AS n FROM members WHERE deleted_at IS NULL AND department = ?', [p.department || '']),
    ]);
    const weekStart = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
    Object.assign(out, { department: p.department, recent: recent.reverse(), members: members[0].n, recordedThisWeek: recent.some(r => r.date >= weekStart), services: (await query("SELECT service FROM (SELECT DISTINCT service FROM attendance) s")).map(r => r.service) });
  }
  sendData(res, out);
}));

module.exports = router;
module.exports.isEncrypted = isEncrypted;
module.exports.normalizePhone = normalizePhone;
