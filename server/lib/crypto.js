'use strict';
const crypto = require('crypto');
const { deriveKey } = require('../config');

// AES-256-GCM envelope: v1:<iv>:<tag>:<ciphertext>  (all base64url)
function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey('data-at-rest'), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith('v1:') && value.split(':').length === 4;
}

function decrypt(blob) {
  if (!isEncrypted(blob)) return blob;
  const [, iv, tag, ct] = blob.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey('data-at-rest'), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

function hmac(purpose, data) {
  return crypto.createHmac('sha256', deriveKey(`hmac:${purpose}`)).update(String(data)).digest('base64url');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');

// ---- Rotating check-in tokens -------------------------------------------------
// A token proves the holder saw the live QR code within the last ~2 rotation windows.
function checkinToken(programmeId, rotateSeconds, now = Date.now()) {
  const window = Math.floor(now / 1000 / rotateSeconds);
  return `${window.toString(36)}.${hmac('checkin', `${programmeId}:${window}`).slice(0, 22)}`;
}

function verifyCheckinToken(programmeId, token, rotateSeconds, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 64 || !token.includes('.')) return false;
  const [w, sig] = token.split('.');
  const window = parseInt(w, 36);
  const current = Math.floor(now / 1000 / rotateSeconds);
  if (!Number.isInteger(window) || window > current || current - window > 1) return false;
  return safeEqual(sig, hmac('checkin', `${programmeId}:${window}`).slice(0, 22));
}

module.exports = { encrypt, decrypt, isEncrypted, hmac, safeEqual, randomToken, sha256, checkinToken, verifyCheckinToken };
