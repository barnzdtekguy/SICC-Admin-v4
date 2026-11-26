'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { config, deriveKey } = require('../config');
const { sqlTime, utcMillis, quickMfaRequired, credentialState } = require('./auth-policy');

const DEVICE_COOKIE = config.isProd ? '__Host-sicc_quick_device' : 'sicc_quick_device';
const DEVICE_TTL = 30 * 86400;
const ATTEMPT_WINDOW = 15 * 60 * 1000;
const DEVICE_LIMIT = 5;
const ACCOUNT_LIMIT = 10;
const scrypt = promisify(crypto.scrypt);
const pinFormat = /^\d{4}$/;
const tokenFormat = /^[A-Za-z0-9_-]{43}$/;
const isPin = value => typeof value === 'string' && pinFormat.test(value);
const makeSecret = () => crypto.randomBytes(32).toString('base64url');
const digest = value => crypto.createHash('sha256').update(value).digest();
const digestToken = value => typeof value === 'string' && tokenFormat.test(value) ? digest(value) : null;

function pinMaterial(id, pin) {
  return crypto.createHmac('sha256', deriveKey('quick-login-pin-pepper-v1')).update(`${id}:${pin}`).digest();
}

const stretchPin = (id, pin, salt) => scrypt(pinMaterial(id, pin), salt, 32, { N: 2 ** 16, r: 8, p: 2, maxmem: 80 * 1024 * 1024 });

async function hashPin(id, pin) {
  const salt = crypto.randomBytes(16);
  const hash = await stretchPin(id, pin, salt);
  return `s1:${salt.toString('base64url')}:${hash.toString('base64url')}`;
}

async function verifyPin(profile, pin) {
  if (!isPin(pin) || !profile.quick_pin_hash) return false;
  const [version, salt, hash] = profile.quick_pin_hash.split(':');
  if (version !== 's1' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  return expected.length === 32 && crypto.timingSafeEqual(expected, await stretchPin(profile.id, pin, Buffer.from(salt, 'base64url')));
}

function validatePublicKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{100,171}$/.test(value)) return null;
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(value, 'base64url'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return null;
    return key.export({ type: 'spki', format: 'der' });
  } catch { return null; }
}

function validProof(device, purpose, challenge, proof) {
  const nonce = digestToken(challenge);
  if (!nonce || device.challenge_purpose !== purpose || !device.challenge_hash?.equals(nonce) || !(utcMillis(device.challenge_expires_at) > Date.now())) return false;
  if (typeof proof !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(proof)) return false;
  return crypto.verify('sha256', Buffer.from(`sicc-admin:quick-login:v1:${purpose}:${challenge}`), {
    key: device.public_key, format: 'der', type: 'spki', dsaEncoding: 'ieee-p1363',
  }, Buffer.from(proof, 'base64url'));
}

function attemptsSince(start, count, now) {
  return now - utcMillis(start) < ATTEMPT_WINDOW ? Number(count) : 0;
}

function usableDevice(profile, device, now = Date.now()) {
  return Boolean(profile?.is_active && profile.quick_pin_hash && !profile.must_change_password
    && (!quickMfaRequired(profile) || profile.mfa_enabled) && !(utcMillis(profile.locked_until) > now)
    && device && !device.revoked_at && !device.suspended_at && utcMillis(device.expires_at) > now
    && device.credential_state.equals(credentialState(profile)));
}

const challengeExpires = purpose => sqlTime(Date.now() + (purpose === 'pin' ? 90 : 300) * 1000);

module.exports = { DEVICE_COOKIE, DEVICE_TTL, ATTEMPT_WINDOW, DEVICE_LIMIT, ACCOUNT_LIMIT, makeSecret, digestToken, isPin,
  hashPin, verifyPin, validatePublicKey, validProof, attemptsSince, usableDevice, challengeExpires };
