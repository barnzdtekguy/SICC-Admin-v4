'use strict';
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomInt } = require('node:crypto');
const h = require('./helpers');
const { query } = require('../db');
const { addDays } = require('../http');
const { todayInLagos, monthOf, shiftMonth } = require('../lib/red-calendar');
const { weeklyRedReminders } = require('../lib/red-reminders');

const dataOf = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body.data; };
const phone = () => `080${randomInt(10000000, 100000000)}`;
const token = invite => invite.path.split('#')[1];
const createForm = (extra = {}) => ({ id: randomUUID(), full_name: 'Tomi New Convert', address: '23 Mission Road', consent: true, ...extra });
let app, admin, bishop, leader, member, otherLeader, leaderProfile, memberProfile, team, originalSettings, initialInvite, submittedTeamId;

async function onboard(invite, kind, name) {
  const agent = h.request.agent(app);
  const signedIn = dataOf(await h.api(agent, 'post', `/public/red/${kind}-invites/accept`, { token: token(invite), name, phone: phone(), password: h.PASSWORD }), 201);
  return { agent, profile: signedIn.profile };
}

before(async () => {
  app = await h.setup();
  admin = await h.loginAgent(await h.makeUser('admin'));
  bishop = await h.loginAgent(await h.makeUser('bishop'));
  originalSettings = dataOf(await h.api(admin, 'get', '/red/settings'));
  const today = todayInLagos();
  const end = addDays(today, 120);
  dataOf(await h.api(admin, 'patch', '/red/settings', { campaign_start: addDays(today, -20), campaign_end: end, final_report_opens: end }));
  initialInvite = dataOf(await h.api(admin, 'post', '/red/leader-invites', { capacity: 5 }), 201);
  ({ agent: leader, profile: leaderProfile } = await onboard(initialInvite, 'leader', 'Test Team Leader'));
  const join = dataOf(await h.api(leader, 'get', '/red/team/join-link'));
  ({ agent: member, profile: memberProfile } = await onboard(join, 'team', 'Test Team Member'));
  ({ agent: otherLeader } = await onboard(initialInvite, 'leader', 'Independent Team Leader'));
  team = dataOf(await h.api(leader, 'get', '/red/team'));
});

after(async () => {
  if (originalSettings) dataOf(await h.api(admin, 'patch', '/red/settings', originalSettings));
  await h.close();
});

test('souls enforce consent, account ownership, phone and email uniqueness, and offline replay', async () => {
  const contact = phone();
  const email = `convert-${h.uniq()}@test.local`;
  const payload = createForm({ phone: contact, email: email.toUpperCase(), winner_id: 'forged', team_id: 'forged', stage: 'deployed' });
  assert.equal((await h.api(member, 'post', '/red/souls', { ...payload, consent: false })).status, 400);
  const wrongUser = await member.post('/api/red/souls').set('X-SICC-Client', 'web').set('X-SICC-Queue-Owner', leaderProfile.id).send(payload);
  assert.equal(wrongUser.status, 403);
  const created = await Promise.all([h.api(member, 'post', '/red/souls', payload), h.api(member, 'post', '/red/souls', payload)]);
  assert.deepEqual(created.map(res => res.status).sort(), [200, 201], JSON.stringify(created.map(res => res.body)));
  const detail = dataOf(await h.api(member, 'get', `/red/souls/${payload.id}`));
  assert.equal(detail.winner_id, memberProfile.id);
  assert.equal(detail.team_id, team.id);
  assert.equal(detail.stage, 'recorded');
  assert.equal(detail.email, email);
  assert.equal(detail.history.length, 1);
  for (const contactData of [{ phone: `+234 ${contact.slice(1)}` }, { email }, { id: payload.id }]) {
    assert.equal((await h.api(otherLeader, 'post', '/red/souls', createForm(contactData))).body.code, 'red_soul_duplicate');
  }
  assert.equal((await h.api(otherLeader, 'get', `/red/souls/${payload.id}`)).status, 404);
  assert.equal((await h.api(member, 'get', '/red/souls?scope=team')).status, 403);
  assert.equal(dataOf(await h.api(leader, 'get', '/red/souls?scope=team')).items[0].id, payload.id);
  assert.equal(dataOf(await h.api(leader, 'get', '/red/souls')).items.length, 0);
});

test('only the winner advances one stage at a time and administrative overrides and invalidation are audited', async () => {
  const s = createForm();
  dataOf(await h.api(member, 'post', '/red/souls', s), 201);
  const path = `/red/souls/${s.id}`;
  assert.equal((await h.api(leader, 'post', `${path}/stage`, { stage: 'under_training' })).status, 403);
  assert.equal((await h.api(otherLeader, 'post', `${path}/stage`, { stage: 'under_training' })).status, 404);
  assert.equal((await h.api(member, 'post', `${path}/stage`, { stage: 'equipped' })).status, 400);
  for (const stage of ['under_training', 'completed_training', 'equipped', 'deployed']) dataOf(await h.api(member, 'post', `${path}/stage`, { stage }));
  assert.equal((await h.api(member, 'post', `${path}/stage`, { stage: 'recorded' })).status, 400);
  dataOf(await h.api(member, 'post', `${path}/stage`, { stage: 'equipped', reason: 'Deployment training was rescheduled.' }));
  assert.equal((await h.api(bishop, 'post', `${path}/stage`, { stage: 'recorded' })).status, 400);
  dataOf(await h.api(bishop, 'post', `${path}/stage`, { stage: 'recorded', reason: 'Corrected the training record.' }));
  const details = dataOf(await h.api(leader, 'get', path));
  assert.deepEqual(details.history.map(event => event.stage), [
    'recorded', 'under_training', 'completed_training', 'equipped', 'deployed', 'equipped', 'recorded',
  ]);
  const before = dataOf(await h.api(member, 'get', '/red/dashboard'));
  assert.equal((await h.api(member, 'post', `${path}/invalidate`, { reason: 'Invalid recording' })).status, 403);
  dataOf(await h.api(admin, 'post', `${path}/invalidate`, { reason: 'Invalid recording' }));
  const after = dataOf(await h.api(member, 'get', '/red/dashboard'));
  assert.equal(after.current, before.current - 1);
  assert.equal(after.target, 3);
  assert.equal(dataOf(await h.api(leader, 'get', '/red/dashboard')).team_target, 6);
  const [invalidated] = await query("SELECT detail FROM activity_logs WHERE action = 'red.soul_invalidated' AND entity_id = ?", [s.id]);
  assert.equal(invalidated.detail, 'Invalid recording');
});

test('the Teams Board contains standings and trends without another team’s records', async () => {
  const form = createForm({ full_name: 'PRIVATE OTHER TEAM NAME', email: `private-${h.uniq()}@test.local` });
  dataOf(await h.api(otherLeader, 'post', '/red/souls', form), 201);
  const board = dataOf(await h.api(member, 'get', '/red/teams-board'));
  assert.equal(board.goal, 3000);
  assert.ok(board.total >= 2);
  const other = board.teams.find(row => row.name === 'Independent Team Leader' && row.current === 1);
  assert.ok(other);
  assert.equal(other.target, 3);
  assert.equal(other.trend.at(-1), 1);
  assert.equal(board.teams.find(row => row.id === team.id).target, 6);
  assert.equal(JSON.stringify(board).includes(form.full_name), false);
  assert.equal(JSON.stringify(board).includes(form.email), false);
  assert.equal((await h.api(h.request.agent(app), 'get', '/red/teams-board')).status, 401);
});

test('records submitted early roll forward to the next month for that team', async () => {
  const today = todayInLagos();
  const month = monthOf(today);
  const reportId = randomUUID();
  await query(`INSERT INTO red_reports (id, team_id, leader_id, report_month, submitted_at, submitted_on, summary_json, created_members, linked_members)
    VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), ?, ?, 0, 0)`, [reportId, team.id, leaderProfile.id, month, today, JSON.stringify({ total: 0, target: 6, members: [] })]);
  try {
    const form = createForm();
    dataOf(await h.api(member, 'post', '/red/souls', form), 201);
    const detail = dataOf(await h.api(member, 'get', `/red/souls/${form.id}`));
    assert.equal(detail.report_month, shiftMonth(month, 1));
    assert.equal(detail.recorded_on, today);
  } finally { await query('DELETE FROM red_reports WHERE id = ?', [reportId]); }
});

test('final report preview, permanent submission, and deduplicated membership import', async () => {
  const today = todayInLagos();
  const month = monthOf(today);
  const invite = dataOf(await h.api(bishop, 'post', '/red/leader-invites', { capacity: 1 }), 201);
  const { agent: reporter, profile } = await onboard(invite, 'leader', 'Final Report Leader');
  const finalTeam = dataOf(await h.api(reporter, 'get', '/red/team'));
  submittedTeamId = finalTeam.id;
  const join = dataOf(await h.api(reporter, 'get', '/red/team/join-link'));
  const { agent: winner, profile: winnerProfile } = await onboard(join, 'team', 'Final Report Member');
  const teammates = [];
  for (const name of ['Test Convert Recorder One', 'Test Convert Recorder Two', 'Test Convert Recorder Three']) {
    teammates.push(await onboard(join, 'team', name));
  }
  assert.equal(dataOf(await h.api(reporter, 'get', '/red/team')).joined, 5);
  const path = `/red/reports/${month}`;
  assert.equal((await h.api(winner, 'get', path)).status, 403);
  dataOf(await h.api(bishop, 'patch', '/red/settings', { campaign_end: today, final_report_opens: addDays(today, 1) }));
  assert.equal((await h.api(reporter, 'get', path)).body.code, 'red_report_closed');
  dataOf(await h.api(bishop, 'patch', '/red/settings', { final_report_opens: today }));
  assert.ok(dataOf(await h.api(reporter, 'get', '/red/reports')).available.some(window => window.final));

  const existingPhone = phone();
  const existing = dataOf(await h.api(admin, 'post', '/members', { first_name: 'Existing', last_name: 'Member', phone: existingPhone, consent_given: true, status: 'Active Member' }), 201);
  const linked = createForm({ full_name: 'Existing Member', phone: `+234 ${existingPhone.slice(1)}` });
  const added = createForm({ full_name: 'Imported Member', email: `import-${h.uniq()}@test.local` });
  const invalid = createForm({ full_name: 'Invalid Record' });
  for (const form of [linked, added, invalid]) dataOf(await h.api(winner, 'post', '/red/souls', form), 201);
  const remainingWinners = [{ agent: reporter }, ...teammates];
  for (const [index, { agent }] of remainingWinners.entries()) {
    const form = createForm({ full_name: `Additional Convert ${index}` });
    dataOf(await h.api(agent, 'post', '/red/souls', form), 201);
    dataOf(await h.api(agent, 'post', `/red/souls/${form.id}/stage`, { stage: 'under_training' }));
  }
  dataOf(await h.api(winner, 'post', `/red/souls/${added.id}/stage`, { stage: 'under_training' }));
  for (const { agent } of [...remainingWinners, { agent: winner }]) {
    const standing = dataOf(await h.api(agent, 'get', '/red/teams-board')).teams.find(row => row.id === finalTeam.id);
    assert.equal(standing.target, 15);
    assert.equal(standing.current, 7);
  }
  const old = dataOf(await h.api(reporter, 'get', path));
  assert.equal(old.summary.total, 7);
  dataOf(await h.api(admin, 'post', `/red/souls/${invalid.id}/invalidate`, { reason: 'Confirmed invalid record.' }));
  assert.equal((await h.api(reporter, 'post', path, { revision: old.revision })).body.code, 'red_report_changed');
  assert.equal((await h.api(winner, 'post', path, { revision: old.revision })).status, 403);
  const preview = dataOf(await h.api(reporter, 'get', path));
  assert.deepEqual(preview.summary.members.map(person => person.total).sort(), [1, 1, 1, 1, 2]);
  assert.equal(preview.summary.target, 15);

  const body = { revision: preview.revision, team_id: team.id };
  const results = await Promise.all([h.api(reporter, 'post', path, body), h.api(reporter, 'post', path, body)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 201], JSON.stringify(results.map(result => result.body)));
  const submitted = results.find(result => result.status === 201).body.data;
  assert.equal(submitted.created_members, 5);
  assert.equal(submitted.linked_members, 1);
  assert.equal(results[0].body.data.id, results[1].body.data.id);
  const [imported] = await query('SELECT * FROM members WHERE red_soul_id = ?', [added.id]);
  assert.equal(imported.email, added.email);
  assert.equal(imported.status, 'New Convert');
  assert.equal(imported.spiritual_status, 'Salvation');
  assert.equal(imported.kdf_area, 'General Area');
  assert.equal(imported.consent_given, 1);
  assert.equal(imported.red_winner_id, winnerProfile.id);
  assert.equal(imported.red_team_id, finalTeam.id);
  assert.equal(imported.registered_by, profile.id);
  const [existingAfter] = await query('SELECT * FROM members WHERE red_soul_id = ?', [linked.id]);
  assert.equal(existingAfter.id, existing.id);
  assert.equal(existingAfter.status, 'Active Member');
  assert.equal((await query('SELECT id FROM members WHERE red_soul_id = ?', [invalid.id])).length, 0);
  assert.equal(dataOf(await h.api(reporter, 'get', '/red/reports')).available.length, 0);
  assert.equal((await h.api(winner, 'post', '/red/souls', createForm())).body.code, 'red_entry_closed');
  assert.equal((await h.api(winner, 'post', '/red/souls', added)).status, 200);
});

test('Bishop and Admin see live submissions, overdue reports, team details, and the report export', async () => {
  const today = todayInLagos();
  const current = dataOf(await h.api(admin, 'get', `/red/admin/command?month=${monthOf(today)}`));
  assert.equal(current.teams.find(row => row.id === submittedTeamId).report.status, 'submitted');
  assert.equal(current.teams.find(row => row.id === team.id).report.status, 'pending');
  assert.equal(current.stages.length, 5);
  const records = dataOf(await h.api(bishop, 'get', `/red/admin/teams/${submittedTeamId}`));
  assert.equal(records.souls.length, 7);
  assert.equal(records.reports[0].summary.total, 6);
  assert.equal(records.members.length, 5);
  for (const user of [member, leader]) {
    for (const path of ['/red/admin/command', `/red/admin/teams/${submittedTeamId}`, '/red/admin/reports.csv']) {
      assert.equal((await h.api(user, 'get', path)).status, 403);
    }
  }

  const end = addDays(today, 120);
  dataOf(await h.api(bishop, 'patch', '/red/settings', { campaign_start: addDays(today, -120), campaign_end: end, final_report_opens: end }));
  const month = shiftMonth(today, -2);
  const other = dataOf(await h.api(otherLeader, 'get', '/red/team'));
  await query('UPDATE red_teams SET created_at = ? WHERE id IN (?, ?)', [`${addDays(today, -110)} 12:00:00`, team.id, other.id]);
  const [lateTeam] = await query('SELECT leader_id FROM red_teams WHERE id = ?', [other.id]);
  await query(`INSERT INTO red_reports (id, team_id, leader_id, report_month, submitted_at, submitted_on, summary_json, created_members, linked_members)
    VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), ?, ?, 0, 0)`, [randomUUID(), other.id, lateTeam.leader_id, month, today, JSON.stringify({ total: 0, target: 3, members: [] })]);
  const status = dataOf(await h.api(bishop, 'get', `/red/admin/command?month=${month}`));
  assert.equal(status.teams.find(row => row.id === team.id).report.status, 'missing');
  assert.equal(status.teams.find(row => row.id === other.id).report.status, 'late');
  const csv = await h.api(admin, 'get', `/red/admin/reports.csv?month=${month}`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.text, /Independent Team Leader.*Submitted late/);
  assert.match(csv.text, /Test Team Leader.*Missing/);
  assert.doesNotMatch(csv.text, /PRIVATE OTHER TEAM NAME/);
});

test('signup, team join and report notices reach their recipients once', async () => {
  for (const manager of [admin, bishop]) {
    const inbox = dataOf(await h.api(manager, 'get', '/notifications'));
    assert.ok(inbox.items.some(item => item.type === 'red_leader_signup' && item.link === `/app/red?invite=${initialInvite.id}` && item.body.includes(leaderProfile.name)));
    const submitted = inbox.items.filter(item => item.type === 'red_report_submitted' && item.link === `/app/red?team=${submittedTeamId}`);
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0].read_at, null);
  }
  const inbox = dataOf(await h.api(leader, 'get', '/notifications'));
  const joined = inbox.items.find(item => item.type === 'red_member_join' && item.body.includes(memberProfile.name));
  assert.equal(joined.read_at, null);
  assert.equal(dataOf(await h.api(member, 'get', '/notifications')).items.some(item => item.type === 'red_leader_signup'), false);
  assert.equal(dataOf(await h.api(leader, 'get', '/notifications')).unread, inbox.unread);
  dataOf(await h.api(leader, 'post', `/notifications/${joined.id}/read`));
  assert.equal(dataOf(await h.api(leader, 'get', '/notifications')).unread, inbox.unread - 1);
});

test('weekly reminders notify active members and leaders behind pace only once per Lagos week', async () => {
  const date = shiftMonth(todayInLagos(), 1);
  const [y, m] = date.split('-');
  assert.equal(await weeklyRedReminders(new Date(`${y}-${m}-03T12:00:00Z`)), 0);
  const now = new Date(`${y}-${m}-22T12:00:00Z`);
  await Promise.all([weeklyRedReminders(now), weeklyRedReminders(now)]);
  assert.equal(await weeklyRedReminders(now), 0);
  for (const person of [leaderProfile.id, memberProfile.id]) {
    const result = await query("SELECT body FROM notifications WHERE user_id = ? AND type = 'red_pace_reminder'", [person]);
    assert.equal(result.length, 1);
    assert.match(result[0].body, /behind by/);
  }
});

test('a leader receives a team refresh after a member records a soul', async () => {
  const signedIn = await h.api(h.request.agent(app), 'post', '/auth/login', { identifier: leaderProfile.username, password: h.PASSWORD });
  assert.equal(signedIn.status, 200);
  const cookie = signedIn.headers['set-cookie'][0].split(';')[0];
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8000);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/red/team/updates`, { headers: { cookie }, signal: abort.signal });
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const stream = response.body.getReader();
    assert.match(Buffer.from((await stream.read()).value).toString(), /connected/);
    dataOf(await h.api(member, 'post', '/red/souls', createForm()), 201);
    assert.match(Buffer.from((await stream.read()).value).toString(), /event: refresh\ndata: \{\}/);
  } finally {
    clearTimeout(timer);
    abort.abort();
    await new Promise(resolve => server.close(resolve));
  }
});
