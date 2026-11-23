'use strict';
const { config } = require('../config');
const { publicProfile } = require('../middleware');

function sessionPayload(profile, session) {
  const restrictions = [];
  if (profile.must_change_password) restrictions.push('password_change');
  if (config.mfaRequiredRoles.includes(profile.role) && !profile.mfa_enabled) restrictions.push('mfa_setup');
  return {
    user: { id: profile.id, email: profile.email },
    profile: publicProfile(profile),
    restrictions,
    welcome_tour_pending: profile.welcome_tour_done_at === null,
    session: { expires_at: session?.expires_at || null, remember: Boolean(session?.remember), idle_minutes: config.session.idleMinutes },
  };
}

module.exports = { sessionPayload };
