'use strict';
const express = require('express');
const { asyncRoute: route, sendData: ok } = require('../http');
const { secured, requirePerm, redInviteLimiter, redSignupLimiter, exportLimiter } = require('../middleware');
const { audit } = require('../lib/audit');
const { COOKIE_NAME, cookieOptions } = require('../lib/sessions');
const { sessionPayload } = require('../lib/session-response');
const invites = require('../lib/red-invites');
const souls = require('../lib/red-souls');
const { getTeamsBoard } = require('../lib/red-board');
const reports = require('../lib/red-reports');
const command = require('../lib/red-command');
const { toCsv } = require('../lib/csv');
const { watchTeam } = require('../lib/red-live');

const signed = express.Router();
const publicInvites = express.Router();
const manage = [...secured, requirePerm('red.manage')];
const participate = [...secured, requirePerm('red.participate')];
const lead = [...secured, requirePerm('red.team.manage')];
const soulRead = [...secured, requirePerm('red.souls.read')];

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
signed.get('/admin/command', ...manage, route(async (req, res) => ok(res, await command.getCommand(req))));
signed.get('/admin/teams/:id', ...manage, route(async (req, res) => ok(res, await command.getTeamDetail(req))));
signed.get('/admin/reports.csv', ...manage, exportLimiter, route(async (req, res) => {
  const rows = await command.exportReports(req);
  const columns = [
    ['team', 'Team'], ['month', 'Report month'], ['status', 'Report status'], ['due', 'Due date'],
    ['submitted_on', 'Submitted on'], ['reported_total', 'Reported souls'], ['joined', 'Team members'],
    ['current', 'Current monthly count'], ['target', 'Current monthly target'], ['campaign_total', 'Campaign total'],
  ].map(([key, label]) => ({ key, label }));
  return res.attachment('operation-red-reports.csv').type('text/csv').send(toCsv(columns, rows));
}));
signed.post('/admin/teams/:id/deactivate', ...manage, route(async (req, res) => ok(res, await invites.deactivateTeam(req))));
signed.get('/team', ...participate, route(async (req, res) => ok(res, await invites.getOwnTeam(req))));
signed.get('/team/updates', ...participate, route(async (req, res) => {
  const team = await invites.ownTeam(null, req);
  watchTeam(team.id, req.profile.id, res);
}));
signed.get('/team/join-link', ...lead, route(async (req, res) => ok(res, await invites.readJoinLink(req))));
signed.post('/team/join-link', ...lead, route(async (req, res) => ok(res, await invites.rotateJoinLink(req), 201)));
signed.get('/dashboard', ...participate, route(async (req, res) => ok(res, await souls.getDashboard(req))));
signed.get('/teams-board', ...participate, route(async (req, res) => ok(res, await getTeamsBoard(req))));
signed.get('/souls', ...participate, route(async (req, res) => ok(res, await souls.listSouls(req))));
signed.post('/souls', ...participate, route(async (req, res) => {
  const data = await souls.createSoul(req);
  return ok(res, data, data.replayed ? 200 : 201);
}));
signed.get('/souls/:id', ...soulRead, route(async (req, res) => ok(res, await souls.soulDetail(req))));
signed.post('/souls/:id/stage', ...soulRead, route(async (req, res) => ok(res, await souls.changeStage(req))));
signed.post('/souls/:id/invalidate', ...manage, route(async (req, res) => ok(res, await souls.invalidateSoul(req))));
signed.get('/reports', ...lead, route(async (req, res) => ok(res, await reports.getReports(req))));
signed.get('/reports/:month', ...lead, route(async (req, res) => ok(res, await reports.prepareReport(req))));
signed.post('/reports/:month', ...lead, route(async (req, res) => {
  const data = await reports.submitReport(req);
  return ok(res, data, data.replayed ? 200 : 201);
}));

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
