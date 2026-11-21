'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const h = require('./helpers');
const { query } = require('../db');
const { verifyChain, audit } = require('../lib/audit');
const { checkinToken } = require('../lib/crypto');
const { migrations } = require('../migrate');
const { RETIRED_PROGRAMME_ID, RETIRED_PROGRAMME_TYPE } = require('../lib/programmes');

after(() => h.close());
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

test('audit log is hash-chained, server-written, and detects tampering', async () => {
  const bishop = await h.loginAgent(await h.makeUser('bishop'));
  const forged = await h.api(bishop, 'post', '/activity-logs', { action: 'I did something good', detail: 'forged' });
  assert.equal(forged.body.data.ignored, true);
  assert.equal((await query("SELECT COUNT(*) n FROM activity_logs WHERE detail = 'forged'"))[0].n, 0);
  await audit(null, { action: 'test.event', detail: 'chain-check', actor: { id: null, name: 'tester', role: null } });
  assert.equal((await verifyChain()).ok, true);
  // 1) the database itself refuses edits (trigger), 2) if someone bypasses that, the chain exposes it.
  await assert.rejects(query("UPDATE activity_logs SET detail = 'tampered' WHERE action = 'test.event' LIMIT 1"), /append-only/);
  await assert.rejects(query("DELETE FROM activity_logs WHERE action = 'test.event' LIMIT 1"), /append-only/);
  const { rawQuery } = require('../db');
  await rawQuery('DROP TRIGGER activity_logs_no_update');
  try {
    await query("UPDATE activity_logs SET detail = 'tampered' WHERE action = 'test.event' ORDER BY seq DESC LIMIT 1");
    const broken = await verifyChain();
    assert.equal(broken.ok, false); assert.match(broken.reason, /modified/);
    await query("UPDATE activity_logs SET detail = 'chain-check' WHERE action = 'test.event' AND detail = 'tampered'");
    assert.equal((await verifyChain()).ok, true);
  } finally {
    await rawQuery("CREATE TRIGGER activity_logs_no_update BEFORE UPDATE ON activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit log rows are append-only'");
  }
});

test('sensitive values are redacted from audit entries', async () => {
  const admin = await h.loginAgent(await h.makeUser('admin'));
  const email = `r.${h.uniq()}@test.local`;
  const made = await h.api(admin, 'post', '/profiles', { name: 'Redact Test', email, role: 'pastor', password: 'Cobalt!Meadow-9981' });
  assert.equal(made.status, 201);
  const row = (await query("SELECT after_json, detail FROM activity_logs WHERE action = 'user.create' AND entity_id = ?", [made.body.data.id]))[0];
  assert.ok(!/Cobalt|\$2[aby]\$/.test(row.after_json));
});

test('attendance: duplicates blocked, future/back-dated entries refused, department forced from session', async () => {
  await h.resetAttendance();
  const leader = await h.loginAgent(await h.makeUser('department_leader', { department: 'Media' }));
  const body = { service: 'Sunday Service', date: today(), count: 42, dept_name: 'Security', recorded_by: 'someone-else' };
  const first = await h.api(leader, 'post', '/attendance', body);
  assert.equal(first.status, 201);
  assert.equal(first.body.data.dept_name, 'Media', 'department comes from the account, not the body');
  assert.notEqual(first.body.data.recorded_by, 'someone-else');
  assert.equal((await h.api(leader, 'post', '/attendance', body)).status, 409);
  assert.equal((await h.api(leader, 'post', '/attendance', { ...body, date: daysAgo(-3) })).status, 400);
  assert.equal((await h.api(leader, 'post', '/attendance', { ...body, date: daysAgo(30) })).status, 403);
  assert.equal((await h.api(leader, 'post', '/attendance', { ...body, count: -4, date: daysAgo(1) })).status, 400);
  assert.equal((await h.api(leader, 'post', '/attendance', { ...body, service: 'Made Up Service', date: daysAgo(1) })).status, 400);
});

test('locked attendance needs a four-eyes correction: request → different leader approves → revision kept', async () => {
  await h.resetAttendance();
  const leaderUser = await h.makeUser('department_leader', { department: 'Prayer' });
  const leader = await h.loginAgent(leaderUser);
  const created = await h.api(leader, 'post', '/attendance', { service: 'Mid-Week Service', date: daysAgo(1), count: 80 });
  assert.equal(created.status, 201);
  const id = created.body.data.id;
  assert.equal((await h.api(leader, 'patch', `/attendance/${id}`, { count: 85 })).status, 200, 'editable inside the lock window');
  await query('UPDATE attendance SET created_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 5 DAY) WHERE id = ?', [id]);
  const locked = await h.api(leader, 'patch', `/attendance/${id}`, { count: 120 });
  assert.equal(locked.status, 423);
  assert.equal((await h.api(leader, 'post', '/corrections', { entity_type: 'attendance', entity_id: id, proposed: { count: 120 }, reason: 'short' })).status, 400);
  const req = await h.api(leader, 'post', '/corrections', { entity_type: 'attendance', entity_id: id, proposed: { count: 120 }, reason: 'Ushers recounted after service' });
  assert.equal(req.status, 201);
  assert.equal((await h.api(leader, 'post', `/corrections/${req.body.data.id}/approve`, {})).status, 403, 'requester cannot approve');
  const admin = await h.loginAgent(await h.makeUser('admin'));
  assert.equal((await h.api(admin, 'post', `/corrections/${req.body.data.id}/reject`, {})).status, 400, 'rejection needs a note');
  const ok = await h.api(admin, 'post', `/corrections/${req.body.data.id}/approve`, {});
  assert.equal(ok.status, 200); assert.equal(ok.body.data.status, 'approved');
  assert.equal((await query('SELECT count, status FROM attendance WHERE id = ?', [id]))[0].count, 120);
  assert.equal((await query("SELECT COUNT(*) n FROM record_revisions WHERE entity_type = 'attendance' AND entity_id = ?", [id]))[0].n >= 2, true);
  assert.equal((await h.api(admin, 'post', `/corrections/${req.body.data.id}/approve`, {})).status, 409, 'cannot be decided twice');
  const notifs = await h.api(leader, 'get', '/notifications');
  assert.ok(notifs.body.data.items.some(n => /approved/.test(n.title)));
});

test('attendance verification cannot be done by the person who recorded it', async () => {
  await h.resetAttendance();
  const adminUser = await h.makeUser('admin'); const admin = await h.loginAgent(adminUser);
  const rec = await h.api(admin, 'post', '/attendance', { service: 'Prayer Night', date: today(), count: 30 });
  assert.equal(rec.status, 201);
  assert.equal((await h.api(admin, 'post', `/attendance/${rec.body.data.id}/verify`, {})).status, 403);
  const bishop = await h.loginAgent(await h.makeUser('bishop'));
  const v = await h.api(bishop, 'post', `/attendance/${rec.body.data.id}/verify`, {});
  assert.equal(v.status, 200); assert.equal(v.body.data.status, 'verified'); assert.equal(v.body.data.locked, true);
});

test('programme attendance: marked_by is taken from the session, never the request', async () => {
  const pastor = await h.loginAgent(await h.makeUser('pastor', { name: 'Pst Real Name' }));
  const record = { programme_id: 'sunday-service', attendance_date: today(), attendee_name: `Trainee ${h.uniq()}`, status: 'Present', marked_by: 'The Bishop' };
  const mark = await h.api(pastor, 'post', '/programme-attendance-records', record);
  assert.equal(mark.status, 201);
  assert.equal(mark.body.data.marked_by, 'Pst Real Name');
  assert.equal((await h.api(pastor, 'post', '/programme-attendance-records', { ...record, status: 'Hacked' })).status, 400);
  assert.equal((await h.api(pastor, 'post', '/programme-attendance-records', { ...record, programme_id: 'nope' })).status, 404);
});

test('the upgrade retires 32-day programmes and preserves their attendance history', async () => {
  const app = await h.setup();
  const pastor = await h.loginAgent(await h.makeUser('pastor'));
  const programmeId = `retired-${h.uniq()}`;
  const recordId = randomUUID();
  const correctionId = randomUUID();
  await query('INSERT INTO attendance_programmes (id, name, programme_type) VALUES (?, ?, ?)', [programmeId, 'Old Training', RETIRED_PROGRAMME_TYPE]);
  await query('INSERT INTO programme_attendance_records (id, programme_id, programme_name, programme_type, attendance_date, attendee_name) VALUES (?, ?, ?, ?, ?, ?)',
    [recordId, programmeId, 'Old Training', RETIRED_PROGRAMME_TYPE, today(), 'Former Attendee']);
  await query("INSERT INTO correction_requests (id, entity_type, entity_id, proposed_json, reason) VALUES (?, 'programme_record', ?, '{}', 'Historical correction')", [correctionId, recordId]);
  const retirement = migrations.find(m => m.id === '010_retire_32_day_programme');
  await retirement.up();
  await retirement.up();

  assert.equal((await query('SELECT is_active FROM attendance_programmes WHERE id = ?', [programmeId]))[0].is_active, 0);
  assert.equal((await query('SELECT attendee_name FROM programme_attendance_records WHERE id = ?', [recordId]))[0].attendee_name, 'Former Attendee');
  assert.equal((await query('SELECT status FROM correction_requests WHERE id = ?', [correctionId]))[0].status, 'cancelled');

  const programmes = (await h.request(app).get('/api/programmes?public=1')).body.data;
  assert.ok(programmes.some(p => p.id === 'sunday-service'));
  assert.ok(programmes.every(p => p.id !== RETIRED_PROGRAMME_ID && p.programme_type !== RETIRED_PROGRAMME_TYPE));
  assert.equal((await h.api(pastor, 'get', '/greatness/attendance')).status, 404);
  assert.equal((await h.api(pastor, 'get', `/checkin/session?programme_id=${programmeId}`)).status, 410);
  assert.equal((await h.api(pastor, 'patch', `/programmes/${programmeId}`, { is_active: true })).status, 410);
  assert.equal((await h.api(pastor, 'post', '/programmes', { id: RETIRED_PROGRAMME_ID, name: 'Old Training' })).status, 400);
  assert.deepEqual((await h.api(pastor, 'get', `/programme-attendance-records?programmeId=${programmeId}`)).body.data, []);
  assert.equal((await h.api(pastor, 'post', '/corrections', { entity_type: 'programme_record', entity_id: recordId, proposed: { status: 'Absent' }, reason: 'Historical correction' })).status, 410);
  assert.equal((await h.request(app).post('/api/public/attendance/check-in').set('X-SICC-Client', 'web').send({
    programme_id: programmeId, attendance_date: today(), attendee_name: 'Former Attendee', phone: '08011112222', date_of_birth: '1990-05-17',
  })).status, 410);
});

test('QR check-in: rotating token, per-phone lockout, device cap, geofence and no double check-in', async () => {
  const app = await h.setup();
  const staff = await h.loginAgent(await h.makeUser('pastor'));
  const pid = `svc-${h.uniq()}`;
  assert.equal((await h.api(staff, 'post', '/programmes', { id: pid, name: 'Test Service', programme_type: 'service' })).status, 201);
  // Three registered people
  const people = [];
  for (let i = 0; i < 3; i += 1) {
    const last = `Check${h.uniq()}`; const phone = `0801${String(Math.floor(Math.random() * 9000000) + 1000000)}`;
    const m = await h.api(staff, 'post', '/members', { first_name: 'Cee', last_name: last, phone, date_of_birth: '1990-05-17', consent_given: true });
    assert.equal(m.status, 201); people.push({ name: `Cee ${last}`, phone });
  }
  const session = await h.api(staff, 'get', `/checkin/session?programme_id=${pid}`);
  assert.equal(session.status, 200);
  const pub = (agent, p, extra = {}) => agent.post('/api/public/attendance/check-in').set('X-SICC-Client', 'web').send({ programme_id: pid, attendance_date: today(), attendee_name: p.name, phone: p.phone, date_of_birth: '1990-05-17', token: session.body.data.token, ...extra });
  const list = await h.request(app).get('/api/programmes?public=1');
  const pubProg = list.body.data.find(p => p.id === pid);
  assert.equal(pubProg.geo_required, false); assert.equal(pubProg.geo_lat, undefined);

  const phone1 = h.request.agent(app);
  assert.equal((await pub(phone1, people[0], { token: 'bad.token' })).status, 403, 'bad token');
  assert.equal((await pub(phone1, people[0], { token: checkinToken(pid, 60, Date.now() - 5 * 60000) })).status, 403, 'expired token');
  assert.equal((await pub(phone1, people[0], { date_of_birth: '1991-01-01' })).status, 403, 'wrong DOB');
  assert.equal((await pub(phone1, people[0])).status, 201);
  assert.equal((await pub(phone1, people[0])).status, 409, 'no double check-in');
  assert.equal((await pub(phone1, people[1])).status, 201);
  const third = await pub(phone1, people[2]);
  assert.equal(third.status, 429); assert.equal(third.body.code, 'device_limit');
  assert.equal((await pub(h.request.agent(app), people[2])).status, 201, 'a different device is fine');

  // Brute-forcing DOBs for one phone number gets blocked
  const victim = people[0]; let blockedAt = 0;
  for (let i = 1; i <= 8; i += 1) { const r = await pub(h.request.agent(app), { ...victim, phone: '08099990000' }, { date_of_birth: `1980-01-${String(i).padStart(2, '0')}` }); if (r.status === 429 && !blockedAt) blockedAt = i; }
  assert.ok(blockedAt > 0 && blockedAt <= 7, `expected a lockout, got ${blockedAt}`);

  // Geofence: venue in Lekki; a check-in from Abuja is refused, from the venue accepted
  assert.equal((await h.api(staff, 'patch', `/programmes/${pid}`, { geo_lat: 6.4474, geo_lng: 3.4723, geo_radius_m: 300 })).status, 200);
  const extra = { phone: `0802${String(Math.floor(Math.random() * 9000000) + 1000000)}` };
  const m = await h.api(staff, 'post', '/members', { first_name: 'Geo', last_name: `Fence${h.uniq()}`, phone: extra.phone, date_of_birth: '1990-05-17', consent_given: true });
  const gp = { name: `Geo ${m.body.data.last_name}`, phone: extra.phone };
  assert.equal((await pub(h.request.agent(app), gp)).body.code, 'geo_required');
  assert.equal((await pub(h.request.agent(app), gp, { lat: 9.0765, lng: 7.3986, accuracy: 20 })).body.code, 'geo_outside');
  assert.equal((await pub(h.request.agent(app), gp, { lat: 6.4476, lng: 3.4725, accuracy: 20 })).status, 201);
});

test('exports are management-only, formula-safe and audited', async () => {
  const pastor = await h.loginAgent(await h.makeUser('pastor'));
  assert.equal((await h.api(pastor, 'get', '/exports/members.csv')).status, 403);
  const staff = await h.loginAgent(await h.makeUser('pastor'));
  await h.api(staff, 'post', '/members', { first_name: '=HYPERLINK("http://x")', last_name: 'Csv', phone: '08011119999', consent_given: true });
  const admin = await h.loginAgent(await h.makeUser('admin'));
  const csv = await h.api(admin, 'get', '/exports/members.csv');
  assert.equal(csv.status, 200); assert.match(csv.headers['content-disposition'], /attachment/);
  assert.ok(!csv.text.includes('\n=HYPERLINK') && csv.text.includes("'=HYPERLINK"));
  assert.ok((await query("SELECT COUNT(*) n FROM activity_logs WHERE action = 'export.members'"))[0].n >= 1);
});
