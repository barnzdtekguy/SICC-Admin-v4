'use strict';
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const h = require('./helpers');
const { query } = require('../db');

const adminRoutes = '/red/leader-invites';
const leaderInvite = '/public/red/leader-invites';
const teamInvite = '/public/red/team-invites';
const tokenOf = data => data.path.split('#')[1];
const newPhone = () => `080${crypto.randomInt(10000000, 100000000)}`;
const signup = (name, extra = {}) => ({ name, phone: newPhone(), password: h.PASSWORD, ...extra });
const accept = async (agent, prefix, token, fields) => {
  const res = await h.api(agent, 'post', `${prefix}/accept`, { token, ...fields });
  if (res.status === 201) {
    assert.deepEqual(res.body.data.restrictions, ['pin_setup']);
    assert.equal((await h.api(agent, 'get', '/red/team')).body.code, 'pin_setup');
    await h.completePinSetup(agent);
  }
  return res;
};
const inspect = (agent, prefix, token) => h.api(agent, 'post', `${prefix}/inspect`, { token });
const dataOf = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body.data; };
const invalidShape = res => { assert.equal(res.status, 404); return { error: res.body.error, code: res.body.code }; };

let app, admin, bishop, leader, member, leaderInfo, memberInfo, team;
const guest = () => h.request.agent(app);
const generate = async (capacity, manager = admin) => dataOf(await h.api(manager, 'post', adminRoutes, capacity === undefined ? {} : { capacity }), 201);
before(async () => {
  app = await h.setup();
  admin = await h.loginAgent(await h.makeUser('admin'));
  bishop = await h.loginAgent(await h.makeUser('bishop'));
});
after(h.close);

test('manage settings with equal permissions and keep the approved campaign dates', async () => {
  const settings = dataOf(await h.api(admin, 'get', '/red/settings'));
  assert.deepEqual(dataOf(await h.api(bishop, 'get', '/red/settings')), settings);
  assert.deepEqual(settings, {
    goal: 3000, monthly_target: 3, team_size: 5, campaign_start: '2026-11-20', campaign_end: '2027-04-22',
    final_report_opens: '2027-04-22', report_open_day: 25, report_close_day: 5,
    leader_expiry_hours: 48, leader_link_capacity: 10, member_expiry_days: 7,
  });
  assert.equal((await h.api(admin, 'patch', '/red/settings', { final_report_opens: '2027-04-21' })).status, 400);
  const changed = dataOf(await h.api(bishop, 'patch', '/red/settings', { monthly_target: 4 }));
  assert.equal(changed.monthly_target, 4);
  assert.equal(dataOf(await h.api(admin, 'patch', '/red/settings', { monthly_target: 3 })).monthly_target, 3);
  assert.equal((await h.api(admin, 'post', adminRoutes, { capacity: 2 })).status, 400);
});

test('shared staff contact numbers remain valid and cannot be used for R.E.D. signup', async () => {
  const phone = newPhone();
  for (const format of [phone, `+234 ${phone.slice(1)}`]) {
    const createStaff = { name: 'Church Staff', email: `staff-${h.uniq()}@test.local`, role: 'pastor', phone: format, password: h.PASSWORD };
    const staff = dataOf(await h.api(admin, 'post', '/profiles', createStaff), 201);
    assert.equal(staff.phone, format);
    assert.equal(staff.phone_login, undefined);
    assert.equal(staff.red_phone_login, undefined);
  }
  const invite = await generate(1);
  const duplicate = await accept(guest(), leaderInvite, tokenOf(invite), signup('New Leader', { phone }));
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'red_account_unavailable');
  assert.equal(dataOf(await h.api(admin, 'get', `${adminRoutes}/${invite.id}`)).used, 0);
});

test('leader invites hash tokens, count declines, and grant the final place only once', async () => {
  const defaultInvite = await generate(undefined, bishop);
  assert.equal(defaultInvite.capacity, 10);
  const invitation = await generate(1);
  const token = tokenOf(invitation);
  assert.equal(Buffer.from(token, 'base64url').length, 32);
  const [row] = await query('SELECT token_hash, TIMESTAMPDIFF(HOUR, created_at, expires_at) AS hours FROM red_invites WHERE id = ?', [invitation.id]);
  assert.equal(row.hours, 48);
  assert.deepEqual(row.token_hash, crypto.createHash('sha256').update(token).digest());
  assert.equal((await guest().post(`/api${leaderInvite}/inspect`).send({ token })).status, 403);
  assert.equal((await guest().post(`/api${leaderInvite}/inspect`).set('X-SICC-Client', 'web').set('Origin', 'https://untrusted.test').send({ token })).status, 403);
  assert.deepEqual(dataOf(await inspect(guest(), leaderInvite, token)), { kind: 'leader' });
  assert.deepEqual(dataOf(await h.api(guest(), 'post', `${leaderInvite}/decline`, { token })), { recorded: true });

  const candidates = [guest(), guest()];
  const forms = ['Ada Leader', 'Bola Leader'].map(name => signup(name, { role: 'bishop', team_id: 'untrusted' }));
  const results = await Promise.all(candidates.map((agent, index) => accept(agent, leaderInvite, token, forms[index])));
  assert.deepEqual(results.map(res => res.status).sort(), [201, 404], JSON.stringify(results.map(res => res.body)));
  const winner = results.findIndex(res => res.status === 201);
  leader = candidates[winner];
  leaderInfo = { ...dataOf(results[winner], 201).profile, localPhone: forms[winner].phone };
  assert.equal(leaderInfo.role, 'red_leader');
  assert.equal(leaderInfo.email, null);
  assert.equal(dataOf(await h.api(leader, 'get', '/auth/me')).profile.id, leaderInfo.id);
  team = dataOf(await h.api(leader, 'get', '/red/team'));
  assert.equal(team.joined, 1);
  assert.equal(team.seat_limit, 5);
  assert.equal(team.members[0].id, leaderInfo.id);
  const result = dataOf(await h.api(bishop, 'get', `${adminRoutes}/${invitation.id}`));
  assert.equal(result.status, 'Full');
  assert.equal(result.used, 1);
  assert.equal(result.declines, 1);
  assert.equal(result.joined[0].name, leaderInfo.name);
  assert.ok(result.joined[0].responded_at);
  assert.equal(result.path, undefined);

  const expired = await generate(5);
  await query('UPDATE red_invites SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND) WHERE id = ?', [expired.id]);
  const revoked = await generate(5);
  dataOf(await h.api(bishop, 'post', `${adminRoutes}/${revoked.id}/revoke`));
  const same = invalidShape(await inspect(guest(), leaderInvite, 'x'.repeat(43)));
  for (const unavailable of [invitation, expired, revoked]) {
    assert.deepEqual(invalidShape(await inspect(guest(), leaderInvite, tokenOf(unavailable))), same);
  }
  const replacement = dataOf(await h.api(admin, 'post', `${adminRoutes}/${defaultInvite.id}/regenerate`, {}), 201);
  assert.equal(replacement.capacity, 10);
  assert.notEqual(replacement.path, defaultInvite.path);
  assert.deepEqual(invalidShape(await inspect(guest(), leaderInvite, tokenOf(defaultInvite))), same);
  const duplicate = await accept(guest(), leaderInvite, tokenOf(replacement), signup('Other Leader', { phone: `+234 ${leaderInfo.localPhone.slice(1)}` }));
  assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));
  assert.equal(duplicate.body.code, 'red_account_unavailable');
  assert.equal(dataOf(await h.api(admin, 'get', `${adminRoutes}/${replacement.id}`)).used, 0);
});

test('join belongs to the link’s team, rotation invalidates the old link, and four joins fill a team', async () => {
  const initial = dataOf(await h.api(leader, 'get', '/red/team/join-link'));
  assert.equal(initial.capacity, 4);
  const [row] = await query('SELECT TIMESTAMPDIFF(DAY, created_at, expires_at) AS days FROM red_invites WHERE id = ?', [initial.id]);
  assert.equal(row.days, 7);
  const token = tokenOf(initial);
  const expiringTeamLeader = guest();
  const extra = await generate(1);
  dataOf(await accept(expiringTeamLeader, leaderInvite, tokenOf(extra), signup('Independent Leader')), 201);
  const otherLink = dataOf(await h.api(expiringTeamLeader, 'get', '/red/team/join-link'));
  await query('UPDATE red_invites SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND) WHERE id = ?', [otherLink.id]);
  const same = invalidShape(await inspect(guest(), teamInvite, 'x'.repeat(43)));
  assert.deepEqual(invalidShape(await inspect(guest(), teamInvite, tokenOf(otherLink))), same);
  assert.deepEqual(dataOf(await inspect(guest(), teamInvite, token)),
    { kind: 'member', leader_name: leaderInfo.name, joined: 1, seat_limit: 5 });
  member = guest();
  const fields = signup('Chioma Member', { team_id: 'another-team', role: 'admin' });
  memberInfo = dataOf(await accept(member, teamInvite, token, fields), 201).profile;
  assert.equal(memberInfo.role, 'red_member');
  assert.equal(memberInfo.email, null);
  assert.deepEqual(dataOf(await h.api(member, 'get', '/red/team')), {
    id: team.id, leader_name: leaderInfo.name, joined: 2, seat_limit: 5, deactivated_at: null,
  });
  const duplicate = await accept(guest(), teamInvite, token, signup('Another Person', { phone: leaderInfo.localPhone }));
  assert.equal(duplicate.status, 409);
  const replacement = dataOf(await h.api(leader, 'post', '/red/team/join-link', { team_id: 'another-team' }), 201);
  assert.equal(replacement.capacity, 3);
  assert.deepEqual(invalidShape(await inspect(guest(), teamInvite, token)), same);
  const activeToken = tokenOf(replacement);
  for (const name of ['David Member', 'Ebuka Member']) dataOf(await accept(guest(), teamInvite, activeToken, signup(name)), 201);
  const final = await Promise.all(['Favour Member', 'Grace Member'].map(name => accept(guest(), teamInvite, activeToken, signup(name))));
  assert.deepEqual(final.map(res => res.status).sort(), [201, 404], JSON.stringify(final.map(res => res.body)));
  const full = dataOf(await h.api(leader, 'get', '/red/team'));
  assert.equal(full.joined, 5);
  assert.equal(full.members.length, 5);
  assert.deepEqual(invalidShape(await inspect(guest(), teamInvite, activeToken)), same);
  assert.equal((await h.api(leader, 'post', '/red/team/join-link')).status, 409);
  const phone = `+234 ${fields.phone.slice(1, 4)}-${fields.phone.slice(4)}`;
  const reauth = dataOf(await h.api(guest(), 'post', '/auth/login', { identifier: phone, password: fields.password }));
  assert.equal(reauth.profile.id, memberInfo.id);
  assert.deepEqual(reauth.restrictions, []);
  assert.equal((await h.api(member, 'get', '/red/team/join-link')).status, 403);
  assert.equal((await h.api(member, 'post', '/red/team/join-link')).status, 403);
  assert.equal((await h.api(leader, 'post', `/red/admin/teams/${team.id}/deactivate`)).status, 403);
  assert.equal((await h.api(admin, 'patch', `/profiles/${leaderInfo.id}`, { role: 'pastor' })).status, 404);
});

const privateChurchRoutes = {
  get: ['/profiles', '/directory', '/members', '/members/id', '/members/id/timeline', '/search?q=name', '/follow-ups',
    '/attendance', '/corrections', '/programmes', '/checkin/session', '/programme-attendance-records', '/meta/departments',
    '/meta/kdf-areas', '/activity-logs', '/audit', '/audit/verify', '/assignments', '/sms-config', '/messages/status', '/messages/log',
    '/reports/overview', '/exports/members.csv', '/exports/attendance.csv', '/exports/audit.csv', '/reports/submitted', '/brief'],
  post: ['/profiles', '/profiles/id/reset-password', '/profiles/id/reset-mfa', '/profiles/id/unlock', '/members', '/members/id/restore',
    '/members/id/anonymize', '/follow-ups', '/attendance', '/attendance/id/verify', '/corrections', '/corrections/id/approve',
    '/corrections/id/reject', '/programmes', '/programme-attendance-records', '/activity-logs', '/assignments', '/messages/sms',
    '/messages/whatsapp', '/reports/submit', '/notifications/read-all'],
  patch: ['/profiles/id', '/members/id', '/follow-ups/id', '/attendance/id', '/programmes/id', '/assignments/id'],
  delete: ['/profiles/id', '/members/id', '/assignments/id'],
  put: ['/sms-config'],
};

test('R.E.D. roles fail closed across the private church API and retain self-service', async () => {
  for (const [agent, role] of [[leader, 'red_leader'], [member, 'red_member']]) {
    for (const [method, paths] of Object.entries(privateChurchRoutes)) {
      for (const path of paths) assert.equal((await h.api(agent, method, path)).status, 403, `${role}: ${method} ${path}`);
    }
    for (const path of ['/auth/me', '/auth/sessions', '/notifications', '/push/public-key']) {
      assert.equal((await h.api(agent, 'get', path)).status, 200, `${role}: GET ${path}`);
    }
    for (const path of ['/red/settings', adminRoutes, '/red/admin/teams']) {
      assert.equal((await h.api(agent, 'get', path)).status, 403, `${role}: GET ${path}`);
    }
  }
  const staff = dataOf(await h.api(admin, 'get', '/profiles'));
  assert.equal(staff.some(person => ['red_leader', 'red_member'].includes(person.role)), false);
});

test('deactivation revokes existing sessions and the audit chain remains valid', async () => {
  const deactivated = dataOf(await h.api(bishop, 'post', `/red/admin/teams/${team.id}/deactivate`));
  assert.ok(deactivated.deactivated_at);
  assert.equal((await h.api(leader, 'get', '/auth/me')).status, 401);
  assert.equal((await h.api(member, 'get', '/red/team')).status, 401);
  const [entry] = await query("SELECT role FROM activity_logs WHERE action = 'red.member_signup' AND user_id = ?", [memberInfo.id]);
  assert.equal(entry.role, 'red_member');
  const audit = dataOf(await h.api(bishop, 'get', '/audit/verify'));
  assert.equal(audit.ok, true, JSON.stringify(audit));
});
