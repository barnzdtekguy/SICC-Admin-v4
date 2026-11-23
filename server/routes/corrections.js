'use strict';
const express = require('express');
const crypto = require('crypto');
const { query, transaction } = require('../db');
const { asyncRoute, HttpError, sendData, str } = require('../http');
const { secured, requirePerm } = require('../middleware');
const { can, PRIVILEGED } = require('../permissions');
const { audit, recordRevision } = require('../lib/audit');
const { notify, notifyRoles } = require('../lib/notify');
const { isRetiredProgramme } = require('../lib/programmes');

const router = express.Router();
const STATUSES = ['Present', 'Absent', 'Late', 'Excused'];

const ENTITIES = {
  attendance: {
    table: 'attendance', perm: 'attendance.write', fields: ['count', 'dept_count'],
    label: r => `${r.service} · ${r.date} · ${r.dept_name || 'church-wide'}`,
    clean(p) {
      const out = {};
      for (const k of ['count', 'dept_count']) if (p[k] !== undefined && p[k] !== null && p[k] !== '') {
        const n = Number(p[k]);
        if (!Number.isInteger(n) || n < 0 || n > 100000) throw new HttpError(400, `${k} must be a whole number between 0 and 100,000.`);
        out[k] = n;
      }
      return out;
    },
    afterApply: { status: 'corrected' },
  },
  programme_record: {
    table: 'programme_attendance_records', perm: 'training.mark', fields: ['status'],
    label: r => `${r.programme_name} · ${r.attendance_date} · ${r.attendee_name}`,
    clean(p) { if (!STATUSES.includes(p.status)) throw new HttpError(400, `status must be one of: ${STATUSES.join(', ')}.`); return { status: p.status }; },
  },
};

const shape = r => ({ ...r, proposed: JSON.parse(r.proposed_json || '{}'), current: JSON.parse(r.current_json || '{}'), proposed_json: undefined, current_json: undefined });

router.get('/corrections', ...secured, requirePerm('corrections.read'), asyncRoute(async (req, res) => {
  const where = []; const values = [];
  if (!can(req.profile.role, 'corrections.decide')) { where.push('requested_by = ?'); values.push(req.profile.id); }
  if (req.query.status) { where.push('status = ?'); values.push(String(req.query.status)); }
  const rows = await query(`SELECT * FROM correction_requests ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY (status = 'pending') DESC, created_at DESC LIMIT 300`, values);
  sendData(res, rows.map(shape));
}));

router.post('/corrections', ...secured, requirePerm('corrections.request'), asyncRoute(async (req, res) => {
  const { entity_type: type, entity_id: entityId } = req.body || {};
  const def = ENTITIES[type];
  if (!def) throw new HttpError(400, 'Unknown record type.');
  if (!can(req.profile.role, def.perm)) throw new HttpError(403, 'You cannot request corrections for this kind of record.');
  const reason = str(req.body?.reason, { max: 600, required: true, field: 'A reason' });
  if (reason.length < 10) throw new HttpError(400, 'Explain the correction in at least 10 characters.');
  const row = (await query(`SELECT * FROM ${def.table} WHERE id = ?`, [String(entityId || '')]))[0];
  if (!row) throw new HttpError(404, 'Record not found.');
  if (type === 'programme_record' && isRetiredProgramme(row.programme_id, row.programme_type)) throw new HttpError(410, 'This programme has been retired.');
  if (type === 'attendance' && req.profile.role === 'department_leader' && row.dept_name !== req.profile.department) throw new HttpError(403, 'You can only request corrections for your own department.');
  const proposed = def.clean(req.body?.proposed || {});
  if (!Object.keys(proposed).length) throw new HttpError(400, 'Provide the corrected value.');
  const dup = await query("SELECT id FROM correction_requests WHERE entity_type = ? AND entity_id = ? AND status = 'pending' LIMIT 1", [type, row.id]);
  if (dup[0]) throw new HttpError(409, 'There is already a pending correction for this record.');
  const id = crypto.randomUUID();
  const current = Object.fromEntries(def.fields.map(f => [f, row[f]]));
  await query('INSERT INTO correction_requests (id, entity_type, entity_id, entity_label, proposed_json, current_json, reason, requested_by, requested_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, type, row.id, def.label(row).slice(0, 300), JSON.stringify(proposed), JSON.stringify(current), reason, req.profile.id, req.profile.name]);
  await audit(req, { action: 'correction.request', entity_type: type, entity_id: row.id, detail: `${def.label(row)} — ${reason}`, before: current, after: proposed });
  await notifyRoles(PRIVILEGED, { type: 'approval', title: 'Correction awaiting approval', body: `${req.profile.name}: ${def.label(row)}`, link: '/app/approvals' }, req.profile.id);
  sendData(res, shape((await query('SELECT * FROM correction_requests WHERE id = ?', [id]))[0]), 201);
}));

async function decide(req, res, approve) {
  const request = (await query('SELECT * FROM correction_requests WHERE id = ?', [req.params.id]))[0];
  if (!request) throw new HttpError(404, 'Request not found.');
  if (request.status !== 'pending') throw new HttpError(409, `This request was already ${request.status}.`);
  if (request.requested_by === req.profile.id) throw new HttpError(403, 'You cannot decide your own request. Another leader must approve it.');
  const note = str(req.body?.note, { max: 600, required: !approve, field: 'A note explaining the rejection' });
  const def = ENTITIES[request.entity_type];
  if (!def) throw new HttpError(410, 'This record type is no longer available.');
  if (approve) {
    const proposed = def.clean(JSON.parse(request.proposed_json));
    await transaction(async conn => {
      const [rows] = await conn.execute(`SELECT * FROM ${def.table} WHERE id = ? FOR UPDATE`, [request.entity_id]);
      if (!rows[0]) throw new HttpError(404, 'The record no longer exists.');
      if (request.entity_type === 'programme_record' && isRetiredProgramme(rows[0].programme_id, rows[0].programme_type)) throw new HttpError(410, 'This programme has been retired.');
      await recordRevision(conn, { entity_type: request.entity_type, entity_id: request.entity_id, snapshot: rows[0], reason: `Correction approved: ${request.reason}`, actor: req.profile });
      const fields = Object.keys(proposed);
      const extra = def.afterApply ? Object.keys(def.afterApply) : [];
      await conn.execute(`UPDATE ${def.table} SET ${[...fields, ...extra].map(f => `${f} = ?`).join(', ')} WHERE id = ?`, [...fields.map(f => proposed[f]), ...extra.map(f => def.afterApply[f]), request.entity_id]);
    });
  }
  await query('UPDATE correction_requests SET status = ?, decided_by = ?, decided_by_name = ?, decided_at = CURRENT_TIMESTAMP, decision_note = ? WHERE id = ?', [approve ? 'approved' : 'rejected', req.profile.id, req.profile.name, note, request.id]);
  await audit(req, { action: approve ? 'correction.approve' : 'correction.reject', entity_type: request.entity_type, entity_id: request.entity_id, detail: `${request.entity_label}${note ? ` — ${note}` : ''}`, before: JSON.parse(request.current_json || '{}'), after: JSON.parse(request.proposed_json) });
  await notify([request.requested_by], { type: 'approval', title: `Your correction was ${approve ? 'approved' : 'rejected'}`, body: `${request.entity_label}${note ? ` — ${note}` : ''}`, link: '/app/approvals' });
  sendData(res, shape((await query('SELECT * FROM correction_requests WHERE id = ?', [request.id]))[0]));
}

router.post('/corrections/:id/approve', ...secured, requirePerm('corrections.decide'), asyncRoute((req, res) => decide(req, res, true)));
router.post('/corrections/:id/reject', ...secured, requirePerm('corrections.decide'), asyncRoute((req, res) => decide(req, res, false)));

module.exports = router;
module.exports.ENTITIES = ENTITIES;
