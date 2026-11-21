'use strict';
process.env.NODE_ENV = 'test';
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env.test') });
const crypto = require('crypto');
const request = require('supertest');
const { migrate } = require('../migrate');
const { createApp } = require('../app');
const { query, pool } = require('../db');
const { hashPassword } = require('../lib/password');
const { encrypt } = require('../lib/crypto');
const totp = require('../lib/totp');

const PASSWORD = 'Granite!Lantern-7731';
let app; let passwordHash;

async function setup() {
  if (!/_test$/.test(process.env.DB_NAME || '')) throw new Error('Integration tests require a disposable database whose name ends in _test.');
  await migrate();
  app = app || createApp();
  passwordHash = passwordHash || await hashPassword(PASSWORD);
  return app;
}

const uniq = () => crypto.randomBytes(4).toString('hex');
const api = (agent, method, url, body) => {
  const r = agent[method](`/api${url}`).set('X-SICC-Client', 'web');
  return body === undefined ? r : r.send(body);
};

// Creates a user directly in the DB. Privileged roles get MFA enabled (it is mandatory for them).
async function makeUser(role, extra = {}) {
  await setup();
  const id = crypto.randomUUID(); const tag = uniq();
  const secret = totp.generateSecret();
  const mfa = extra.mfa ?? ['bishop', 'admin'].includes(role);
  const email = extra.email || `${role}.${tag}@test.local`;
  await query(`INSERT INTO profiles (id, name, email, role, department, kdf_area, avatar, password_hash, must_change_password, mfa_enabled, mfa_secret_enc, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 'TU', ?, ?, ?, ?, 1)`, [id, extra.name || `Test ${role} ${tag}`, email, role, extra.department || null, extra.kdf_area || null, passwordHash, extra.must_change ? 1 : 0, mfa ? 1 : 0, mfa ? encrypt(secret) : null]);
  return { id, email, role, secret, mfa, password: PASSWORD };
}

async function login(user, { password = user.password, rememberMe = false } = {}) {
  await setup();
  const agent = request.agent(app);
  const first = await api(agent, 'post', '/auth/login', { identifier: user.email, password, rememberMe });
  if (first.status !== 200 || !first.body.data?.mfa_required) return { agent, res: first };
  await query('UPDATE profiles SET mfa_last_step = NULL WHERE id = ?', [user.id]);
  const second = await api(agent, 'post', '/auth/mfa/verify', { challenge: first.body.data.challenge, code: totp.hotp(user.secret, totp.stepFor()) });
  return { agent, res: second };
}

async function loginAgent(user) { const { agent, res } = await login(user); if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`); return agent; }

// Test databases only: attendance has unique keys, so clear it between runs.
async function resetAttendance() {
  if (!/_test$/.test(process.env.DB_NAME || '')) throw new Error('Refusing to wipe a non-test database');
  await query('DELETE FROM correction_requests');
  await query('DELETE FROM attendance');
}

async function close() { await pool.end(); }

module.exports = { resetAttendance, setup, makeUser, login, loginAgent, api, uniq, close, PASSWORD, request, getApp: () => app };
