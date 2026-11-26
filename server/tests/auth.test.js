'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { query } = require('../db');
const totp = require('../lib/totp');

after(() => h.close());

test('requests without the client header are blocked (CSRF guard)', async () => {
  const app = await h.setup();
  const res = await h.request(app).post('/api/auth/login').send({ identifier: 'a', password: 'b' });
  assert.equal(res.status, 403);
});

test('cross-site Origin is rejected', async () => {
  const app = await h.setup();
  const res = await h.request(app).post('/api/auth/login').set('X-SICC-Client', 'web').set('Origin', 'https://evil.example').send({ identifier: 'a', password: 'b' });
  assert.equal(res.status, 403);
});

test('security headers: CSP, no-sniff, frame denial; cookie is HttpOnly + SameSite=Strict', async () => {
  const user = await h.makeUser('pastor');
  const { agent, res } = await h.login(user);
  assert.equal(res.status, 200);
  const csp = res.headers['content-security-policy'];
  assert.match(csp, /default-src 'self'/); assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  const cookie = res.headers['set-cookie'].join(';');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  assert.equal((await h.api(agent, 'get', '/auth/me')).status, 200);
});

test('wrong password and unknown user give the same message', async () => {
  const user = await h.makeUser('pastor');
  const a = await h.login(user, { password: 'Not-The-Password-1' });
  const b = await h.login({ email: 'nobody@test.local', password: 'x', id: 'x', secret: 'x' }, { password: 'whatever12345' });
  assert.equal(a.res.status, 401); assert.equal(b.res.status, 401);
  assert.equal(a.res.body.error, b.res.body.error);
});

test('account locks after repeated failures, even with the right password afterwards', async () => {
  const user = await h.makeUser('pastor');
  for (let i = 0; i < 5; i += 1) await h.login(user, { password: 'Wrong-Password-99' });
  const locked = await h.login(user);
  assert.equal(locked.res.status, 429);
  await query('UPDATE profiles SET locked_until = NULL, failed_logins = 0 WHERE id = ?', [user.id]);
  assert.equal((await h.login(user)).res.status, 200);
});

test('privileged roles must enrol MFA before using the API', async () => {
  const admin = await h.makeUser('admin', { mfa: false });
  const { agent, res } = await h.login(admin);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.restrictions, ['mfa_setup', 'pin_setup']);
  const blocked = await h.api(agent, 'get', '/members');
  assert.equal(blocked.status, 403); assert.equal(blocked.body.code, 'mfa_setup');
  const setup = await h.api(agent, 'post', '/auth/mfa/setup');
  assert.equal(setup.status, 200);
  const bad = await h.api(agent, 'post', '/auth/mfa/enable', { code: '000000' });
  assert.equal(bad.status, 400);
  const good = await h.api(agent, 'post', '/auth/mfa/enable', { code: totp.hotp(setup.body.data.secret, totp.stepFor()) });
  assert.equal(good.status, 200); assert.equal(good.body.data.recovery_codes.length, 8);
  assert.equal((await h.api(agent, 'get', '/members')).body.code, 'pin_setup');
  await h.completePinSetup(agent);
  assert.equal((await h.api(agent, 'get', '/members')).status, 200);
  assert.equal((await h.api(agent, 'post', '/auth/mfa/disable', { password: admin.password, code: '123456' })).status, 403);
});

test('MFA code cannot be replayed and recovery codes work once', async () => {
  const bishop = await h.makeUser('bishop');
  const first = await h.api(h.request.agent(await h.setup()), 'post', '/auth/login', { identifier: bishop.email, password: bishop.password });
  const code = totp.hotp(bishop.secret, totp.stepFor());
  await query('UPDATE profiles SET mfa_last_step = NULL WHERE id = ?', [bishop.id]);
  const agent = h.request.agent(await h.setup());
  assert.equal((await h.api(agent, 'post', '/auth/mfa/verify', { challenge: first.body.data.challenge, code })).status, 200);
  const replay = await h.api(h.request.agent(await h.setup()), 'post', '/auth/mfa/verify', { challenge: first.body.data.challenge, code });
  assert.equal(replay.status, 401);
});

test('forced password change gates the API, enforces the policy and kills other sessions', async () => {
  const user = await h.makeUser('pastor', { must_change: true });
  const { agent, res } = await h.login(user);
  assert.deepEqual(res.body.data.restrictions, ['password_change', 'pin_setup']);
  assert.equal((await h.api(agent, 'get', '/members')).status, 403);
  const other = (await h.login(user)).agent;
  assert.equal((await h.api(agent, 'post', '/auth/password', { current_password: user.password, new_password: 'short' })).status, 400);
  assert.equal((await h.api(agent, 'post', '/auth/password', { current_password: user.password, new_password: 'password12345!' })).status, 400);
  const ok = await h.api(agent, 'post', '/auth/password', { current_password: user.password, new_password: 'ABCD12!Z' });
  assert.equal(ok.status, 200); assert.deepEqual(ok.body.data.restrictions, ['pin_setup']);
  await h.completePinSetup(agent);
  assert.equal((await h.login(user, { password: 'ABCD12!Z' })).res.status, 200);
  assert.equal((await h.api(agent, 'get', '/members')).status, 200);
  assert.equal((await h.api(other, 'get', '/auth/me')).status, 401, 'other session must be revoked');
});

test('an existing bcrypt password signs in without applying the new policy or forcing a reset', async () => {
  const bcrypt = require('bcryptjs');
  const user = await h.makeUser('pastor');
  const oldPassword = 'old password without a number';
  await query('UPDATE profiles SET password_hash = ? WHERE id = ?', [await bcrypt.hash(oldPassword, 12), user.id]);
  const { res } = await h.login(user, { password: oldPassword });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.restrictions, ['pin_setup']);
});

test('welcome tour dismissal is saved for each role and can only change the current account', async () => {
  const people = [];
  for (const role of ['bishop', 'admin', 'pastor', 'department_leader', 'kdf_coordinator', 'red_leader', 'red_member']) {
    const person = await h.makeUser(role);
    const { agent, res } = await h.login(person);
    assert.equal(res.status, 200, role);
    assert.equal(res.body.data.welcome_tour_pending, true, role);
    assert.equal(res.body.data.profile.welcome_tour_done_at, undefined);
    await h.completePinSetup(agent);
    people.push({ person, agent });
  }
  assert.equal((await h.api(people[0].agent, 'post', '/auth/welcome-tour', { account_id: people[1].person.id })).status, 403);
  const restricted = await h.makeUser('pastor', { must_change: true });
  const restrictedAgent = await h.loginAgent(restricted);
  assert.equal((await h.api(restrictedAgent, 'post', '/auth/welcome-tour', { account_id: restricted.id })).status, 403);
  for (const { person, agent } of people) {
    assert.equal((await h.api(agent, 'get', '/auth/me')).body.data.welcome_tour_pending, true, person.role);
    assert.equal((await h.api(agent, 'post', '/auth/welcome-tour', { account_id: person.id })).status, 200, person.role);
    const [first] = await query('SELECT welcome_tour_done_at AS seen FROM profiles WHERE id = ?', [person.id]);
    assert.ok(first.seen);
    assert.equal((await h.api(agent, 'post', '/auth/welcome-tour', { account_id: person.id })).status, 200);
    const [again] = await query('SELECT welcome_tour_done_at AS seen FROM profiles WHERE id = ?', [person.id]);
    assert.equal(again.seen, first.seen);
    assert.equal((await h.login(person)).res.body.data.welcome_tour_pending, false, person.role);
  }
});

test('logout revokes the session server-side (a stolen cookie stops working)', async () => {
  const user = await h.makeUser('pastor');
  const { agent, res } = await h.login(user);
  const stolen = res.headers['set-cookie'][0].split(';')[0];
  await h.api(agent, 'post', '/auth/logout');
  const replay = await h.request(await h.setup()).get('/api/auth/me').set('Cookie', stolen);
  assert.equal(replay.status, 401);
});

test('deactivating a user ends their sessions immediately', async () => {
  const admin = await h.makeUser('admin'); const target = await h.makeUser('pastor');
  const adminAgent = await h.loginAgent(admin); const { agent } = await h.login(target);
  assert.equal((await h.api(agent, 'get', '/auth/me')).status, 200);
  assert.equal((await h.api(adminAgent, 'delete', `/profiles/${target.id}`)).status, 200);
  assert.equal((await h.api(agent, 'get', '/auth/me')).status, 401);
  assert.equal((await h.login(target)).res.status, 401);
});
