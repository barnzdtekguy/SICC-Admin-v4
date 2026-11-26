'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { randomUUID } = require('node:crypto');
const { query, queryOn } = require('../db');
const { asyncRoute, HttpError, sendData } = require('../http');
const { authenticate, enforceRestrictions, requirePerm } = require('../middleware');
const { auditThrottled, auditTransaction } = require('../lib/audit');
const { credentialState, quickMfaRequired, recentlyAuthenticated, sqlTime, utcMillis } = require('../lib/auth-policy');
const { COOKIE_NAME, cookieOptions, createSession, revokeTrustedDevices } = require('../lib/sessions');
const { sessionPayload } = require('../lib/session-response');
const { verifySecondFactor } = require('../lib/second-factor');
const {
  DEVICE_COOKIE, DEVICE_TTL, ATTEMPT_WINDOW, DEVICE_LIMIT, ACCOUNT_LIMIT, makeSecret, digestToken, isPin,
  hashPin, verifyPin, validatePublicKey, validProof, attemptsSince, usableDevice, challengeExpires,
} = require('../lib/quick-login');

const router = express.Router();
const self = [authenticate, requirePerm('account.self')];
const maxDevices = 5;
const generic = 'Quick Login is unavailable. Sign in with your password to continue.';
const signInAgain = () => new HttpError(403, 'Sign in again with your password and complete any required verification.', { code: 'full_auth_required' });

const networkLimiter = rateLimit({
  windowMs: ATTEMPT_WINDOW, limit: 80, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => {
    auditThrottled(req, `quick-login-ip:${req.ip}`, ATTEMPT_WINDOW, { action: 'auth.quick_login_rate_limited', detail: 'Network limit reached' })
      .catch(error => req.log?.error({ err: error }, 'Unable to audit Quick Login rate limit'));
    res.status(429).json({ error: 'Too many Quick Login requests from this network. Try again later or sign in with your password.' });
  },
});
const managementLimiter = rateLimit({
  windowMs: ATTEMPT_WINDOW, limit: 20, standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => req.profile.id,
});

const tokenFor = req => digestToken(req.cookies?.[DEVICE_COOKIE]);
const actorFor = profile => profile ? { id: profile.id, name: profile.name, role: profile.role } : undefined;
const eventFor = (action, profile, device, detail) => ({
  action, entity_type: device ? 'quick_login_device' : 'profile', entity_id: device?.id || profile?.id, detail, actor: actorFor(profile),
});
const unavailable = () => new HttpError(401, generic, { code: 'quick_login_unavailable' });

async function enrollment(req, connection = null) {
  const token = tokenFor(req);
  if (!token) return {};
  const [entry] = await queryOn(connection, 'SELECT id, user_id FROM quick_login_devices WHERE token_hash = ?', [token]);
  if (!entry) return {};
  const lock = connection ? ' FOR UPDATE' : '';
  const [profile] = await queryOn(connection, `SELECT * FROM profiles WHERE id = ?${lock}`, [entry.user_id]);
  const [device] = await queryOn(connection, `SELECT * FROM quick_login_devices WHERE id = ? AND token_hash = ?${lock}`, [entry.id, token]);
  return { profile, device };
}

async function requireRecentFullAuth(req, connection) {
  const [profile] = await queryOn(connection, 'SELECT * FROM profiles WHERE id = ? FOR UPDATE', [req.profile.id]);
  const [session] = await queryOn(connection, 'SELECT * FROM sessions WHERE id = ? AND user_id = ? FOR UPDATE', [req.session.id, req.profile.id]);
  if (!profile?.is_active || profile.must_change_password || !session || session.revoked_at || !(utcMillis(session.expires_at) > Date.now())
    || !credentialState(profile).equals(credentialState(req.profile)) || !recentlyAuthenticated(profile, session)) throw signInAgain();
  if (req.restrictions.some(restriction => restriction !== 'pin_setup')) throw signInAgain();
  return { profile, session };
}

function clearDeviceCookie(res) {
  const { maxAge: _maxAge, ...options } = cookieOptions(DEVICE_TTL);
  res.clearCookie(DEVICE_COOKIE, options);
}

async function setChallenge(connection, device, purpose) {
  const challenge = makeSecret();
  await queryOn(connection, `UPDATE quick_login_devices SET challenge_hash = ?, challenge_expires_at = ?, challenge_purpose = ? WHERE id = ?`,
    [digestToken(challenge), challengeExpires(purpose), purpose, device.id]);
  return challenge;
}

const clearChallenge = (connection, device) => queryOn(connection, `UPDATE quick_login_devices
  SET challenge_hash = NULL, challenge_expires_at = NULL, challenge_purpose = NULL WHERE id = ?`, [device.id]);

function accountLimited(profile, now = Date.now()) {
  return attemptsSince(profile.quick_pin_failure_at, profile.quick_pin_failures, now) >= ACCOUNT_LIMIT;
}

async function failedAttempt(connection, profile, device, purpose) {
  const now = Date.now();
  const deviceAttempts = attemptsSince(device.failure_at, device.failed_attempts, now);
  const accountAttempts = attemptsSince(profile.quick_pin_failure_at, profile.quick_pin_failures, now);
  const suspend = deviceAttempts + 1 >= DEVICE_LIMIT;
  await queryOn(connection, 'UPDATE profiles SET quick_pin_failures = ?, quick_pin_failure_at = ? WHERE id = ?',
    [accountAttempts + 1, accountAttempts ? profile.quick_pin_failure_at : sqlTime(now), profile.id]);
  await queryOn(connection, 'UPDATE quick_login_devices SET failed_attempts = ?, failure_at = ?, suspended_at = ? WHERE id = ?',
    [deviceAttempts + 1, deviceAttempts ? device.failure_at : sqlTime(now), suspend ? sqlTime(now) : null, device.id]);
  const blocked = suspend || accountAttempts + 1 >= ACCOUNT_LIMIT;
  if (blocked) await clearChallenge(connection, device);
  const error = blocked ? new HttpError(429, generic, { code: 'quick_login_unavailable' }) : new HttpError(401,
    purpose === 'pin' ? 'That PIN did not unlock your account. Try again or sign in with your password.' : 'That code is not valid. Check your authenticator app and try again.');
  return { data: { error }, event: eventFor(suspend ? 'auth.quick_login_suspended' : 'auth.quick_login_failed', profile, device,
    `${purpose === 'pin' ? 'Incorrect PIN' : 'Incorrect verification code'} (attempt ${deviceAttempts + 1})`) };
}

router.get('/status', asyncRoute(async (req, res) => {
  const { profile, device } = await enrollment(req);
  sendData(res, { available: usableDevice(profile, device) && !accountLimited(profile) });
}));

router.post('/challenge', networkLimiter, asyncRoute(async (req, res) => {
  const challenge = await auditTransaction(req, async connection => {
    const { profile, device } = await enrollment(req, connection);
    if (!usableDevice(profile, device) || accountLimited(profile)) return { data: null };
    return { data: await setChallenge(connection, device, 'pin') };
  });
  if (!challenge) throw unavailable();
  sendData(res, { challenge });
}));

function unlock(purpose) {
  return asyncRoute(async (req, res) => {
    const result = await auditTransaction(req, async connection => {
      const { profile, device } = await enrollment(req, connection);
      if (!usableDevice(profile, device) || accountLimited(profile) || !validProof(device, purpose, req.body?.challenge, req.body?.proof)) {
        return { data: { error: unavailable() }, event: eventFor('auth.quick_login_failed', profile, device, 'Device proof unavailable') };
      }
      let verification;
      if (purpose === 'pin') {
        await clearChallenge(connection, device);
        if (!(await verifyPin(profile, req.body?.pin))) return failedAttempt(connection, profile, device, purpose);
        if (profile.mfa_enabled) return { data: { challenge: await setChallenge(connection, device, 'mfa') } };
      } else {
        verification = await verifySecondFactor(profile, req.body?.code, connection);
        if (!verification) return failedAttempt(connection, profile, device, purpose);
        await clearChallenge(connection, device);
      }
      const session = await createSession(profile, { ip: req.ip, userAgent: req.get('user-agent'), mfaPassed: purpose === 'mfa', quickDeviceId: device.id }, connection);
      await queryOn(connection, 'UPDATE quick_login_devices SET last_used_at = UTC_TIMESTAMP() WHERE id = ?', [device.id]);
      await queryOn(connection, 'UPDATE profiles SET last_login_at = CURRENT_TIMESTAMP, last_login_ip = ? WHERE id = ?', [String(req.ip || '').slice(0, 64), profile.id]);
      const detail = verification?.recoveryRemaining !== undefined ? 'Quick Login verified with a recovery code' : 'Quick Login verified';
      return { data: { session, profile }, event: eventFor('auth.quick_login', profile, device, detail) };
    });
    if (result.error) throw result.error;
    if (result.challenge) return sendData(res, { mfa_required: true, challenge: result.challenge });
    res.cookie(COOKIE_NAME, result.session.token, cookieOptions(result.session.ttl));
    return sendData(res, sessionPayload(result.profile, result.session));
  });
}

router.post('/unlock', networkLimiter, unlock('pin'));
router.post('/mfa', networkLimiter, unlock('mfa'));

router.post('/pin', ...self, managementLimiter, asyncRoute(async (req, res) => {
  const { pin, confirmPin, action } = req.body || {};
  if (!['setup', 'change', 'reset'].includes(action)) throw new HttpError(400, 'Choose a PIN action.');
  if (!isPin(pin) || !isPin(confirmPin)) throw new HttpError(400, 'Enter a four-digit PIN in both fields.');
  if (pin !== confirmPin) throw new HttpError(400, 'Your PINs do not match. Please try again.');
  if (!recentlyAuthenticated(req.profile, req.session) || req.restrictions.some(restriction => restriction !== 'pin_setup')) throw signInAgain();
  const hash = await hashPin(req.profile.id, pin);
  const result = await auditTransaction(req, async connection => {
    const { profile, session } = await requireRecentFullAuth(req, connection);
    if (Boolean(profile.quick_pin_hash) === (action === 'setup')) throw new HttpError(409, 'Your PIN setup status changed. Reload and try again.');
    const reason = `quick_pin_${action}`;
    await queryOn(connection, `UPDATE profiles SET quick_pin_hash = ?, quick_pin_set_at = UTC_TIMESTAMP(),
      quick_pin_failures = 0, quick_pin_failure_at = NULL WHERE id = ?`, [hash, profile.id]);
    await revokeTrustedDevices(profile.id, reason, connection);
    return { data: sessionPayload({ ...profile, quick_pin_hash: hash }, session), event: eventFor(`auth.${reason}`, profile) };
  });
  clearDeviceCookie(res);
  sendData(res, result);
}));

router.get('/devices', ...self, enforceRestrictions, asyncRoute(async (req, res) => {
  const rows = await query(`SELECT id, token_hash, user_agent, enrolled_at, expires_at, last_used_at, suspended_at
    FROM quick_login_devices WHERE user_id = ? AND revoked_at IS NULL ORDER BY enrolled_at DESC`, [req.profile.id]);
  const token = tokenFor(req);
  sendData(res, rows.map(({ token_hash: tokenHash, ...device }) => ({ ...device, current: Boolean(token && tokenHash.equals(token)) })));
}));

async function revokeDevice(connection, userId, id) {
  const change = await queryOn(connection, 'UPDATE quick_login_devices SET revoked_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ? AND revoked_at IS NULL', [id, userId]);
  if (change.affectedRows) await queryOn(connection, `UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'quick_device_revoked'
    WHERE user_id = ? AND quick_device_id = ? AND revoked_at IS NULL`, [userId, id]);
  return change.affectedRows;
}

router.post('/devices', ...self, enforceRestrictions, managementLimiter, asyncRoute(async (req, res) => {
  if (!recentlyAuthenticated(req.profile, req.session)) throw signInAgain();
  const key = validatePublicKey(req.body?.publicKey);
  if (!key) throw new HttpError(400, 'This browser could not create a Quick Login key.');
  const token = makeSecret();
  const data = await auditTransaction(req, async connection => {
    const { profile } = await requireRecentFullAuth(req, connection);
    if (!profile.quick_pin_hash) throw new HttpError(403, 'Set up your PIN first.');
    if (quickMfaRequired(profile) && !profile.mfa_enabled) throw new HttpError(403, 'Set up two-step verification before trusting this device.');
    const current = tokenFor(req);
    if (current) {
      const [previous] = await queryOn(connection, 'SELECT id FROM quick_login_devices WHERE user_id = ? AND token_hash = ?', [profile.id, current]);
      if (previous) await revokeDevice(connection, profile.id, previous.id);
    }
    const [{ count }] = await queryOn(connection, `SELECT COUNT(*) AS count FROM quick_login_devices
      WHERE user_id = ? AND revoked_at IS NULL AND suspended_at IS NULL AND expires_at > UTC_TIMESTAMP()`, [profile.id]);
    if (count >= maxDevices) throw new HttpError(409, 'Remove a trusted device before adding another.');
    const id = randomUUID();
    await queryOn(connection, `INSERT INTO quick_login_devices (id, user_id, token_hash, public_key, credential_state, user_agent, enrolled_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?)`,
    [id, profile.id, digestToken(token), key, credentialState(profile), String(req.get('user-agent') || '').slice(0, 255), sqlTime(Date.now() + DEVICE_TTL * 1000)]);
    return { data: { id }, event: eventFor('auth.quick_device_enrolled', profile, { id }) };
  });
  res.cookie(DEVICE_COOKIE, token, cookieOptions(DEVICE_TTL));
  sendData(res, data, 201);
}));

router.delete('/devices/:id', ...self, enforceRestrictions, asyncRoute(async (req, res) => {
  const result = await auditTransaction(req, async connection => {
    await queryOn(connection, 'SELECT id FROM profiles WHERE id = ? FOR UPDATE', [req.profile.id]);
    const [device] = await queryOn(connection, 'SELECT id, token_hash FROM quick_login_devices WHERE id = ? AND user_id = ?', [req.params.id, req.profile.id]);
    if (!device || !(await revokeDevice(connection, req.profile.id, device.id))) throw new HttpError(404, 'Trusted device not found.');
    const [session] = await queryOn(connection, 'SELECT quick_device_id FROM sessions WHERE id = ?', [req.session.id]);
    const token = tokenFor(req);
    return { data: { current: Boolean(token && device.token_hash.equals(token)), signed_out: session?.quick_device_id === device.id },
      event: eventFor('auth.quick_device_revoked', req.profile, device) };
  });
  if (result.current) clearDeviceCookie(res);
  if (result.signed_out) {
    const { maxAge: _maxAge, ...options } = cookieOptions(0);
    res.clearCookie(COOKIE_NAME, options);
  }
  sendData(res, { signed_out: result.signed_out });
}));

module.exports = router;
