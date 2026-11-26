'use strict';
const bcrypt = require('bcryptjs');
const { queryOn } = require('../db');
const { decrypt } = require('./crypto');
const totp = require('./totp');

async function verifySecondFactor(profile, input, connection = null) {
  const code = typeof input === 'string' ? input.trim().slice(0, 32) : '';
  if (!profile.mfa_enabled || !code) return null;
  if (/^\d{3}\s?\d{3}$/.test(code)) {
    const step = totp.verifyTotp(decrypt(profile.mfa_secret_enc), code, { lastStep: profile.mfa_last_step });
    if (step === null) return null;
    const result = await queryOn(connection, `UPDATE profiles SET mfa_last_step = ?
      WHERE id = ? AND mfa_enabled = 1 AND mfa_secret_enc = ? AND (mfa_last_step IS NULL OR mfa_last_step < ?)`,
    [step, profile.id, profile.mfa_secret_enc, step]);
    return result.affectedRows ? {} : null;
  }
  const priorHashes = profile.mfa_recovery_hashes;
  const hashes = JSON.parse(priorHashes || '[]');
  for (const [index, hash] of hashes.entries()) {
    if (!(await bcrypt.compare(code.toLowerCase(), hash))) continue;
    hashes.splice(index, 1);
    const result = await queryOn(connection, `UPDATE profiles SET mfa_recovery_hashes = ?
      WHERE id = ? AND mfa_enabled = 1 AND mfa_recovery_hashes = ?`, [JSON.stringify(hashes), profile.id, priorHashes]);
    return result.affectedRows ? { recoveryRemaining: hashes.length } : null;
  }
  return null;
}

module.exports = { verifySecondFactor };
