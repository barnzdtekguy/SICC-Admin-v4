'use strict';
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { query } = require('./db');
const { config } = require('./config');
const { HttpError } = require('./http');
const { can } = require('./permissions');
const { COOKIE_NAME, verifyToken } = require('./lib/sessions');
const { alert } = require('./lib/alert');
const jwt = require('jsonwebtoken');

function requestContext(req, res, next) {
  req.id = req.get('x-request-id')?.slice(0, 40) || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"],
      ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'no-referrer' },
  hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
});

function permissionsPolicy(_req, res, next) {
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()');
  next();
}

// CSRF defence in depth on top of SameSite=Strict cookies:
//  1. state-changing requests must carry a custom header (cannot be sent cross-site without CORS), and
//  2. if the browser sends an Origin header, it must be this site.
function originGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-sicc-client') !== 'web') return next(new HttpError(403, 'Request blocked: missing client header. Reload the page and try again.'));
  const origin = req.get('origin');
  if (origin) {
    const allowed = new Set(config.allowedOrigins);
    let ok = allowed.has(origin.replace(/\/$/, ''));
    let hostname = '';
    try { const u = new URL(origin); hostname = u.hostname; if (!ok && allowed.size === 0) ok = u.host === req.get('host'); } catch { ok = false; }
    // Local development only: the Vite dev server (any port on localhost) talks to this API.
    if (!ok && !config.isProd && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) ok = true;
    if (!ok) {
      const detail = config.isProd ? '' : ` (browser origin "${origin}", allowed: ${allowed.size ? [...allowed].join(', ') : `same host "${req.get('host')}"`}. Check APP_ORIGIN in .env)`;
      return next(new HttpError(403, `Request blocked: cross-site request.${detail}`));
    }
  }
  return next();
}

const noStore = (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); };

const limiter = (windowMs, limit, message, keyGenerator) => rateLimit({
  windowMs, limit, standardHeaders: true, legacyHeaders: false, keyGenerator,
  handler: (_req, res) => res.status(429).json({ error: message }),
  skip: () => config.isTest,
});
const apiLimiter = limiter(5 * 60 * 1000, 600, 'Too many requests. Please slow down and try again shortly.');
const loginLimiter = limiter(15 * 60 * 1000, 40, 'Too many sign-in attempts from this network. Try again in a few minutes.');
const publicCheckInLimiter = limiter(60 * 1000, 12, 'Too many check-in attempts. Please wait a minute.');
const redInviteLimiter = limiter(5 * 60 * 1000, 50, 'Too many invitation requests. Please try again shortly.');
const redSignupLimiter = limiter(15 * 60 * 1000, 20, 'Too many sign-up attempts. Please try again shortly.');
const userKey = req => `u:${req.profile?.id || req.ip}`;
const exportLimiter = limiter(60 * 60 * 1000, 12, 'Export limit reached. Try again later.', userKey);
const messageLimiter = limiter(60 * 60 * 1000, 20, 'Message sending limit reached. Try again later.', userKey);

// Loads the session + profile. Revoked, expired, idle or deactivated sessions are rejected.
async function authenticate(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) throw new HttpError(401, 'Please sign in to continue.');
    let payload;
    try { payload = verifyToken(token); } catch (e) {
      if (e instanceof jwt.JsonWebTokenError || e instanceof jwt.TokenExpiredError) throw new HttpError(401, 'Your session has expired. Please sign in again.');
      throw e;
    }
    const rows = await query(
      `SELECT s.id AS sid, s.remember, s.mfa_passed, s.expires_at, s.revoked_at, s.last_seen_at, p.*
       FROM sessions s JOIN profiles p ON p.id = s.user_id WHERE s.id = ? AND s.user_id = ? LIMIT 1`, [payload.sid, payload.sub]);
    const row = rows[0];
    const fail = message => { res.clearCookie(COOKIE_NAME, { path: '/' }); throw new HttpError(401, message); };
    if (!row || row.revoked_at) return fail('Your session has ended. Please sign in again.');
    if (!row.is_active) return fail('Your account is inactive. Contact an administrator.');
    if (new Date(`${row.expires_at.replace(' ', 'T')}Z`) < new Date()) return fail('Your session has expired. Please sign in again.');
    const seen = new Date(`${row.last_seen_at.replace(' ', 'T')}Z`).getTime();
    if (!row.remember && Date.now() - seen > config.session.idleMinutes * 60000) {
      await query("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'idle' WHERE id = ?", [row.sid]);
      return fail('You were signed out after a period of inactivity.');
    }
    if (Date.now() - seen > 60000) await query('UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?', [row.sid]);

    const { sid, remember, mfa_passed, expires_at, revoked_at, last_seen_at, ...profile } = row;
    req.profile = profile;
    req.session = { id: sid, remember: Boolean(remember), expires_at };
    req.restrictions = [];
    if (profile.must_change_password) req.restrictions.push('password_change');
    if (config.mfaRequiredRoles.includes(profile.role) && !profile.mfa_enabled) req.restrictions.push('mfa_setup');
    return next();
  } catch (error) { return next(error); }
}

// Blocks normal API use until a forced password change / mandatory MFA enrolment is complete.
function enforceRestrictions(req, _res, next) {
  if (req.restrictions?.length) {
    return next(new HttpError(403, req.restrictions.includes('password_change')
      ? 'You must change your temporary password before continuing.'
      : 'Two-factor authentication must be set up before you can continue.', { code: req.restrictions[0] }));
  }
  return next();
}
const secured = [authenticate, enforceRestrictions];

function requirePerm(permission) {
  return (req, _res, next) => {
    if (!req.profile || !can(req.profile.role, permission)) return next(new HttpError(403, 'You do not have permission to perform this action.'));
    return next();
  };
}

function publicProfile(profile) {
  const {
    password_hash, mfa_secret_enc, mfa_pending_secret_enc, mfa_recovery_hashes, mfa_last_step, failed_logins, locked_until,
    phone_login: _phoneLogin, red_phone_login: _redPhoneLogin, ...safe
  } = profile;
  return { ...safe, mfa_enabled: Boolean(profile.mfa_enabled), must_change_password: Boolean(profile.must_change_password), is_active: Boolean(profile.is_active) };
}

function errorHandler(error, req, res, _next) {
  if (res.headersSent) return undefined;
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body is not valid JSON.' });
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'The request is too large.' });
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A record with the same unique value already exists.' });
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) {
    req.log?.error({ err: error }, 'Unhandled API error');
    alert('server-error', `${req.method} ${req.originalUrl} -> ${status}: ${error.message}`).catch(() => {});
  }
  return res.status(status).json({ error: status < 500 ? error.message : 'An unexpected server error occurred.', request_id: req.id, ...(status < 500 ? error.extra : {}) });
}

module.exports = { requestContext, securityHeaders, permissionsPolicy, originGuard, noStore, apiLimiter, loginLimiter, publicCheckInLimiter, redInviteLimiter, redSignupLimiter, exportLimiter, messageLimiter, authenticate, enforceRestrictions, secured, requirePerm, publicProfile, errorHandler };
