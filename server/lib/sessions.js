'use strict';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { config } = require('../config');

const sqlTime = date => new Date(date).toISOString().slice(0, 19).replace('T', ' ');
const COOKIE_NAME = config.isProd ? '__Host-sicc_session' : 'sicc_session';

function cookieOptions(maxAgeSeconds) {
  return { httpOnly: true, secure: config.isProd, sameSite: 'strict', path: '/', maxAge: maxAgeSeconds * 1000 };
}

async function createSession(profile, { remember = false, ip = null, userAgent = null, mfaPassed = false } = {}) {
  const id = crypto.randomUUID();
  const ttl = remember ? config.session.rememberSeconds : config.session.ttlSeconds;
  const expires = new Date(Date.now() + ttl * 1000);
  await query(
    'INSERT INTO sessions (id, user_id, remember, mfa_passed, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, profile.id, remember ? 1 : 0, mfaPassed ? 1 : 0, ip ? String(ip).slice(0, 64) : null, userAgent ? String(userAgent).slice(0, 255) : null, sqlTime(expires)],
  );
  const token = jwt.sign({ sub: profile.id, sid: id }, config.jwtSecret, { algorithm: 'HS256', expiresIn: ttl });
  return { id, token, ttl, expires };
}

const verifyToken = token => jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });

function signChallenge(profileId, remember) {
  return jwt.sign({ sub: profileId, purpose: 'mfa', rem: remember ? 1 : 0 }, config.jwtSecret, { algorithm: 'HS256', expiresIn: 300 });
}
function verifyChallenge(token) {
  const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  if (payload.purpose !== 'mfa') throw new jwt.JsonWebTokenError('wrong token purpose');
  return payload;
}

const revokeSession = (id, reason = 'logout') => query('UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL', [reason, id]);
const revokeAllForUser = (userId, exceptId = null, reason = 'revoked') =>
  query('UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL AND id <> ?', [reason, userId, exceptId || '']);
const listSessions = userId => query(
  'SELECT id, remember, ip, user_agent, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP ORDER BY last_seen_at DESC', [userId]);
const purgeOldSessions = () => query('DELETE FROM sessions WHERE (revoked_at IS NOT NULL AND revoked_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 DAY)) OR expires_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 DAY)');

module.exports = { COOKIE_NAME, cookieOptions, createSession, verifyToken, signChallenge, verifyChallenge, revokeSession, revokeAllForUser, listSessions, purgeOldSessions };
