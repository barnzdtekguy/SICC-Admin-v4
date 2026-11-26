'use strict';
const { createHmac } = require('node:crypto');
const { config, deriveKey } = require('../config');

const RECENT_AUTH_MS = 15 * 60 * 1000;
const sqlTime = value => new Date(value).toISOString().slice(0, 19).replace('T', ' ');
const utcMillis = value => value ? Date.parse(`${value.replace(' ', 'T')}Z`) : NaN;
const mfaRequired = profile => config.mfaRequiredRoles.includes(profile.role);
const quickMfaRequired = profile => mfaRequired(profile) || ['bishop', 'admin'].includes(profile.role);

function accountRestrictions(profile, session) {
  const restrictions = [];
  if (profile.must_change_password) restrictions.push('password_change');
  if (mfaRequired(profile) && !profile.mfa_enabled) restrictions.push('mfa_setup');
  if (!profile.quick_pin_hash && session?.full_auth_at) restrictions.push('pin_setup');
  return restrictions;
}

function recentlyAuthenticated(profile, session, now = Date.now()) {
  const age = now - utcMillis(session?.full_auth_at);
  return age >= 0 && age < RECENT_AUTH_MS && (!profile.mfa_enabled || Boolean(session.mfa_passed));
}

function credentialState(profile) {
  return createHmac('sha256', deriveKey('quick-login-credential-state-v1'))
    .update(JSON.stringify([profile.id, profile.role, profile.password_hash, Boolean(profile.mfa_enabled), profile.mfa_secret_enc, profile.deactivated_at]))
    .digest();
}

module.exports = { sqlTime, utcMillis, quickMfaRequired, accountRestrictions, recentlyAuthenticated, credentialState };
