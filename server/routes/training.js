'use strict';
const express = require('express');
const crypto = require('crypto');
const { query, transaction } = require('../db');
const { config } = require('../config');
const { asyncRoute, HttpError, sendData, str, oneOf, validDate, todayStr, normalizePhone, phoneLast10 } = require('../http');
const { authenticate, enforceRestrictions, secured, requirePerm, publicCheckInLimiter } = require('../middleware');
const { PRIVILEGED } = require('../permissions');
const { audit, recordRevision } = require('../lib/audit');
const { lockedByDate, lockedByCreation, requireReason } = require('../lib/locks');
const { checkinToken, verifyCheckinToken, hmac, safeEqual, randomToken } = require('../lib/crypto');

const router = express.Router();
const STATUSES = ['Present', 'Absent', 'Late', 'Excused'];
const GREATNESS_ID = 'greatness-32-days';
const identityKey = (phone, name) => normalizePhone(phone) ? phoneLast10(phone) : `n:${String(name || '').trim().toLowerCase()}`;
const isPrivileged = p => PRIVILEGED.includes(p.role);

// ------------------------------------------------------------------ programmes
const PUBLIC_FIELDS = r => ({
  id: r.id, name: r.name, programme_type: r.programme_type, start_date: r.start_date, end_date: r.end_date, total_days: r.total_days, is_active: r.is_active,
  geo_required: r.geo_lat !== null && r.geo_lng !== null, require_token: Boolean(r.require_token),
});

router.get('/programmes', asyncRoute(async (req, res, next) => {
  const rows = await query('SELECT * FROM attendance_programmes WHERE is_active = 1 ORDER BY created_at DESC');
  if (req.query.public === '1') return sendData(res, rows.map(PUBLIC_FIELDS));
  return authenticate(req, res, error => (error ? next(error) : enforceRestrictions(req, res, err2 => (err2 ? next(err2) : sendData(res, rows)))));
}));

router.post('/programmes', ...secured, requirePerm('programmes.manage'), asyncRoute(async (req, res) => {
  const b = req.body || {};
  const id = str(b.id, { max: 120, required: true, field: 'Programme id' });
  if (!/^[a-z0-9][a-z0-9-]{2,119}$/.test(id)) throw new HttpError(400, 'Programme id may only contain lowercase letters, numbers and dashes.');
  const name = str(b.name, { max: 180, required: true, field: 'Programme name' });
  for (const k of ['start_date', 'end_date']) if (b[k] && !validDate(b[k])) throw new HttpError(400, `${k} must be a valid date.`);
  if (b.start_date && b.end_date && b.end_date < b.start_date) throw new HttpError(400, 'The end date must be on or after the start date.');
  const totalDays = b.total_days ? Number(b.total_days) : null;
  if (totalDays !== null && (!Number.isInteger(totalDays) || totalDays < 1 || totalDays > 366)) throw new HttpError(400, 'Total days must be between 1 and 366.');
  await query('INSERT INTO attendance_programmes (id, name, programme_type, start_date, end_date, total_days, is_active, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
    [id, name, str(b.programme_type, { max: 60 }) || 'custom', b.start_date || null, b.end_date || null, totalDays, req.profile.id, req.profile.name]);
  const row = (await query('SELECT * FROM attendance_programmes WHERE id = ?', [id]))[0];
  await audit(req, { action: 'programme.create', entity_type: 'programme', entity_id: id, detail: name, after: row });
  sendData(res, row, 201);
}));

router.patch('/programmes/:id', ...secured, requirePerm('programmes.manage'), asyncRoute(async (req, res) => {
  const before = (await query('SELECT * FROM attendance_programmes WHERE id = ?', [req.params.id]))[0];
  if (!before) throw new HttpError(404, 'Programme not found.');
  const b = req.body || {}; const set = {};
  if (b.name !== undefined) set.name = str(b.name, { max: 180, required: true, field: 'Name' });
  if (b.is_active !== undefined) set.is_active = b.is_active ? 1 : 0;
  if (b.require_token !== undefined) set.require_token = b.require_token ? 1 : 0;
  if (b.geo_lat !== undefined || b.geo_lng !== undefined || b.geo_radius_m !== undefined) {
    if (b.geo_lat === null || b.geo_lng === null) Object.assign(set, { geo_lat: null, geo_lng: null, geo_radius_m: null });
    else {
      const lat = Number(b.geo_lat); const lng = Number(b.geo_lng); const radius = Number(b.geo_radius_m || 300);
      if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) throw new HttpError(400, 'Enter a valid venue location.');
      if (!Number.isInteger(radius) || radius < 50 || radius > 5000) throw new HttpError(400, 'Radius must be between 50 and 5,000 metres.');
      Object.assign(set, { geo_lat: lat.toFixed(6), geo_lng: lng.toFixed(6), geo_radius_m: radius });
    }
  }
  const fields = Object.keys(set);
  if (!fields.length) throw new HttpError(400, 'Nothing to change.');
  await query(`UPDATE attendance_programmes SET ${fields.map(f => `${f} = ?`).join(', ')} WHERE id = ?`, [...fields.map(f => set[f]), before.id]);
  const after = (await query('SELECT * FROM attendance_programmes WHERE id = ?', [before.id]))[0];
  await audit(req, { action: 'programme.update', entity_type: 'programme', entity_id: before.id, detail: before.name, before, after });
  sendData(res, after);
}));

// Live rotating token the projector screen embeds in the QR code.
router.get('/checkin/session', ...secured, requirePerm('checkin.control'), asyncRoute(async (req, res) => {
  const programme = (await query('SELECT * FROM attendance_programmes WHERE id = ? AND is_active = 1', [String(req.query.programme_id || '')]))[0];
  if (!programme) throw new HttpError(404, 'Programme not found.');
  const rotate = config.checkin.rotateSeconds;
  const nextRotation = rotate - (Math.floor(Date.now() / 1000) % rotate);
  sendData(res, { token: checkinToken(programme.id, rotate), rotate_seconds: rotate, refresh_in: nextRotation, valid_for: nextRotation + rotate, require_token: Boolean(programme.require_token), geo_required: programme.geo_lat !== null });
}));

// ------------------------------------------------------------------ Leadership Training (32 days)
router.get('/greatness/attendees', ...secured, requirePerm('training.mark'), asyncRoute(async (_req, res) => {
  sendData(res, await query('SELECT * FROM greatness_attendees ORDER BY name'));
}));

router.post('/greatness/attendees', ...secured, requirePerm('training.mark'), asyncRoute(async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, { max: 240, required: true, field: 'Name' });
  const phone = str(b.phone, { max: 40 });
  if (phone && (normalizePhone(phone).length < 7 || normalizePhone(phone).length > 15)) throw new HttpError(400, 'Enter a valid phone number.');
  const id = crypto.randomUUID();
  await query('INSERT INTO greatness_attendees (id, name, phone, phone_normalized, phone_last10, email, department) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, name, phone, normalizePhone(phone) || null, phoneLast10(phone), str(b.email, { max: 254 }), str(b.department, { max: 180 })]);
  const row = (await query('SELECT * FROM greatness_attendees WHERE id = ?', [id]))[0];
  await audit(req, { action: 'training.attendee_add', entity_type: 'greatness_attendee', entity_id: id, detail: name });
  sendData(res, row, 201);
}));

router.get('/greatness/attendance', ...secured, requirePerm('training.mark'), asyncRoute(async (req, res) => {
  const rows = req.query.day ? await query('SELECT * FROM greatness_attendance WHERE day_number = ?', [Number(req.query.day) || 0]) : await query('SELECT * FROM greatness_attendance');
  sendData(res, rows);
}));

router.post('/greatness/attendance', ...secured, requirePerm('training.mark'), asyncRoute(async (req, res) => {
  const b = req.body || {};
  const day = Number(b.day_number);
  if (!Number.isInteger(day) || day < 1 || day > 32) throw new HttpError(400, 'Attendance day must be between 1 and 32.');
  const status = oneOf(b.status, STATUSES, 'Status');
  if (!status) throw new HttpError(400, 'Status is required.');
  const attendee = (await query('SELECT id, name FROM greatness_attendees WHERE id = ?', [String(b.attendee_id || '')]))[0];
  if (!attendee) throw new HttpError(404, 'Attendee not found.');
  const result = await transaction(async conn => {
    const [rows] = await conn.execute('SELECT * FROM greatness_attendance WHERE attendee_id = ? AND day_number = ? FOR UPDATE', [attendee.id, day]);
    const existing = rows[0];
    if (!existing) {
      const id = crypto.randomUUID();
      await conn.execute('INSERT INTO greatness_attendance (id, attendee_id, day_number, status, marked_by, marked_by_id) VALUES (?, ?, ?, ?, ?, ?)', [id, attendee.id, day, status, req.profile.name, req.profile.id]);
      return { id, created: true, status };
    }
    if (existing.status === status) return { id: existing.id, unchanged: true, status };
    const [prog] = await conn.execute('SELECT start_date FROM attendance_programmes WHERE id = ?', [GREATNESS_ID]);
    let locked;
    if (prog[0]?.start_date) { const d = new Date(`${String(prog[0].start_date).slice(0, 10)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + day - 1); locked = lockedByDate(d.toISOString().slice(0, 10)); }
    else locked = lockedByCreation(existing.marked_at);
    let reason = null;
    if (locked) {
      if (!isPrivileged(req.profile)) throw new HttpError(423, 'This day is locked. Submit a correction request for approval.', { code: 'locked', record_id: existing.id });
      reason = requireReason(b.reason, 'This day is locked');
    }
    await recordRevision(conn, { entity_type: 'greatness_attendance', entity_id: existing.id, snapshot: existing, reason, actor: req.profile });
    await conn.execute('UPDATE greatness_attendance SET status = ?, marked_by = ?, marked_by_id = ? WHERE id = ?', [status, req.profile.name, req.profile.id, existing.id]);
    return { id: existing.id, before: existing.status, status, reason };
  });
  if (!result.unchanged) await audit(req, { action: result.created ? 'training.mark' : 'training.remark', entity_type: 'greatness_attendance', entity_id: result.id, detail: `${attendee.name} day ${day}: ${result.before ? `${result.before} → ` : ''}${status}${result.reason ? ` (${result.reason})` : ''}` });
  sendData(res, (await query('SELECT * FROM greatness_attendance WHERE id = ?', [result.id]))[0]);
}));

// ------------------------------------------------------------------ programme attendance records
router.get('/programme-attendance-records', ...secured, requirePerm('training.mark'), asyncRoute(async (req, res) => {
  const where = []; const values = [];
  if (req.query.programmeId) { where.push('programme_id = ?'); values.push(String(req.query.programmeId)); }
  if (validDate(req.query.date)) { where.push('attendance_date = ?'); values.push(req.query.date); }
  sendData(res, await query(`SELECT * FROM programme_attendance_records${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT 5000`, values));
}));

async function loadProgramme(id, conn) {
  const run = conn ? (s, v) => conn.execute(s, v).then(r => r[0]) : query;
  const programme = (await run('SELECT * FROM attendance_programmes WHERE id = ? AND is_active = 1 LIMIT 1', [id]))[0];
  if (!programme) throw new HttpError(404, 'This attendance programme is not available.');
  return programme;
}

router.post('/programme-attendance-records', ...secured, requirePerm('training.mark'), asyncRoute(async (req, res) => {
  const b = req.body || {};
  const name = str(b.attendee_name, { max: 240, required: true, field: 'Attendee name' });
  if (!validDate(b.attendance_date)) throw new HttpError(400, 'Enter a valid attendance date.');
  if (b.attendance_date > todayStr()) throw new HttpError(400, 'Attendance cannot be recorded for a future date.');
  const status = oneOf(b.status || 'Present', STATUSES, 'Status');
  const phone = str(b.phone, { max: 40 });
  if (b.date_of_birth && !validDate(b.date_of_birth)) throw new HttpError(400, 'Enter a valid date of birth.');
  const key = identityKey(phone, name);
  const out = await transaction(async conn => {
    const programme = await loadProgramme(String(b.programme_id || ''), conn);
    const [rows] = await conn.execute('SELECT * FROM programme_attendance_records WHERE programme_id = ? AND attendance_date = ? AND identity_key = ? FOR UPDATE', [programme.id, b.attendance_date, key]);
    const existing = rows[0];
    const locked = lockedByDate(b.attendance_date);
    if (existing) {
      if (existing.status === status) return { row: existing, unchanged: true };
      let reason = null;
      if (locked) {
        if (!isPrivileged(req.profile)) throw new HttpError(423, 'This date is locked. Submit a correction request for approval.', { code: 'locked', record_id: existing.id });
        reason = requireReason(b.reason, 'This date is locked');
      }
      await recordRevision(conn, { entity_type: 'programme_record', entity_id: existing.id, snapshot: existing, reason, actor: req.profile });
      await conn.execute('UPDATE programme_attendance_records SET status = ?, marked_by = ?, updated_by_name = ? WHERE id = ?', [status, req.profile.name, req.profile.name, existing.id]);
      return { id: existing.id, before: existing.status, reason };
    }
    if (locked) {
      if (!isPrivileged(req.profile)) throw new HttpError(403, 'This date is locked. Only the Bishop or an Administrator can add late entries.', { code: 'locked' });
      requireReason(b.reason, 'This date is locked');
    }
    const id = crypto.randomUUID();
    await conn.execute(
      `INSERT INTO programme_attendance_records (id, programme_id, programme_name, programme_type, attendance_date, day_number, attendee_source, attendee_source_id, attendee_name, phone, phone_normalized, phone_last10,
        salem_family, date_of_birth, email, department, church_position, status, marked_by, source, identity_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`,
      [id, programme.id, programme.name, programme.programme_type, b.attendance_date, Number.isInteger(Number(b.day_number)) ? Number(b.day_number) : null, str(b.attendee_source, { max: 60 }), str(b.attendee_source_id, { max: 120 }), name, phone,
        normalizePhone(phone) || null, phoneLast10(phone), str(b.salem_family, { max: 180 }), b.date_of_birth || null, str(b.email, { max: 254 }), str(b.department, { max: 180 }), str(b.church_position, { max: 100 }) || 'Member', status, req.profile.name, key]);
    return { id, created: true };
  });
  if (!out.unchanged) await audit(req, { action: out.created ? 'training.record_mark' : 'training.record_remark', entity_type: 'programme_record', entity_id: out.id, detail: `${name} · ${b.attendance_date}${out.before ? `: ${out.before} → ${status}` : ''}${out.reason ? ` (${out.reason})` : ''}` });
  sendData(res, (await query('SELECT * FROM programme_attendance_records WHERE id = ?', [out.id || out.row.id]))[0], out.created ? 201 : 200);
}));

// ------------------------------------------------------------------ public self check-in
const failedLookups = new Map(); // last10 -> { n, since }
function lookupBlocked(last10) {
  const e = failedLookups.get(last10);
  if (!e) return false;
  if (Date.now() - e.since > 15 * 60000) { failedLookups.delete(last10); return false; }
  return e.n >= 5;
}
function noteFailedLookup(last10) {
  const e = failedLookups.get(last10);
  if (!e || Date.now() - e.since > 15 * 60000) failedLookups.set(last10, { n: 1, since: Date.now() });
  else e.n += 1;
  if (failedLookups.size > 5000) failedLookups.clear();
}

function deviceId(req, res) {
  const raw = req.cookies?.sicc_dev;
  if (typeof raw === 'string' && raw.includes('.')) {
    const [id, sig] = raw.split('.');
    if (id && sig && safeEqual(sig, hmac('device', id).slice(0, 22))) return id;
  }
  const id = randomToken(18);
  res.cookie('sicc_dev', `${id}.${hmac('device', id).slice(0, 22)}`, { httpOnly: true, secure: config.isProd, sameSite: 'lax', maxAge: 365 * 86400 * 1000, path: '/' });
  return id;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const rad = x => (x * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

async function findPerson(name, phone, dob) {
  const last10 = phoneLast10(phone);
  const digits = normalizePhone(phone);
  const [members, attendees, records] = await Promise.all([
    query("SELECT id, first_name, last_name, phone, department, status, date_of_birth FROM members WHERE phone_last10 = ? AND deleted_at IS NULL LIMIT 50", [last10]),
    query('SELECT id, name, phone, department, email FROM greatness_attendees WHERE phone_last10 = ? LIMIT 50', [last10]),
    query('SELECT id, attendee_name, phone, department, church_position, salem_family, date_of_birth, email FROM programme_attendance_records WHERE phone_last10 = ? ORDER BY created_at DESC LIMIT 50', [last10]),
  ]);
  const people = [
    ...members.map(m => ({ source: 'members', id: m.id, name: `${m.first_name} ${m.last_name}`.trim(), phone: m.phone, department: m.department, church_position: m.status === 'Worker' ? 'Member' : m.status || 'Member', date_of_birth: m.date_of_birth })),
    ...attendees.map(a => ({ source: 'greatness_attendees', id: a.id, name: a.name, phone: a.phone, department: a.department, church_position: 'Member', email: a.email })),
    ...records.map(r => ({ source: 'programme_attendance_records', id: r.id, name: r.attendee_name, phone: r.phone, department: r.department, church_position: r.church_position, salem_family: r.salem_family, date_of_birth: r.date_of_birth, email: r.email })),
  ];
  return people.find(p => normalizePhone(p.phone) === digits && p.name.trim().toLowerCase() === name.trim().toLowerCase() && p.date_of_birth && String(p.date_of_birth).slice(0, 10) === dob) || null;
}

router.post('/public/attendance/check-in', publicCheckInLimiter, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const name = str(b.attendee_name, { max: 240, required: true, field: 'Full name' });
  if (!validDate(b.attendance_date) || !validDate(b.date_of_birth)) throw new HttpError(400, 'Enter valid attendance and date-of-birth dates.');
  const today = todayStr();
  if (b.attendance_date !== today) throw new HttpError(400, 'Check-in is only available for today.');
  const digits = normalizePhone(b.phone);
  if (digits.length < 11) throw new HttpError(400, 'Enter a valid phone number.');
  const last10 = phoneLast10(digits);
  if (lookupBlocked(last10)) throw new HttpError(429, 'Too many unsuccessful attempts for this phone number. Please see a church usher.');

  const programme = await loadProgramme(String(b.programme_id || ''));
  if ((programme.start_date && today < String(programme.start_date).slice(0, 10)) || (programme.end_date && today > String(programme.end_date).slice(0, 10))) throw new HttpError(400, 'This programme is not scheduled for today.');
  if (programme.require_token && !verifyCheckinToken(programme.id, b.token, config.checkin.rotateSeconds)) {
    throw new HttpError(403, 'This check-in link has expired. Scan the code on the screen again.', { code: 'token_expired' });
  }
  let geoVerified = 0;
  if (programme.geo_lat !== null && programme.geo_lng !== null) {
    const lat = Number(b.lat); const lng = Number(b.lng); const accuracy = Math.min(Number(b.accuracy) || 0, 100);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new HttpError(403, 'Location is required for this programme. Allow location access and try again.', { code: 'geo_required' });
    const distance = haversineMeters(lat, lng, Number(programme.geo_lat), Number(programme.geo_lng));
    if (distance > Number(programme.geo_radius_m || 300) + accuracy) throw new HttpError(403, 'You appear to be away from the venue. Check-in is only available at the venue.', { code: 'geo_outside' });
    geoVerified = 1;
  }
  const device = deviceId(req, res);
  const [{ n: byDevice }] = await query('SELECT COUNT(*) AS n FROM programme_attendance_records WHERE programme_id = ? AND attendance_date = ? AND device_id = ?', [programme.id, today, device]);
  if (byDevice >= config.checkin.maxPerDevice) throw new HttpError(429, 'This phone has already been used to check in the maximum number of people for today.', { code: 'device_limit' });

  const person = await findPerson(name, b.phone, b.date_of_birth);
  if (!person) {
    noteFailedLookup(last10);
    throw new HttpError(403, 'We could not verify your details. Ask church staff to confirm your name, phone number and date of birth are recorded correctly.');
  }
  let dayNumber = null;
  if (programme.programme_type === '32_days') {
    if (!programme.start_date) throw new HttpError(400, 'The programme start date has not been configured.');
    dayNumber = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${String(programme.start_date).slice(0, 10)}T00:00:00Z`)) / 86400000) + 1;
    if (dayNumber < 1 || dayNumber > 32) throw new HttpError(400, 'Today is outside this programme.');
  }
  const key = identityKey(person.phone, person.name);
  const record = await transaction(async conn => {
    await conn.execute('SELECT id FROM attendance_programmes WHERE id = ? FOR UPDATE', [programme.id]);
    const [dup] = await conn.execute('SELECT id FROM programme_attendance_records WHERE programme_id = ? AND attendance_date = ? AND identity_key = ? LIMIT 1', [programme.id, today, key]);
    if (dup.length) throw new HttpError(409, 'Your attendance has already been recorded for today.');
    const id = crypto.randomUUID();
    await conn.execute(
      `INSERT INTO programme_attendance_records (id, programme_id, programme_name, programme_type, attendance_date, day_number, attendee_source, attendee_source_id, attendee_name, phone, phone_normalized, phone_last10,
        salem_family, date_of_birth, email, department, church_position, status, marked_by, source, identity_key, device_id, ip, geo_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Present', 'QR Self Check-in', 'qr', ?, ?, ?, ?)`,
      [id, programme.id, programme.name, programme.programme_type, today, dayNumber, person.source, person.id, person.name, person.phone, normalizePhone(person.phone), last10, person.salem_family || null,
        person.date_of_birth || null, person.email || null, person.department || null, person.church_position || 'Member', key, device, String(req.ip || '').slice(0, 64), geoVerified]);
    if (programme.programme_type === '32_days' && dayNumber) {
      const [found] = await conn.execute('SELECT id FROM greatness_attendees WHERE phone_last10 = ? LIMIT 1 FOR UPDATE', [last10]);
      let attendeeId = found[0]?.id;
      if (!attendeeId) {
        attendeeId = crypto.randomUUID();
        await conn.execute('INSERT INTO greatness_attendees (id, name, phone, phone_normalized, phone_last10, email, department) VALUES (?, ?, ?, ?, ?, ?, ?)', [attendeeId, person.name, person.phone, normalizePhone(person.phone), last10, person.email || null, person.department || null]);
      }
      await conn.execute("INSERT IGNORE INTO greatness_attendance (id, attendee_id, day_number, status, marked_by) VALUES (?, ?, ?, 'Present', 'QR Self Check-in')", [crypto.randomUUID(), attendeeId, dayNumber]);
    }
    return id;
  });
  await audit(req, { action: 'checkin.self', entity_type: 'programme_record', entity_id: record, detail: `${person.name} · ${programme.name} · ${today}${geoVerified ? ' · location verified' : ''}`, actor: { id: null, name: `${person.name} (self check-in)`, role: 'public' } });
  sendData(res, { id: record, programme_name: programme.name, attendance_date: today, attendee_name: person.name }, 201);
}));

module.exports = router;
