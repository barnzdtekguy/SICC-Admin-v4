'use strict';
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { promisify } = require('node:util');
const { validatePassword } = require('../../shared/password-policy.mjs');

const PBKDF2_ROUNDS = 600000;
const HASH_PREFIX = `pbkdf2-sha256$${PBKDF2_ROUNDS}$`;
const legacyBcrypt = /^\$2[aby]?\$/;
const deriveKey = promisify(crypto.pbkdf2);
const encode = (salt, key) => HASH_PREFIX + salt.toString('base64url') + '$' + key.toString('base64url');

// New hashes use the full password. Existing bcrypt hashes remain valid.
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return encode(salt, await deriveKey(password, salt, PBKDF2_ROUNDS, 32, 'sha256'));
}

async function verifyPassword(password, hash) {
  if (typeof hash !== 'string' || typeof password !== 'string') return false;
  if (legacyBcrypt.test(hash)) return bcrypt.compare(password, hash);
  if (!hash.startsWith(HASH_PREFIX)) return false;
  const [saltPart, keyPart] = hash.slice(HASH_PREFIX.length).split('$');
  if (!/^[\w-]{22}$/.test(saltPart) || !/^[\w-]{43}$/.test(keyPart)) return false;
  const salt = Buffer.from(saltPart, 'base64url');
  const key = Buffer.from(keyPart, 'base64url');
  return crypto.timingSafeEqual(await deriveKey(password, salt, PBKDF2_ROUNDS, 32, 'sha256'), key);
}

const DUMMY_BCRYPT = bcrypt.hashSync('timing-equaliser-not-a-real-password', 12);
const DUMMY_PBKDF2 = encode(crypto.randomBytes(16), crypto.randomBytes(32));

async function verifyLoginPassword(password, hash) {
  // Do comparable work for both hash formats and unknown accounts.
  const legacy = legacyBcrypt.test(hash || '');
  const modern = typeof hash === 'string' && hash.startsWith(HASH_PREFIX);
  const [legacyMatch, modernMatch] = await Promise.all([
    verifyPassword(password, legacy ? hash : DUMMY_BCRYPT),
    verifyPassword(password, modern ? hash : DUMMY_PBKDF2),
  ]);
  return (legacy && legacyMatch) || (modern && modernMatch);
}

function generateTempPassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%*?'];
  const all = sets.join('');
  const chars = sets.map(set => set[crypto.randomInt(set.length)]);
  while (chars.length < 16) chars.push(all[crypto.randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

module.exports = { validatePassword, hashPassword, verifyPassword, verifyLoginPassword, generateTempPassword };
