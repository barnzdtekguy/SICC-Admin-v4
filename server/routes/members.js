'use strict';
const express = require('express');
const crypto = require('crypto');
const { query, queryOn, int } = require('../db');
const { config } = require('../config');
const { asyncRoute, HttpError, sendData, str, oneOf, validDate, todayStr, normalizePhone, phoneLast10, pick } = require('../http');
const { secured, requirePerm } = require('../middleware');
const { can, PRIVILEGED, canViewChurchDirectory } = require('../permissions');
const { audit, auditThrottled, auditTransaction } = require('../lib/audit');
const { lockDirectory, insertMember } = require('../lib/church-members');
const lists = require('../data/lists.json');
const { notify } = require('../lib/notify');

const router = express.Router();
const MEMBER_FIELDS = ['first_name', 'last_name', 'phone', 'address', 'date_of_birth', 'kdf_area', 'kdf_coordinator', 'department', 'affinity_group', 'status', 'spiritual_status', 'notes', 'date_registered'];
const HIDE_NOTES = ['department_leader', 'kdf_coordinator'];

function scopeFor(profile) {
  if (can(profile.role, 'members.read.all')) return null;
  if (profile.role === 'pastor') return { sql: 'registered_by = ?', value: profile.id };
  if (profile.role === 'department_leader') return { sql: 'department = ?', value: profile.department || null };
  if (profile.role === 'kdf_coordinator') return { sql: 'kdf_area = ?', value: profile.kdf_area || null };
  throw new HttpError(403, 'You do not have permission to view member records.');
}
function shape(profile, row) {
  const { register_import_key: _importKey, ...member } = row;
  if (can(profile.role, 'red.manage')) return member;
  const { red_soul_id: _soul, red_team_id: _team, red_winner_id: _winner, ...record } = member;
  return HIDE_NOTES.includes(profile.role) ? { ...record, notes: undefined } : record;
}

function requireChurchDirectory(req, _res, next) {
  if (!canViewChurchDirectory(req.profile)) return next(new HttpError(403, 'You do not have permission to view the church directory.'));
  next();
}

async function validateMember(body, { partial = false } = {}) {
  const out = {};
  const has = key => body[key] !== undefined;
  if (!partial || has('first_name')) out.first_name = str(body.first_name, { max: 120, required: true, field: 'First name' });
  if (!partial || has('last_name')) out.last_name = str(body.last_name, { max: 120, required: true, field: 'Last name' });
  if (has('title')) out.title = str(body.title, { max: 80 });
  if (has('email')) {
    out.email = str(body.email, { max: 254 });
    if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(out.email)) throw new HttpError(400, 'Enter a valid email address.');
  }
  if (has('phone')) {
    out.phone = str(body.phone, { max: 40 });
    if (out.phone) { const n = normalizePhone(out.phone).length; if (n < 7 || n > 15) throw new HttpError(400, 'Enter a valid phone number.'); }
    out.phone_last10 = phoneLast10(out.phone);
  }
  if (has('address')) out.address = str(body.address, { max: 500 });
  if (has('kdf_coordinator')) out.kdf_coordinator = str(body.kdf_coordinator, { max: 160 });
  if (has('notes')) out.notes = str(body.notes, { max: 5000 });
  if (has('date_of_birth')) {
    const dob = body.date_of_birth || null;
    if (dob && (!validDate(dob) || dob > todayStr() || dob < '1900-01-01')) throw new HttpError(400, 'Enter a valid date of birth.');
    out.date_of_birth = dob;
  }
  if (has('date_registered') && body.date_registered) {
    if (!validDate(body.date_registered) || body.date_registered > todayStr()) throw new HttpError(400, 'Enter a valid registration date.');
    out.date_registered = body.date_registered;
  }
  if (has('department') && body.department) {
    if (!(await query('SELECT 1 FROM departments WHERE name = ? LIMIT 1', [body.department])).length) throw new HttpError(400, 'Choose a valid department.');
  }
  if (has('department')) out.department = str(body.department, { max: 180 });
  if (has('kdf_area') && body.kdf_area) {
    if (!(await query('SELECT 1 FROM kdf_areas WHERE name = ? LIMIT 1', [body.kdf_area])).length) throw new HttpError(400, 'Choose a valid KDF area.');
  }
  if (has('kdf_area')) out.kdf_area = str(body.kdf_area, { max: 180 });
  if (has('affinity_group') && body.affinity_group) out.affinity_group = oneOf(body.affinity_group, lists.affinityGroups, 'Affinity group');
  else if (has('affinity_group')) out.affinity_group = null;
  if (has('status')) out.status = oneOf(body.status, lists.memberStatuses, 'Status');
  if (has('spiritual_status')) out.spiritual_status = oneOf(body.spiritual_status, lists.spiritualStatuses, 'Spiritual status');
  Object.keys(out).forEach(k => out[k] === undefined && delete out[k]);
  return out;
}

async function loadMember(req, { allowDeleted = false } = {}) {
  const rows = await query(`SELECT * FROM members WHERE id = ? ${allowDeleted ? '' : 'AND deleted_at IS NULL'} LIMIT 1`, [req.params.id]);
  const member = rows[0];
  if (!member) throw new HttpError(404, 'Member not found.');
  const scope = scopeFor(req.profile);
  if (scope) {
    const field = scope.sql.split(' ')[0];
    if (String(member[field] || '') !== String(scope.value)) throw new HttpError(404, 'Member not found.');
  }
  return member;
}

router.get('/church-members', ...secured, requireChurchDirectory, asyncRoute(async (req, res) => {
  const search = String(req.query.q || '').trim().slice(0, 120);
  const like = `%${search.replace(/[\\%_]/g, char => `\\${char}`)}%`;
  const page = int(req.query.page, { min: 1, max: 100000, fallback: 1 });
  const pageSize = 50;
  const where = search ? "deleted_at IS NULL AND CONCAT_WS(' ', first_name, NULLIF(last_name, '')) LIKE ?" : 'deleted_at IS NULL';
  const values = search ? [like] : [];
  const rows = await query(`SELECT id, CONCAT_WS(' ', first_name, NULLIF(last_name, '')) AS name FROM members
    WHERE ${where} ORDER BY first_name, last_name, id LIMIT ${pageSize + 1} OFFSET ${(page - 1) * pageSize}`, values);
  await auditThrottled(req, `church-members:${req.profile.id}`, 600000, { action: 'members.list', entity_type: 'member', detail: 'Opened church directory' });
  sendData(res, { items: rows.slice(0, pageSize), hasMore: rows.length > pageSize });
}));

router.get('/church-members/:id', ...secured, requireChurchDirectory, asyncRoute(async (req, res) => {
  const [member] = await query(`SELECT id, title, first_name, last_name, phone, email, date_of_birth, status, spiritual_status,
    address, department, affinity_group, kdf_area, kdf_coordinator, notes FROM members WHERE id = ? AND deleted_at IS NULL`, [req.params.id]);
  if (!member) throw new HttpError(404, 'Member not found.');
  await auditThrottled(req, `member-view:${req.profile.id}:${member.id}`, 600000, { action: 'member.view', entity_type: 'member', entity_id: member.id });
  sendData(res, member);
}));

router.get('/members', ...secured, requirePerm('members.read'), asyncRoute(async (req, res) => {
  const where = ['deleted_at IS NULL'];
  const values = [];
  const scope = scopeFor(req.profile);
  if (scope) { where.push(scope.sql); values.push(scope.value); }
  else {
    for (const [param, column] of [['registeredBy', 'registered_by'], ['kdfArea', 'kdf_area'], ['department', 'department']]) {
      if (req.query[param]) { where.push(`${column} = ?`); values.push(String(req.query[param])); }
    }
  }
  if (req.query.status) { where.push('status = ?'); values.push(String(req.query.status)); }
  if (req.query.q) {
    const like = `%${String(req.query.q).trim().slice(0, 80).replace(/[\\%_]/g, m => `\\${m}`)}%`;
    where.push("(CONCAT(first_name, ' ', last_name) LIKE ? OR phone LIKE ?)");
    values.push(like, like);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  await auditThrottled(req, `members-list:${req.profile.id}`, 10 * 60 * 1000, { action: 'members.list', entity_type: 'member', detail: 'Opened member list' });

  if (req.query.page !== undefined) {
    const pageSize = int(req.query.pageSize, { min: 1, max: 200, fallback: 25 });
    const page = int(req.query.page, { min: 1, max: 100000, fallback: 1 });
    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM members ${whereSql}`, values);
    const rows = await query(`SELECT * FROM members ${whereSql} ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, values);
    return sendData(res, { items: rows.map(r => shape(req.profile, r)), total, page, pageSize });
  }
  const rows = await query(`SELECT * FROM members ${whereSql} ORDER BY created_at DESC LIMIT 5000`, values);
  return sendData(res, rows.map(r => shape(req.profile, r)));
}));

// Lightweight cross-record search for the command palette (scoped exactly like the list).
router.get('/search', ...secured, requirePerm('member-search.read'), asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (q.length < 2) return sendData(res, { members: [] });
  const where = ['deleted_at IS NULL', "(CONCAT(first_name, ' ', last_name) LIKE ? OR phone LIKE ?)"];
  const like = `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
  const values = [like, like];
  const scope = scopeFor(req.profile);
  if (scope) { where.push(scope.sql); values.push(scope.value); }
  const rows = await query(`SELECT id, first_name, last_name, phone, kdf_area, department, status FROM members WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 8`, values);
  sendData(res, { members: rows });
}));

router.get('/members/:id', ...secured, requirePerm('members.read'), asyncRoute(async (req, res) => {
  const member = await loadMember(req);
  await auditThrottled(req, `member-view:${req.profile.id}:${member.id}`, 10 * 60 * 1000, { action: 'member.view', entity_type: 'member', entity_id: member.id, detail: `${member.first_name} ${member.last_name}` });
  sendData(res, shape(req.profile, member));
}));

router.get('/members/:id/timeline', ...secured, requirePerm('members.read'), asyncRoute(async (req, res) => {
  const member = await loadMember(req);
  const followUps = can(req.profile.role, 'followups.read')
    ? await query('SELECT id, date, method, status, notes, outcome, pastor_name, created_at FROM follow_ups WHERE member_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100', [member.id]) : [];
  const history = can(req.profile.role, 'audit.read')
    ? await query("SELECT seq, user_name, action, detail, created_at FROM activity_logs WHERE entity_type = 'member' AND entity_id = ? AND action <> 'member.view' ORDER BY seq DESC LIMIT 100", [member.id]) : [];
  const events = [
    { type: 'registered', at: member.created_at, by: member.registered_by_name, text: 'Registered' },
    ...followUps.map(f => ({ type: 'follow_up', at: f.created_at, by: f.pastor_name, text: `${f.method} · ${f.status}`, detail: f.notes || f.outcome || null })),
    ...history.map(h => ({ type: 'change', at: h.created_at, by: h.user_name, text: h.action, detail: h.detail })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  sendData(res, { member: shape(req.profile, member), events, updated_by: member.updated_by_name, updated_at: member.updated_at });
}));

router.post('/members', ...secured, requirePerm('members.write'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const data = await validateMember(body);
  if (config.consentRequired && body.consent_given !== true) {
    throw new HttpError(400, 'Confirm that this person agreed to their details being stored (consent) before registering them.');
  }
  const created = await auditTransaction(req, async conn => {
    await lockDirectory(conn);
    if (data.phone && !body.force) {
      const [dup] = await queryOn(conn, "SELECT id, first_name, last_name FROM members WHERE phone_last10 = ? AND LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?) AND deleted_at IS NULL LIMIT 1", [data.phone_last10, data.first_name, data.last_name]);
      if (dup) throw new HttpError(409, `${dup.first_name} ${dup.last_name} is already registered with this phone number.`, { code: 'duplicate', duplicate_of: dup.id });
    }
    const record = await insertMember(conn, { ...data, status: data.status || 'New Convert', spiritual_status: data.spiritual_status || 'Salvation', registered_by: req.profile.id, registered_by_name: req.profile.name, consent_given: body.consent_given === true ? 1 : 0, consent_at: body.consent_given === true ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null });
    const [member] = await queryOn(conn, 'SELECT * FROM members WHERE id = ?', [record.id]);
    return { data: member, event: { action: 'member.create', entity_type: 'member', entity_id: record.id, detail: `${member.first_name} ${member.last_name}`, after: member } };
  });
  sendData(res, shape(req.profile, created), 201);
}));

router.patch('/members/:id', ...secured, requirePerm('members.write'), asyncRoute(async (req, res) => {
  const before = await loadMember(req);
  const data = await validateMember(req.body || {}, { partial: true });
  const fields = Object.keys(data);
  if (!fields.length) throw new HttpError(400, 'Provide at least one field to change.');
  await query(`UPDATE members SET ${fields.map(f => `${f} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP, updated_by = ?, updated_by_name = ? WHERE id = ?`, [...fields.map(f => data[f]), req.profile.id, req.profile.name, before.id]);
  const after = (await query('SELECT * FROM members WHERE id = ?', [before.id]))[0];
  await audit(req, { action: 'member.update', entity_type: 'member', entity_id: before.id, detail: `${after.first_name} ${after.last_name}: ${fields.join(', ')}`, before: pick(before, fields), after: pick(after, fields) });
  sendData(res, shape(req.profile, after));
}));

router.delete('/members/:id', ...secured, requirePerm('members.delete'), asyncRoute(async (req, res) => {
  const member = await loadMember(req);
  const reason = str(req.body?.reason, { max: 300, required: true, field: 'A reason' });
  await query('UPDATE members SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?, delete_reason = ? WHERE id = ?', [req.profile.id, reason, member.id]);
  await audit(req, { action: 'member.delete', entity_type: 'member', entity_id: member.id, detail: `${member.first_name} ${member.last_name} — ${reason}`, before: member });
  sendData(res, { success: true });
}));

router.post('/members/:id/restore', ...secured, requirePerm('members.delete'), asyncRoute(async (req, res) => {
  const member = await loadMember(req, { allowDeleted: true });
  await query('UPDATE members SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL WHERE id = ?', [member.id]);
  await audit(req, { action: 'member.restore', entity_type: 'member', entity_id: member.id, detail: `${member.first_name} ${member.last_name}` });
  sendData(res, { success: true });
}));

// Right to erasure: removes personal details but keeps counts and the audit trail.
router.post('/members/:id/anonymize', ...secured, requirePerm('members.anonymize'), asyncRoute(async (req, res) => {
  const member = await loadMember(req, { allowDeleted: true });
  const reason = str(req.body?.reason, { max: 300, required: true, field: 'A reason' });
  await auditTransaction(req, async conn => {
    await queryOn(conn, "UPDATE red_souls SET full_name = 'Erased Member', address = 'Erased', phone = NULL, email = NULL WHERE church_member_id = ?", [member.id]);
    await queryOn(conn, `UPDATE members SET first_name = 'Erased', last_name = 'Member', title = NULL, phone = NULL, phone_last10 = NULL, email = NULL, address = NULL, date_of_birth = NULL, notes = NULL, kdf_coordinator = NULL,
      deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP), deleted_by = ?, delete_reason = ? WHERE id = ?`, [req.profile.id, `Erased: ${reason}`, member.id]);
    await queryOn(conn, "UPDATE follow_ups SET member_name = 'Erased Member', notes = NULL, outcome = NULL WHERE member_id = ?", [member.id]);
    return { event: { action: 'member.anonymize', entity_type: 'member', entity_id: member.id, detail: reason } };
  });
  sendData(res, { success: true });
}));

// ---------------------------------------------------------------- follow-ups
const FOLLOW_UP_FIELDS = ['member_id', 'member_name', 'date', 'method', 'notes', 'outcome', 'status'];

function followUpScope(req) {
  if (req.profile.role === 'pastor') return { sql: 'pastor_id = ?', value: req.profile.id };
  if (req.profile.role === 'kdf_coordinator') return { sql: 'kdf_area = ?', value: req.profile.kdf_area || '' };
  return null;
}

router.get('/follow-ups', ...secured, requirePerm('followups.read'), asyncRoute(async (req, res) => {
  const where = ['deleted_at IS NULL']; const values = [];
  const scope = followUpScope(req);
  if (scope) { where.push(scope.sql); values.push(scope.value); }
  else {
    if (req.query.pastorId) { where.push('pastor_id = ?'); values.push(String(req.query.pastorId)); }
    if (req.query.kdfArea) { where.push('kdf_area = ?'); values.push(String(req.query.kdfArea)); }
  }
  if (req.query.status) { where.push('status = ?'); values.push(String(req.query.status)); }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  if (req.query.page !== undefined) {
    const pageSize = int(req.query.pageSize, { min: 1, max: 200, fallback: 25 });
    const page = int(req.query.page, { min: 1, max: 100000, fallback: 1 });
    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM follow_ups ${whereSql}`, values);
    const rows = await query(`SELECT * FROM follow_ups ${whereSql} ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, values);
    return sendData(res, { items: rows, total, page, pageSize });
  }
  return sendData(res, await query(`SELECT * FROM follow_ups ${whereSql} ORDER BY created_at DESC LIMIT 5000`, values));
}));

async function validateFollowUp(body, partial) {
  const out = {};
  if (!partial || body.member_name !== undefined) out.member_name = str(body.member_name, { max: 240, required: !partial, field: 'Member name' });
  if (body.member_id !== undefined) out.member_id = body.member_id || null;
  if (body.date !== undefined) { if (body.date && !validDate(body.date)) throw new HttpError(400, 'Enter a valid follow-up date.'); out.date = body.date || todayStr(); }
  if (body.method !== undefined) out.method = oneOf(body.method, lists.followupMethods, 'Method');
  if (body.status !== undefined) out.status = oneOf(body.status, lists.followupStatuses, 'Status');
  if (body.notes !== undefined) out.notes = str(body.notes, { max: 5000 });
  if (body.outcome !== undefined) out.outcome = str(body.outcome, { max: 5000 });
  Object.keys(out).forEach(k => out[k] === undefined && delete out[k]);
  return out;
}

router.post('/follow-ups', ...secured, requirePerm('followups.write'), asyncRoute(async (req, res) => {
  const data = await validateFollowUp(req.body || {}, false);
  const id = crypto.randomUUID();
  const record = { id, ...data, pastor_id: req.profile.id, pastor_name: req.profile.name, kdf_area: req.profile.role === 'kdf_coordinator' ? req.profile.kdf_area : (str(req.body?.kdf_area, { max: 180 }) || null) };
  const fields = Object.keys(record);
  await query(`INSERT INTO follow_ups (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`, fields.map(f => record[f]));
  if (data.member_id) await query('UPDATE members SET follow_up_count = follow_up_count + 1 WHERE id = ?', [data.member_id]);
  const created = (await query('SELECT * FROM follow_ups WHERE id = ?', [id]))[0];
  await audit(req, { action: 'followup.create', entity_type: 'follow_up', entity_id: id, detail: `Follow-up on ${created.member_name}`, after: created });
  sendData(res, created, 201);
}));

router.patch('/follow-ups/:id', ...secured, requirePerm('followups.write'), asyncRoute(async (req, res) => {
  const rows = await query('SELECT * FROM follow_ups WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
  const before = rows[0];
  if (!before) throw new HttpError(404, 'Follow-up not found.');
  const owner = before.pastor_id === req.profile.id;
  const sameArea = req.profile.role === 'kdf_coordinator' && before.kdf_area === req.profile.kdf_area;
  if (!owner && !sameArea && !PRIVILEGED.includes(req.profile.role)) throw new HttpError(404, 'Follow-up not found.');
  const data = await validateFollowUp(pick(req.body || {}, ['date', 'method', 'status', 'notes', 'outcome']), true);
  const fields = Object.keys(data);
  if (!fields.length) throw new HttpError(400, 'Provide at least one field to change.');
  await query(`UPDATE follow_ups SET ${fields.map(f => `${f} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP, updated_by_name = ? WHERE id = ?`, [...fields.map(f => data[f]), req.profile.name, before.id]);
  const after = (await query('SELECT * FROM follow_ups WHERE id = ?', [before.id]))[0];
  await audit(req, { action: 'followup.update', entity_type: 'follow_up', entity_id: before.id, detail: before.member_name, before: pick(before, fields), after: pick(after, fields) });
  if (!owner && before.pastor_id) await notify([before.pastor_id], { type: 'followup', title: 'A follow-up you logged was updated', body: `${req.profile.name} updated the follow-up on ${before.member_name}.`, link: '/app/followup' });
  sendData(res, after);
}));

module.exports = router;
module.exports.MEMBER_FIELDS = MEMBER_FIELDS;
