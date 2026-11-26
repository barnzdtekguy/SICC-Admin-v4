'use strict';
const { config } = require('../config');
const { publicProfile } = require('../middleware');
const { accountRestrictions, recentlyAuthenticated } = require('./auth-policy');

function sessionPayload(profile, session) {
  return {
    user: { id: profile.id, email: profile.email },
    profile: publicProfile(profile),
    restrictions: accountRestrictions(profile, session),
    quick_login: { pin_configured: Boolean(profile.quick_pin_hash), recent_full_auth: recentlyAuthenticated(profile, session) },
    welcome_tour_pending: profile.welcome_tour_done_at === null,
    session: { expires_at: session?.expires_at || null, remember: Boolean(session?.remember), idle_minutes: config.session.idleMinutes },
  };
}

module.exports = { sessionPayload };
