'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

after(() => h.close());

test('only management can list staff; others get the minimal directory', async () => {
  const pastor = await h.loginAgent(await h.makeUser('pastor'));
  const kdf = await h.loginAgent(await h.makeUser('kdf_coordinator', { kdf_area: 'Oniru' }));
  assert.equal((await h.api(pastor, 'get', '/profiles')).status, 403);
  assert.equal((await h.api(kdf, 'get', '/profiles')).status, 403);
  const dir = await h.api(pastor, 'get', '/directory');
  assert.equal(dir.status, 200);
  assert.ok(dir.body.data.length > 0);
  assert.equal(dir.body.data[0].email, undefined); assert.equal(dir.body.data[0].phone, undefined);
});

test('profile responses never include password hashes or MFA secrets', async () => {
  const admin = await h.loginAgent(await h.makeUser('admin'));
  const res = await h.api(admin, 'get', '/profiles');
  const text = JSON.stringify(res.body);
  assert.ok(!/password_hash|mfa_secret|mfa_recovery|\$2[aby]\$/.test(text));
});

test('an Administrator cannot create or promote Bishop/Admin accounts; the Bishop can', async () => {
  const admin = await h.loginAgent(await h.makeUser('admin'));
  const bishop = await h.loginAgent(await h.makeUser('bishop'));
  const body = role => ({ name: 'New Person', email: `n.${h.uniq()}@test.local`, role, password: 'Marble!Orchard-5512' });
  assert.equal((await h.api(admin, 'post', '/profiles', body('bishop'))).status, 403);
  assert.equal((await h.api(admin, 'post', '/profiles', body('admin'))).status, 403);
  assert.equal((await h.api(admin, 'post', '/profiles', body('pastor'))).status, 201);
  const made = await h.api(bishop, 'post', '/profiles', body('admin'));
  assert.equal(made.status, 201); assert.equal(made.body.data.must_change_password, true);
  assert.equal((await h.api(admin, 'delete', `/profiles/${made.body.data.id}`)).status, 403);
  assert.equal((await h.api(admin, 'patch', `/profiles/${made.body.data.id}`, { role: 'pastor' })).status, 403);
});

test('weak passwords are rejected when creating accounts', async () => {
  const admin = await h.loginAgent(await h.makeUser('admin'));
  const res = await h.api(admin, 'post', '/profiles', { name: 'Weak User', email: `w.${h.uniq()}@test.local`, role: 'pastor', password: 'church123' });
  assert.equal(res.status, 400);
});

test('scoped roles only see their own slice of members', async () => {
  const pastorA = await h.makeUser('pastor'); const pastorB = await h.makeUser('pastor');
  const a = await h.loginAgent(pastorA); const b = await h.loginAgent(pastorB);
  const mk = await h.api(a, 'post', '/members', { first_name: 'Ada', last_name: `Scope${h.uniq()}`, phone: '08012345678', consent_given: true });
  assert.equal(mk.status, 201);
  assert.equal(mk.body.data.registered_by, pastorA.id, 'registered_by comes from the session, not the body');
  const id = mk.body.data.id;
  assert.equal((await h.api(a, 'get', `/members/${id}`)).status, 200);
  assert.equal((await h.api(b, 'get', `/members/${id}`)).status, 404);
  assert.equal((await h.api(b, 'patch', `/members/${id}`, { notes: 'x' })).status, 404);
  const list = await h.api(b, 'get', '/members');
  assert.ok(!list.body.data.some(m => m.id === id));
});

test('department leaders cannot read pastoral notes', async () => {
  const dept = 'Media';
  const pastor = await h.loginAgent(await h.makeUser('pastor'));
  const leader = await h.loginAgent(await h.makeUser('department_leader', { department: dept }));
  const mk = await h.api(pastor, 'post', '/members', { first_name: 'Note', last_name: `Test${h.uniq()}`, phone: '08098765432', department: dept, notes: 'Private pastoral matter', consent_given: true });
  const res = await h.api(leader, 'get', '/members');
  const row = res.body.data.find(m => m.id === mk.body.data.id);
  assert.ok(row); assert.equal(row.notes, undefined);
});

test('members need recorded consent; duplicates are caught; soft delete needs a reason; only the Bishop can erase', async () => {
  const pastor = await h.loginAgent(await h.makeUser('pastor'));
  const admin = await h.loginAgent(await h.makeUser('admin')); const bishop = await h.loginAgent(await h.makeUser('bishop'));
  const last = `Dup${h.uniq()}`; const body = { first_name: 'Dee', last_name: last, phone: '08055550000' };
  assert.equal((await h.api(pastor, 'post', '/members', body)).status, 400);
  const ok = await h.api(pastor, 'post', '/members', { ...body, consent_given: true });
  assert.equal(ok.status, 201);
  const dup = await h.api(pastor, 'post', '/members', { ...body, consent_given: true });
  assert.equal(dup.status, 409); assert.equal(dup.body.code, 'duplicate');
  assert.equal((await h.api(admin, 'delete', `/members/${ok.body.data.id}`, {})).status, 400);
  assert.equal((await h.api(admin, 'delete', `/members/${ok.body.data.id}`, { reason: 'Registered by mistake' })).status, 200);
  assert.equal((await h.api(admin, 'post', `/members/${ok.body.data.id}/anonymize`, { reason: 'x'.repeat(10) })).status, 403);
  assert.equal((await h.api(bishop, 'post', `/members/${ok.body.data.id}/anonymize`, { reason: 'Requested erasure' })).status, 200);
});

test('SMS key is never returned to the browser and is stored encrypted', async () => {
  const { query } = require('../db');
  const admin = await h.loginAgent(await h.makeUser('admin'));
  const put = await h.api(admin, 'put', '/sms-config', { api_key: 'SUPERSECRETKEY1234', sender_id: 'SICC' });
  assert.equal(put.status, 200);
  assert.ok(!JSON.stringify(put.body).includes('SUPERSECRET'));
  const get = await h.api(admin, 'get', '/sms-config');
  assert.equal(get.body.data.api_key_hint, '••••1234'); assert.equal(get.body.data.api_key, undefined);
  const raw = (await query('SELECT api_key FROM sms_config WHERE id = 1'))[0].api_key;
  assert.match(raw, /^v1:/); assert.ok(!raw.includes('SUPERSECRET'));
  assert.equal((await h.api(admin, 'put', '/sms-config', { sender_id: 'SICC' })).body.data.configured, true, 'blank key keeps the stored one');
  const pastor = await h.loginAgent(await h.makeUser('pastor'));
  assert.equal((await h.api(pastor, 'get', '/sms-config')).status, 403);
});

test('department reports are stored, notify management, and only leaders can submit', async () => {
  const leader = await h.loginAgent(await h.makeUser('department_leader', { department: 'Media' }));
  const pastor = await h.loginAgent(await h.makeUser('pastor'));
  const adminUser = await h.makeUser('admin'); const admin = await h.loginAgent(adminUser);
  assert.equal((await h.api(pastor, 'post', '/reports/submit', { body: 'x' })).status, 403);
  assert.equal((await h.api(leader, 'post', '/reports/submit', { body: '' })).status, 400);
  assert.equal((await h.api(leader, 'post', '/reports/submit', { body: 'Prayer meeting went well. Need two microphones.' })).status, 201);
  const list = await h.api(admin, 'get', '/reports/submitted');
  assert.ok(list.body.data.some(r => r.scope === 'Media' && /microphones/.test(r.body)));
  assert.equal((await h.api(leader, 'get', '/reports/submitted')).status, 403);
  const n = await h.api(admin, 'get', '/notifications');
  assert.ok(n.body.data.items.some(i => /Department report/.test(i.title)));
});
