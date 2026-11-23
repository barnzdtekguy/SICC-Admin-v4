'use strict';
const express = require('express');
const { asyncRoute: route, sendData: ok } = require('../http');
const { secured, requirePerm, redInviteLimiter, redSignupLimiter } = require('../middleware');
const { audit } = require('../lib/audit');
const { COOKIE_NAME, cookieOptions } = require('../lib/sessions');
const { sessionPayload } = require('../lib/session-response');
const invites = require('../lib/red-invites');

const signed = express.Router();
const publicInvites = express.Router();
const manage = [...secured, requirePerm('red.manage')];
const participate = [...secured, requirePerm('red.participate')];
const lead = [...secured, requirePerm('red.team.manage')];

signed.get('/settings', ...manage, route(async (req, res) => {
  const settings = await invites.getSettings();
  await audit(req, { action: 'red.settings_viewed', entity_type: 'red_settings', entity_id: '1' });
  return ok(res, settings);
}));
signed.patch('/settings', ...manage, route(async (req, res) => ok(res, await invites.saveSettings(req))));
signed.get('/leader-invites', ...manage, route(async (req, res) => ok(res, await invites.listLeaderInvites(req))));
signed.post('/leader-invites', ...manage, route(async (req, res) => ok(res, await invites.createLeaderInvite(req), 201)));
signed.get('/leader-invites/:id', ...manage, route(async (req, res) => ok(res, await invites.readLeaderInvite(req))));
signed.post('/leader-invites/:id/revoke', ...manage, route(async (req, res) => ok(res, await invites.revokeLeaderInvite(req))));
signed.post('/leader-invites/:id/regenerate', ...manage, route(async (req, res) => ok(res, await invites.createLeaderInvite(req, true), 201)));
signed.get('/admin/teams', ...manage, route(async (req, res) => ok(res, await invites.listTeams(req))));
signed.post('/admin/teams/:id/deactivate', ...manage, route(async (req, res) => ok(res, await invites.deactivateTeam(req))));
signed.get('/team', ...participate, route(async (req, res) => ok(res, await invites.getOwnTeam(req))));
signed.get('/team/join-link', ...lead, route(async (req, res) => ok(res, await invites.readJoinLink(req))));
signed.post('/team/join-link', ...lead, route(async (req, res) => ok(res, await invites.rotateJoinLink(req), 201)));

for (const [path, kind] of [['leader-invites', 'leader'], ['team-invites', 'member']]) {
  publicInvites.post(`/${path}/inspect`, redInviteLimiter, route(async (req, res) => ok(res, await invites.inspectInvite(req, kind))));
  publicInvites.post(`/${path}/accept`, redSignupLimiter, route(async (req, res) => {
    const { profile, session } = await invites.acceptInvite(req, kind);
    res.cookie(COOKIE_NAME, session.token, cookieOptions(session.ttl));
    return ok(res, sessionPayload(profile, session), 201);
  }));
}
publicInvites.post('/leader-invites/decline', redInviteLimiter, route(async (req, res) => ok(res, await invites.declineInvite(req))));

module.exports = { signed, publicInvites };
