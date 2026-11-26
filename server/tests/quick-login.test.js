'use strict';
const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');
const h = require('./helpers');
const { query } = require('../db');
const totp = require('../lib/totp');

const base = '/auth/quick-login';
const roles = ['bishop', 'admin', 'pastor', 'department_leader', 'kdf_coordinator', 'red_leader', 'red_member'];
const otherPin = pin => String((Number(pin) + 1) % 10000).padStart(4, '0');
const call = (agent, method, path, body) => h.api(agent, method, `${base}${path}`, body);
const setupPin = (agent, pin, action = 'setup', confirmPin = pin) => call(agent, 'post', '/pin', { action, pin, confirmPin });

function newKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    sign: (purpose, challenge) => sign('sha256', Buffer.from(`sicc-admin:quick-login:v1:${purpose}:${challenge}`),
      { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url'),
  };
}

async function enroll(agent, key = newKey()) {
  const response = await call(agent, 'post', '/devices', { publicKey: key.publicKey });
  assert.equal(response.status, 201, response.body.error);
  const cookie = response.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const id = response.body.data.id;
  return { ...key, id, cookie: cookie.split(';')[0] };
}

async function challenge(agent) {
  const response = await call(agent, 'post', '/challenge');
  assert.equal(response.status, 200, response.body.error);
  return response.body.data.challenge;
}

async function pinAttempt(agent, device, pin) {
  const value = await challenge(agent);
  return call(agent, 'post', '/unlock', { pin, challenge: value, proof: device.sign('pin', value) });
}

async function provision(role = 'pastor') {
  const user = await h.makeUser(role);
  const { agent, res } = await h.login(user);
  assert.equal(res.status, 200);
  const pin = h.testPin();
  await h.completePinSetup(agent, pin);
  return { user, agent, pin, device: await enroll(agent) };
}

after(h.close);

test('new full sign-ins for every role are gated server-side until the user confirms a PIN', async () => {
  const pin = h.testPin();
  const saved = [];
  for (const role of roles) {
    const user = await h.makeUser(role);
    const { agent, res } = await h.login(user);
    assert.equal(res.status, 200, role);
    assert.deepEqual(res.body.data.restrictions, ['pin_setup']);
    const gate = await h.api(agent, 'post', '/auth/welcome-tour', { account_id: user.id });
    assert.equal(gate.status, 403);
    assert.equal(gate.body.code, 'pin_setup');
    const mismatch = await setupPin(agent, pin, 'setup', otherPin(pin));
    assert.equal(mismatch.status, 400);
    assert.equal(mismatch.body.error, 'Your PINs do not match. Please try again.');
    const success = await setupPin(agent, pin);
    assert.equal(success.status, 200, success.body.error);
    assert.equal(success.body.data.quick_login.pin_configured, true);
    assert.deepEqual(success.body.data.restrictions, []);
    assert.equal(success.body.data.profile.role, role);
    assert.equal(success.body.data.profile.quick_pin_hash, undefined);
    assert.equal((await h.api(agent, 'post', '/auth/welcome-tour', { account_id: user.id })).status, 200);
    const [{ quick_pin_hash: hash }] = await query('SELECT quick_pin_hash FROM profiles WHERE id = ?', [user.id]);
    assert.ok(hash.startsWith('s1:'));
    saved.push(hash);
  }
  assert.equal(new Set(saved).size, roles.length);
});

test('pre-migration sessions keep working until the next full login', async () => {
  const user = await h.makeUser('pastor');
  const { agent } = await h.login(user);
  await query('UPDATE sessions SET full_auth_at = NULL WHERE user_id = ?', [user.id]);
  assert.equal((await h.api(agent, 'get', '/members')).status, 200);
  const next = await h.login(user);
  assert.deepEqual(next.res.body.data.restrictions, ['pin_setup']);
});

test('PIN session requires the enrolled cookie and matching proof, and the challenge cannot be replayed', async () => {
  const { user, agent, pin, device } = await provision();
  await h.api(agent, 'post', '/auth/logout');
  const guest = h.request.agent(h.getApp());
  assert.equal((await call(guest, 'get', '/status')).body.data.available, false);
  assert.equal((await call(guest, 'post', '/challenge')).status, 401);
  assert.equal((await call(guest, 'post', '/unlock', { pin, accountId: user.id })).status, 401);
  assert.equal((await call(agent, 'get', '/status')).body.data.available, true);
  const value = await challenge(agent);
  const body = { pin, challenge: value, proof: device.sign('pin', value) };
  assert.equal((await call(guest, 'post', '/unlock', body)).status, 401);
  assert.equal((await call(agent, 'post', '/unlock', { ...body, proof: newKey().sign('pin', value) })).status, 401);
  const accepted = await call(agent, 'post', '/unlock', body);
  assert.equal(accepted.status, 200, accepted.body.error);
  assert.equal(accepted.body.data.profile.id, user.id);
  assert.equal(accepted.body.data.quick_login.recent_full_auth, false);
  await h.api(agent, 'post', '/auth/logout');
  assert.equal((await call(agent, 'post', '/unlock', body)).status, 401);
  const newBrowser = await h.login(user);
  assert.equal((await call(newBrowser.agent, 'get', '/status')).body.data.available, false);
  assert.equal((await call(newBrowser.agent, 'get', '/devices')).body.data.some(item => item.current), false);
  await enroll(newBrowser.agent);
  assert.equal((await call(newBrowser.agent, 'get', '/status')).body.data.available, true);
});

test('five failed PINs suspend a device, audit failures, and require a full sign-in to enroll again', async () => {
  const { agent, user, pin, device } = await provision();
  await h.api(agent, 'post', '/auth/logout');
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await pinAttempt(agent, device, otherPin(pin));
    assert.equal(res.status, attempt === 5 ? 429 : 401);
  }
  assert.equal((await call(agent, 'get', '/status')).body.data.available, false);
  assert.equal((await call(agent, 'post', '/challenge')).status, 401);
  assert.equal((await call(agent, 'post', '/devices', { publicKey: device.publicKey })).status, 401);
  const events = await query('SELECT action, detail, before_json, after_json FROM activity_logs WHERE user_id = ? AND entity_id = ? ORDER BY seq', [user.id, device.id]);
  assert.equal(events.filter(event => event.action === 'auth.quick_login_failed').length, 4);
  assert.ok(events.some(event => event.action === 'auth.quick_login_suspended'));
  assert.ok(events.every(event => event.before_json === null && event.after_json === null));
  const signedIn = await h.api(agent, 'post', '/auth/login', { identifier: user.email, password: user.password });
  assert.equal(signedIn.status, 200);
  const replacement = await enroll(agent, device);
  assert.notEqual(replacement.id, device.id);
  await h.api(agent, 'post', '/auth/logout');
  assert.equal((await pinAttempt(agent, replacement, pin)).status, 200);
});

test('account-wide failures apply across browsers and the IP limiter applies across credentials', async () => {
  const { agent, user, pin, device } = await provision();
  const secondBrowser = (await h.login(user)).agent;
  const secondDevice = await enroll(secondBrowser);
  const spareBrowser = (await h.login(user)).agent;
  await enroll(spareBrowser);
  for (const [browser, key] of [[agent, device], [secondBrowser, secondDevice]]) {
    await h.api(browser, 'post', '/auth/logout');
    for (let attempt = 1; attempt <= 5; attempt++) assert.equal((await pinAttempt(browser, key, otherPin(pin))).status, attempt === 5 ? 429 : 401);
  }
  assert.equal((await call(spareBrowser, 'get', '/status')).body.data.available, false);
  assert.equal((await call(spareBrowser, 'post', '/challenge')).status, 401);
  const guest = h.request.agent(h.getApp());
  let response;
  for (let attempt = 0; attempt < 81; attempt++) {
    response = await call(guest, 'post', '/challenge').set('X-Forwarded-For', '203.0.113.72');
  }
  assert.equal(response.status, 429);
  assert.match(response.body.error, /this network/);
});

test('expired or explicitly revoked enrollment cannot unlock, and revocation ends linked sessions', async () => {
  const { agent, user, pin, device } = await provision();
  const other = (await h.login(user)).agent;
  const expired = await enroll(other);
  await query('UPDATE quick_login_devices SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND) WHERE id = ?', [expired.id]);
  assert.equal((await call(other, 'get', '/status')).body.data.available, false);
  assert.equal((await call(other, 'post', '/challenge')).status, 401);
  await h.api(agent, 'post', '/auth/logout');
  assert.equal((await pinAttempt(agent, device, pin)).status, 200);
  assert.equal((await call(other, 'delete', `/devices/${device.id}`)).status, 200);
  assert.equal((await h.api(agent, 'get', '/auth/me')).status, 401);
  assert.equal((await call(agent, 'post', '/challenge')).status, 401);
});

test('change and forgotten-PIN reset require recent full authentication and revoke old device credentials', async () => {
  const { agent, user, device, pin } = await provision();
  const newPin = otherPin(pin);
  const guest = h.request.agent(h.getApp());
  assert.equal((await setupPin(guest, newPin, 'reset')).status, 401);
  await h.api(agent, 'post', '/auth/logout');
  assert.equal((await pinAttempt(agent, device, pin)).status, 200);
  assert.equal((await setupPin(agent, newPin, 'reset')).body.code, 'full_auth_required');
  assert.equal((await call(agent, 'post', '/devices', { publicKey: device.publicKey })).body.code, 'full_auth_required');
  const olderFull = (await h.login(user)).agent;
  await query('UPDATE sessions SET full_auth_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 16 MINUTE) WHERE user_id = ? AND full_auth_at IS NOT NULL', [user.id]);
  assert.equal((await setupPin(olderFull, newPin, 'change')).body.code, 'full_auth_required');
  const full = (await h.login(user)).agent;
  assert.equal((await setupPin(full, newPin, 'change')).status, 200);
  assert.equal((await h.api(agent, 'get', '/auth/me')).status, 401);
  const replacement = await enroll(full);
  await h.api(full, 'post', '/auth/logout');
  assert.equal((await pinAttempt(full, replacement, pin)).status, 401);
  assert.equal((await pinAttempt(full, replacement, newPin)).status, 200);
  await h.api(full, 'post', '/auth/logout');
  const recovery = (await h.login(user)).agent;
  assert.equal((await setupPin(recovery, pin, 'reset')).status, 200);
  assert.equal((await call(full, 'post', '/challenge')).status, 401);
  const [{ count }] = await query("SELECT COUNT(*) AS count FROM activity_logs WHERE action = 'auth.quick_pin_reset' AND user_id = ?", [user.id]);
  assert.equal(count, 1);
});

test('account deactivation and password reset invalidate trusted device credentials', async () => {
  const admin = await h.loginAgent(await h.makeUser('admin'));
  const a = await provision();
  const b = await provision();
  assert.equal((await h.api(admin, 'delete', `/profiles/${a.user.id}`)).status, 200);
  assert.equal((await h.api(admin, 'post', `/profiles/${b.user.id}/reset-password`)).status, 200);
  for (const { agent, device } of [a, b]) {
    assert.equal((await call(agent, 'get', '/status')).body.data.available, false);
    assert.equal((await call(agent, 'post', '/challenge')).status, 401);
    const [row] = await query('SELECT revoked_at FROM quick_login_devices WHERE id = ?', [device.id]);
    assert.ok(row.revoked_at);
  }
});

test('Bishop and Admin Quick Login still require one-use authenticator verification', async () => {
  for (const role of ['bishop', 'admin']) {
    const { agent, user, pin, device } = await provision(role);
    await h.api(agent, 'post', '/auth/logout');
    const res = await pinAttempt(agent, device, pin);
    assert.equal(res.body.data.mfa_required, true);
    assert.equal(res.headers['set-cookie'], undefined);
    assert.equal((await h.api(agent, 'get', '/auth/me')).status, 401);
    const value = res.body.data.challenge;
    await query('UPDATE profiles SET mfa_last_step = NULL WHERE id = ?', [user.id]);
    const body = { challenge: value, code: totp.hotp(user.secret, totp.stepFor()), proof: device.sign('mfa', value) };
    assert.equal((await call(agent, 'post', '/mfa', { ...body, proof: device.sign('pin', value) })).status, 401);
    const verified = await call(agent, 'post', '/mfa', body);
    assert.equal(verified.status, 200, verified.body.error);
    assert.equal(verified.body.data.profile.role, role);
    await h.api(agent, 'post', '/auth/logout');
    assert.equal((await call(agent, 'post', '/mfa', body)).status, 401);
  }
});
