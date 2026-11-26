'use strict';
const express = require('express');
const jwt = require('jsonwebtoken');
const { query, queryOn, transaction } = require('../db');
const { config } = require('../config');
const { asyncRoute, HttpError, sendData } = require('../http');
const { authenticate, enforceRestrictions, requirePerm } = require('../middleware');
const { COOKIE_NAME, cookieOptions, createSession, signChallenge, verifyChallenge, revokeSession, revokeAllForUser, revokeTrustedDevices, listSessions } = require('../lib/sessions');
const { credentialState } = require('../lib/auth-policy');
const { verifySecondFactor } = require('../lib/second-factor');
const { validatePassword, hashPassword, verifyPassword, verifyLoginPassword } = require('../lib/password');
const totp = require('../lib/totp');
const { encrypt, decrypt } = require('../lib/crypto');
const bcrypt = require('bcryptjs');
const { audit } = require('../lib/audit');
const { alert } = require('../lib/alert');
const { sessionPayload } = require('../lib/session-response');
const { normalizePhoneLogin } = require('../lib/phone-login');

const router = express.Router();
router.use('/quick-login', require('./quick-login'));
const self = [authenticate, requirePerm('account.self')];
const unknownFailures = new Map(); // identifier -> { n, until }  (same lockout behaviour for accounts that do not exist)
const sqlTime = d => new Date(d).toISOString().slice(0, 19).replace('T', ' ');
const GENERIC = 'Invalid username/email or password.';

function lockMinutes(failures) {
  const tier = Math.floor(failures / config.login.maxFailures);
  return Math.min(config.login.baseLockMinutes * 2 ** Math.max(0, tier - 1), 1440);
}
const lockedMessage = until => `Too many failed attempts. Try again in ${Math.max(1, Math.ceil((until - Date.now()) / 60000))} minute(s), or ask an administrator to unlock your account.`;

async function registerFailure(profile, req, identifier, why) {
  if (!profile) {
    const key = identifier.toLowerCase();
    const entry = unknownFailures.get(key) || { n: 0, until: 0 };
    entry.n += 1;
    if (entry.n % config.login.maxFailures === 0) entry.until = Date.now() + lockMinutes(entry.n) * 60000;
    unknownFailures.set(key, entry);
    if (unknownFailures.size > 5000) unknownFailures.clear();
    return;
  }
  const failures = profile.failed_logins + 1;
  const lock = failures % config.login.maxFailures === 0 ? new Date(Date.now() + lockMinutes(failures) * 60000) : null;
  await query('UPDATE profiles SET failed_logins = ?, locked_until = ? WHERE id = ?', [failures, lock ? sqlTime(lock) : null, profile.id]);
  await audit(req, { action: 'auth.login_failed', entity_type: 'profile', entity_id: profile.id, detail: `${why} (attempt ${failures})`, actor: { id: profile.id, name: profile.name, role: profile.role } });
  if (lock) {
    await audit(req, { action: 'auth.account_locked', entity_type: 'profile', entity_id: profile.id, detail: `Locked until ${lock.toISOString()}`, actor: { id: profile.id, name: profile.name, role: profile.role } });
    alert('account-lock', `${profile.email} (${profile.role}) was locked after ${failures} failed attempts from ${req.ip}`).catch(() => {});
  }
}

async function completeLogin(req, res, profile, { remember, mfaPassed }) {
  const result = await transaction(async connection => {
    const [current] = await queryOn(connection, 'SELECT * FROM profiles WHERE id = ? FOR UPDATE', [profile.id]);
    if (!current?.is_active || !credentialState(current).equals(credentialState(profile))) throw new HttpError(401, 'Please sign in again.');
    const established = await createSession(current, { remember, ip: req.ip, userAgent: req.get('user-agent'), mfaPassed }, connection);
    await queryOn(connection, 'UPDATE profiles SET failed_logins = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP, last_login_ip = ? WHERE id = ?', [String(req.ip || '').slice(0, 64), profile.id]);
    return { session: established, profile: current };
  });
  const { session } = result;
  res.cookie(COOKIE_NAME, session.token, cookieOptions(session.ttl));
  await audit(req, { action: 'auth.login', entity_type: 'profile', entity_id: profile.id, detail: mfaPassed ? 'Signed in with two-factor' : 'Signed in', actor: { id: profile.id, name: profile.name, role: profile.role } });
  return result;
}

router.post('/login', asyncRoute(async (req, res) => {
  const identifier = String(req.body?.identifier || '').trim().slice(0, 254);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!identifier || !password) throw new HttpError(400, 'Enter your username or email and password.');
  const remember = req.body?.rememberMe === true;

  const phone = normalizePhoneLogin(identifier);
  const failureKey = phone || identifier.toLowerCase();
  const unknown = unknownFailures.get(failureKey);
  if (unknown && unknown.until > Date.now()) throw new HttpError(429, lockedMessage(unknown.until));

  const rows = await query(
    "SELECT * FROM profiles WHERE LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?) OR (phone_login = ? AND role IN ('red_leader', 'red_member')) LIMIT 2",
    [identifier, identifier, phone],
  );
  const profile = rows.length === 1 ? rows[0] : null;
  if (profile?.locked_until && new Date(`${profile.locked_until.replace(' ', 'T')}Z`) > new Date()) {
    throw new HttpError(429, lockedMessage(new Date(`${profile.locked_until.replace(' ', 'T')}Z`).getTime()));
  }
  const ok = await verifyLoginPassword(password, profile?.password_hash);
  if (!profile || !ok || !profile.is_active) {
    await registerFailure(profile, req, failureKey, profile && !profile.is_active ? 'inactive account' : 'bad password');
    throw new HttpError(401, GENERIC);
  }
  if (profile.mfa_enabled) {
    return sendData(res, { mfa_required: true, challenge: signChallenge(profile, remember) });
  }
  const login = await completeLogin(req, res, profile, { remember, mfaPassed: false });
  return sendData(res, sessionPayload(login.profile, login.session));
}));

router.post('/mfa/verify', asyncRoute(async (req, res) => {
  let payload;
  try { payload = verifyChallenge(String(req.body?.challenge || '')); } catch (e) {
    if (e instanceof jwt.JsonWebTokenError || e instanceof jwt.TokenExpiredError) throw new HttpError(401, 'Your sign-in step expired. Enter your password again.');
    throw e;
  }
  const rows = await query('SELECT * FROM profiles WHERE id = ? LIMIT 1', [payload.sub]);
  const profile = rows[0];
  if (!profile?.is_active || !profile.mfa_enabled || credentialState(profile).toString('base64url') !== payload.state) throw new HttpError(401, 'Your sign-in step expired. Enter your password again.');
  if (profile.locked_until && new Date(`${profile.locked_until.replace(' ', 'T')}Z`) > new Date()) {
    throw new HttpError(429, lockedMessage(new Date(`${profile.locked_until.replace(' ', 'T')}Z`).getTime()));
  }
  const verification = await verifySecondFactor(profile, req.body?.code);
  if (!verification) { await registerFailure(profile, req, profile.email, 'bad two-factor code'); throw new HttpError(401, 'That code is not valid. Check your authenticator app and try again.'); }
  if (verification.recoveryRemaining !== undefined) {
    await audit(req, { action: 'auth.recovery_code_used', entity_type: 'profile', entity_id: profile.id, detail: `${verification.recoveryRemaining} recovery codes left`, actor: { id: profile.id, name: profile.name, role: profile.role } });
  }
  const login = await completeLogin(req, res, profile, { remember: Boolean(payload.rem), mfaPassed: true });
  return sendData(res, sessionPayload(login.profile, login.session));
}));

router.get('/me', ...self, (req, res) => sendData(res, sessionPayload(req.profile, req.session)));

router.post('/welcome-tour', ...self, enforceRestrictions, asyncRoute(async (req, res) => {
  if (req.body?.account_id !== req.profile.id) throw new HttpError(403, 'Sign in with the account that dismissed the tour.');
  await query('UPDATE profiles SET welcome_tour_done_at = UTC_TIMESTAMP() WHERE id = ? AND welcome_tour_done_at IS NULL', [req.profile.id]);
  sendData(res, { welcome_tour_pending: false });
}));

router.post('/logout', asyncRoute(async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      const payload = jwt.decode(token);
      if (payload?.sid) await revokeSession(payload.sid, 'logout');
    } catch { /* ignore */ }
  }
  res.clearCookie(COOKIE_NAME, { path: '/' });
  sendData(res, { success: true });
}));

router.post('/password', ...self, asyncRoute(async (req, res) => {
  const { current_password: current, new_password: next } = req.body || {};
  const profile = req.profile;
  if (!(await verifyPassword(current, profile.password_hash))) throw new HttpError(400, 'Your current password is not correct.');
  const problem = validatePassword(next);
  if (problem) throw new HttpError(400, problem);
  if (next === current) throw new HttpError(400, 'Choose a different password from your current one.');
  await query('UPDATE profiles SET password_hash = ?, must_change_password = 0, password_changed_at = CURRENT_TIMESTAMP, failed_logins = 0, locked_until = NULL WHERE id = ?', [await hashPassword(next), profile.id]);
  await revokeAllForUser(profile.id, req.session.id, 'password_changed');
  await audit(req, { action: 'auth.password_changed', entity_type: 'profile', entity_id: profile.id });
  const fresh = (await query('SELECT * FROM profiles WHERE id = ?', [profile.id]))[0];
  sendData(res, sessionPayload(fresh, req.session));
}));

// ---- Two-factor setup -------------------------------------------------------
router.post('/mfa/setup', ...self, asyncRoute(async (req, res) => {
  if (req.profile.mfa_enabled) throw new HttpError(400, 'Two-factor authentication is already on.');
  if (req.restrictions.includes('password_change')) throw new HttpError(403, 'Change your temporary password first.', { code: 'password_change' });
  const secret = totp.generateSecret();
  await query('UPDATE profiles SET mfa_pending_secret_enc = ? WHERE id = ?', [encrypt(secret), req.profile.id]);
  sendData(res, { secret, otpauth_url: totp.otpauthUrl({ secret, account: req.profile.email || req.profile.username }) });
}));

router.post('/mfa/enable', ...self, asyncRoute(async (req, res) => {
  const pending = req.profile.mfa_pending_secret_enc;
  if (!pending) throw new HttpError(400, 'Start setup first.');
  const step = totp.verifyTotp(decrypt(pending), req.body?.code);
  if (step === null) throw new HttpError(400, 'That code is not valid. Make sure your phone clock is automatic and try again.');
  const codes = totp.generateRecoveryCodes(8);
  const hashes = await Promise.all(codes.map(c => bcrypt.hash(c, 10)));
  await query('UPDATE profiles SET mfa_enabled = 1, mfa_secret_enc = ?, mfa_pending_secret_enc = NULL, mfa_recovery_hashes = ?, mfa_last_step = ? WHERE id = ?', [pending, JSON.stringify(hashes), step, req.profile.id]);
  await query('UPDATE sessions SET mfa_passed = 1 WHERE id = ?', [req.session.id]);
  await revokeAllForUser(req.profile.id, req.session.id, 'mfa_enabled');
  await audit(req, { action: 'auth.mfa_enabled', entity_type: 'profile', entity_id: req.profile.id });
  sendData(res, { recovery_codes: codes });
}));

router.post('/mfa/disable', ...self, asyncRoute(async (req, res) => {
  if (config.mfaRequiredRoles.includes(req.profile.role)) throw new HttpError(403, 'Two-factor authentication is required for your role and cannot be turned off.');
  if (!(await verifyPassword(String(req.body?.password || ''), req.profile.password_hash))) throw new HttpError(400, 'Your password is not correct.');
  const step = totp.verifyTotp(decrypt(req.profile.mfa_secret_enc), req.body?.code, { lastStep: req.profile.mfa_last_step });
  if (step === null) throw new HttpError(400, 'That code is not valid.');
  await query('UPDATE profiles SET mfa_enabled = 0, mfa_secret_enc = NULL, mfa_recovery_hashes = NULL, mfa_last_step = NULL WHERE id = ?', [req.profile.id]);
  await revokeTrustedDevices(req.profile.id, 'mfa_disabled', null, req.session.id);
  await audit(req, { action: 'auth.mfa_disabled', entity_type: 'profile', entity_id: req.profile.id });
  sendData(res, { success: true });
}));

// ---- Sessions / devices -------------------------------------------------------
router.get('/sessions', ...self, asyncRoute(async (req, res) => {
  const rows = await listSessions(req.profile.id);
  sendData(res, rows.map(r => ({ ...r, current: r.id === req.session.id })));
}));

router.post('/sessions/revoke-others', ...self, asyncRoute(async (req, res) => {
  await revokeAllForUser(req.profile.id, req.session.id, 'user_revoked_all');
  await audit(req, { action: 'auth.sessions_revoked', entity_type: 'profile', entity_id: req.profile.id, detail: 'Signed out all other devices' });
  sendData(res, { success: true });
}));

router.delete('/sessions/:id', ...self, asyncRoute(async (req, res) => {
  const result = await query('UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL', ['user_revoked', req.params.id, req.profile.id]);
  if (!result.affectedRows) throw new HttpError(404, 'Session not found.');
  sendData(res, { success: true });
}));

module.exports = router;
