'use strict';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit-test-secret-0123456789abcdef0123456789abcdef0123456789abcdef';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { validatePassword, generateTempPassword, hashPassword, verifyPassword } = require('../../lib/password');
const { PASSWORD_HINT } = require('../../../shared/password-policy.mjs');
const totp = require('../../lib/totp');
const { encrypt, decrypt, checkinToken, verifyCheckinToken } = require('../../lib/crypto');
const { toCsv } = require('../../lib/csv');
const { canManageRole, can } = require('../../permissions');
const { digest, GENESIS, redact } = require('../../lib/audit');

test('password policy', () => {
  for (const accepted of ['ABCD12!Z', 'Password12345!', 'ÁBÇĐ٥٦!Á', 'A1!'.repeat(90)]) assert.equal(validatePassword(accepted), null);
  for (const rejected of ['A1!bcde', 'abcd12!z', 'ABCDEF!Z', 'ABCD123Z', 'ABCD12 Z', 'correct horse battery staple ok', null]) {
    assert.equal(validatePassword(rejected), PASSWORD_HINT);
  }
  assert.equal(validatePassword(generateTempPassword()), null);
});

test('long passwords are compared in full and legacy bcrypt passwords still verify', async () => {
  const base = `A1!${'x'.repeat(220)}`;
  const hash = await hashPassword(`${base}a`);
  assert.equal(await verifyPassword(`${base}a`, hash), true);
  assert.equal(await verifyPassword(`${base}b`, hash), false);
  assert.equal(await verifyPassword('legacy', bcrypt.hashSync('legacy', 4)), true);
});

test('RFC 6238 test vectors (SHA-1)', () => {
  const secret = totp.base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(totp.hotp(secret, Math.floor(59 / 30)), '287082');
  assert.equal(totp.hotp(secret, Math.floor(1111111109 / 30)), '081804');
  assert.notEqual(totp.verifyTotp(secret, '287082', { now: 59000 }), null);
  assert.equal(totp.verifyTotp(secret, '000000', { now: 59000 }), null);
});

test('encryption round-trips and detects tampering', () => {
  const blob = encrypt('api-key-123');
  assert.notEqual(blob, 'api-key-123'); assert.equal(decrypt(blob), 'api-key-123');
  assert.throws(() => decrypt(blob.slice(0, -3) + 'AAA'));
});

test('check-in tokens expire after two windows and are bound to the programme', () => {
  const now = 1_700_000_000_000; const t = checkinToken('p1', 60, now);
  assert.ok(verifyCheckinToken('p1', t, 60, now));
  assert.ok(verifyCheckinToken('p1', t, 60, now + 60_000));
  assert.ok(!verifyCheckinToken('p1', t, 60, now + 180_000));
  assert.ok(!verifyCheckinToken('p2', t, 60, now));
  assert.ok(!verifyCheckinToken('p1', 'x.y', 60, now));
});

test('csv neutralises spreadsheet formulas', () => {
  const out = toCsv([{ key: 'a', label: 'A' }], [{ a: '=1+1' }, { a: 'a,b' }, { a: '@cmd' }]);
  assert.ok(out.includes("'=1+1") && out.includes('"a,b"') && out.includes("'@cmd"));
});

test('role rules', () => {
  assert.ok(canManageRole('bishop', 'admin')); assert.ok(!canManageRole('admin', 'bishop')); assert.ok(canManageRole('admin', 'pastor'));
  assert.ok(!can('kdf_coordinator', 'profiles.read')); assert.ok(can('bishop', 'members.anonymize')); assert.ok(!can('admin', 'members.anonymize'));
});

test('audit hash depends on every field and the previous hash', () => {
  const row = { id: '1', user_id: 'u', user_name: 'n', role: 'r', action: 'a', entity_type: null, entity_id: null, detail: 'd', before_json: null, after_json: null, ip: '1.1.1.1' };
  const a = digest(GENESIS, row, '2026-01-01T00:00:00.000Z');
  assert.notEqual(a, digest(GENESIS, { ...row, detail: 'x' }, '2026-01-01T00:00:00.000Z'));
  assert.notEqual(a, digest('f'.repeat(64), row, '2026-01-01T00:00:00.000Z'));
  assert.equal(redact({ password_hash: 'x', nested: { api_key: 'k', ok: 1 } }).nested.api_key, '[redacted]');
});
