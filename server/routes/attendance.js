'use strict';
const express = require('express');
const crypto = require('crypto');
const { query, transaction, int } = require('../db');
const { config } = require('../config');
const { asyncRoute, HttpError, sendData, validDate, todayStr, addDays, str } = require('../http');
const { secured, requirePerm } = require('../middleware');
const { PRIVILEGED } = require('../permissions');
const { audit, recordRevision } = require('../lib/audit');
const { lockedByCreation, requireReason } = require('../lib/locks');
const { notifyRoles } = require('../lib/notify');
const lists = require('../data/lists.json');

const router = express.Router();

const decorate = row => ({ ...row, locked: lockedByCreation(row.created_at) || row.status === 'verified', pending_corrections: Number(row.pending_corrections || 0) });
const SELECT = `SELECT a.*, (SELECT COUNT(*) FROM correction_requests c WHERE c.entity_type = 'attendance' AND c.entity_id = a.id AND c.status = 'pending') AS pending_corrections FROM attendance a`;

async function validServices() {
  const rows = await query('SELECT name FROM attendance_programmes WHERE is_active = 1');
  return [...new Set([...lists.serviceTypes, ...rows.map(r => r.name)])];
}

function counts(body, { partial = false } = {}) {
  const out = {};
  const check = (key, label, required) => {
    if (body[key] === undefined || body[key] === null || body[key] === '') { if (required && !partial) throw new HttpError(400, `${label} is required.`); return; }
    const n = Number(body[key]);
    if (!Number.isInteger(n) || n < 0 || n > 100000) throw new HttpError(400, `${label} must be a whole number between 0 and 100,000.`);
    out[key] = n;
  };
  check('count', 'Attendance count', true);
  check('dept_count', 'Department count', false);
  return out;
}

router.get('/attendance', ...secured, requirePerm('attendance.read'), asyncRoute(async (req, res) => {
  const where = []; const values = [];
  if (req.profile.role === 'department_leader') { where.push('a.dept_name = ?'); values.push(req.profile.department || ''); }
  else if (req.query.department) { where.push('a.dept_name = ?'); values.push(String(req.query.department)); }
  if (validDate(req.query.from)) { where.push('a.date >= ?'); values.push(req.query.from); }
  if (validDate(req.query.to)) { where.push('a.date <= ?'); values.push(req.query.to); }
  const rows = await query(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.date DESC, a.created_at DESC LIMIT ${int(req.query.limit, { min: 1, max: 5000, fallback: 5000 })}`, values);
  sendData(res, rows.map(decorate));
}));

router.post('/attendance', ...secured, requirePerm('attendance.write'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const service = str(body.service, { max: 120, required: true, field: 'Service' });
  if (!(await validServices()).includes(service)) throw new HttpError(400, 'Choose a valid service or programme.');
  if (!validDate(body.date)) throw new HttpError(400, 'Enter a valid attendance date.');
  const today = todayStr();
  if (body.date > today) throw new HttpError(400, 'Attendance cannot be recorded for a future date.');
  const privileged = PRIVILEGED.includes(req.profile.role);
  let reason = null;
  if (body.date < addDays(today, -config.attendance.backdateDays)) {
    if (!privileged) throw new HttpError(403, `Attendance older than ${config.attendance.backdateDays} days can only be entered by the Bishop or an Administrator.`);
    reason = requireReason(body.reason, 'This date is outside the normal entry window');
  }
  const department = req.profile.role === 'department_leader' ? req.profile.department : (str(body.dept_name, { max: 180 }) || null);
  if (req.profile.role === 'department_leader' && !department) throw new HttpError(400, 'Your account has no department assigned. Ask an administrator to set it.');
  if (department && !(await query('SELECT 1 FROM departments WHERE name = ? LIMIT 1', [department])).length) throw new HttpError(400, 'Choose a valid department.');
  const n = counts(body);
  const key = department || '';
  const existing = await query('SELECT id FROM attendance WHERE date = ? AND service = ? AND dept_key = ? LIMIT 1', [body.date, service, key]);
  if (existing[0]) throw new HttpError(409, 'Attendance for this service, date and department is already recorded. Edit it within the lock window or request a correction.', { code: 'duplicate', existing_id: existing[0].id });
  const id = crypto.randomUUID();
  await query(
    'INSERT INTO attendance (id, date, service, count, dept_name, dept_count, dept_key, recorded_by, recorded_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, body.date, service, n.count, department, n.dept_count ?? null, key, req.profile.id, req.profile.name]);
  const row = (await query(`${SELECT} WHERE a.id = ?`, [id]))[0];
  await audit(req, { action: 'attendance.create', entity_type: 'attendance', entity_id: id, detail: `${service} ${body.date} ${department || 'church-wide'}: ${n.count}${reason ? ` (back-dated: ${reason})` : ''}`, after: row });
  sendData(res, decorate(row), 201);
}));

router.patch('/attendance/:id', ...secured, requirePerm('attendance.write'), asyncRoute(async (req, res) => {
  const before = (await query('SELECT * FROM attendance WHERE id = ?', [req.params.id]))[0];
  if (!before) throw new HttpError(404, 'Attendance record not found.');
  const privileged = PRIVILEGED.includes(req.profile.role);
  const owns = before.recorded_by === req.profile.id;
  if (!privileged && !(owns && (req.profile.role !== 'department_leader' || before.dept_name === req.profile.department))) throw new HttpError(403, 'You can only edit attendance you recorded.');
  const locked = lockedByCreation(before.created_at) || before.status === 'verified';
  let reason = null;
  if (locked) {
    if (!privileged) throw new HttpError(423, 'This record is locked. Submit a correction request for approval.', { code: 'locked' });
    reason = requireReason(req.body?.reason, 'This record is locked');
  }
  const n = counts(req.body || {}, { partial: true });
  const fields = Object.keys(n);
  if (!fields.length) throw new HttpError(400, 'Provide a new count.');
  await transaction(async conn => {
    await recordRevision(conn, { entity_type: 'attendance', entity_id: before.id, snapshot: before, reason, actor: req.profile });
    await conn.execute(`UPDATE attendance SET ${fields.map(f => `${f} = ?`).join(', ')}, status = ?, updated_at = CURRENT_TIMESTAMP, updated_by_name = ? WHERE id = ?`, [...fields.map(f => n[f]), locked ? 'corrected' : before.status, req.profile.name, before.id]);
  });
  const after = (await query(`${SELECT} WHERE a.id = ?`, [before.id]))[0];
  await audit(req, { action: 'attendance.update', entity_type: 'attendance', entity_id: before.id, detail: `${before.service} ${before.date}: ${before.count} → ${after.count}${reason ? ` (${reason})` : ''}`, before, after });
  sendData(res, decorate(after));
}));

// Four-eyes check: the person verifying cannot be the person who recorded it.
router.post('/attendance/:id/verify', ...secured, requirePerm('attendance.verify'), asyncRoute(async (req, res) => {
  const row = (await query('SELECT * FROM attendance WHERE id = ?', [req.params.id]))[0];
  if (!row) throw new HttpError(404, 'Attendance record not found.');
  if (row.recorded_by === req.profile.id) throw new HttpError(403, 'A different leader must verify attendance you recorded.');
  if (row.status === 'verified') throw new HttpError(400, 'Already verified.');
  await query("UPDATE attendance SET status = 'verified', verified_by_name = ?, verified_at = CURRENT_TIMESTAMP WHERE id = ?", [req.profile.name, row.id]);
  await audit(req, { action: 'attendance.verify', entity_type: 'attendance', entity_id: row.id, detail: `${row.service} ${row.date} ${row.dept_name || 'church-wide'}: ${row.count}` });
  sendData(res, decorate((await query(`${SELECT} WHERE a.id = ?`, [row.id]))[0]));
}));

module.exports = router;
module.exports.notifyRoles = notifyRoles;
