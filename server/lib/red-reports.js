'use strict';
const { randomUUID, createHash } = require('node:crypto');
const { query, queryOn } = require('../db');
const { HttpError } = require('../http');
const { audit, auditThrottled, auditTransaction } = require('./audit');
const { getSettings, ownTeam } = require('./red-invites');
const { splitTitle, splitName, identity, matchMember, lockDirectory, memberIdentities, insertMember } = require('./church-members');
const { queueRedNotice, deliverRedPush } = require('./red-notifications');
const { signalTeam } = require('./red-live');
const { todayInLagos, monthOf, shiftMonth, reportWindow, activeReportWindows, utcToLagosDate } = require('./red-calendar');

const reportEvent = (action, id, after) => ({ action: `red.report_${action}`, entity_type: 'red_report', entity_id: id, after });
const lockedClause = conn => conn ? ' FOR UPDATE' : '';
const reportView = row => ({
  id: row.id, month: row.report_month, submitted_at: row.submitted_at, submitted_on: row.submitted_on,
  summary: typeof row.summary_json === 'string' ? JSON.parse(row.summary_json) : row.summary_json,
  created_members: row.created_members, linked_members: row.linked_members, review_members: row.review_members,
});
const reportDenied = () => new HttpError(409, 'This report is outside its submission window.', { code: 'red_report_closed' });

async function nextRecordingMonth(conn, teamId, settings, today) {
  const reports = await queryOn(conn, 'SELECT report_month FROM red_reports WHERE team_id = ? FOR UPDATE', [teamId]);
  const submitted = new Set(reports.map(row => row.report_month));
  let month = monthOf(today);
  while (submitted.has(month)) month = shiftMonth(month, 1);
  if (month > monthOf(settings.campaign_end)) throw new HttpError(409, 'The final report has been submitted. Soul entry for this team is closed.', { code: 'red_entry_closed' });
  return month;
}

async function findReport(conn, teamId, month) {
  const [row] = await queryOn(conn, `SELECT * FROM red_reports WHERE team_id = ? AND report_month = ?${lockedClause(conn)}`, [teamId, month]);
  return row ? reportView(row) : null;
}

function teamEligible(team, window) {
  return utcToLagosDate(team.created_at) <= window.month_end;
}

async function getReports(req) {
  const team = await ownTeam(null, req);
  const settings = await getSettings();
  const today = todayInLagos();
  const reportRows = await query('SELECT * FROM red_reports WHERE team_id = ? ORDER BY report_month DESC', [team.id]);
  const submitted = new Set(reportRows.map(row => row.report_month));
  const available = activeReportWindows(settings, today)
    .filter(window => teamEligible(team, window) && !submitted.has(window.month));
  await auditThrottled(req, `red:reports:${req.profile.id}`, 60000, reportEvent('list_viewed', null, { team_id: team.id }));
  return { available, submitted: reportRows.map(reportView) };
}

async function buildPreview(conn, team, window, target) {
  const memberRows = await queryOn(conn, `SELECT p.id, p.name FROM red_team_members m JOIN profiles p ON p.id = m.profile_id
    WHERE m.team_id = ? AND DATE(DATE_ADD(m.joined_at, INTERVAL 1 HOUR)) <= ? ORDER BY m.joined_at, p.id`, [team.id, window.month_end]);
  const souls = await queryOn(conn, `SELECT id, winner_id, full_name, address, phone, email, consent_recorded_at FROM red_souls
    WHERE team_id = ? AND report_month = ? AND invalidated_at IS NULL ORDER BY phone, id${lockedClause(conn)}`, [team.id, window.month]);
  const count = new Map();
  for (const soul of souls) count.set(soul.winner_id, (count.get(soul.winner_id) || 0) + 1);
  const members = memberRows.map(({ id, name }) => {
    const total = count.get(id) || 0;
    return { id, name, total, target, met: total >= target };
  });
  const summary = { members, total: souls.length, target: members.length * target };
  const revision = createHash('sha256').update(JSON.stringify({ summary, ids: souls.map(soul => soul.id) })).digest('hex');
  return { summary, souls, revision };
}

async function prepareReport(req) {
  const team = await ownTeam(null, req);
  const settings = await getSettings();
  const window = reportWindow(settings, req.params.month);
  if (!window || !teamEligible(team, window)) throw reportDenied();
  const previous = await findReport(null, team.id, window.month);
  if (previous) return { submitted: previous, window };
  const today = todayInLagos();
  if (today < window.opens || today > window.closes) throw reportDenied();
  const { summary, revision } = await buildPreview(null, team, window, settings.monthly_target);
  await audit(req, reportEvent('previewed', null, { team_id: team.id, month: window.month }));
  return { window, summary, revision };
}

async function importSoul(conn, directory, soul, teamId, profile, today) {
  const match = matchMember(soul, directory);
  if (match.status === 'review') {
    await queryOn(conn, 'UPDATE red_souls SET church_member_review = ? WHERE id = ?', [match.reason, soul.id]);
    return 'review';
  }
  let member = match.member;
  if (member) {
    await queryOn(conn, `UPDATE members SET red_winner_id = COALESCE(red_winner_id, ?), red_team_id = COALESCE(red_team_id, ?),
      red_soul_id = COALESCE(red_soul_id, ?), consent_given = 1, consent_at = COALESCE(consent_at, ?), email = COALESCE(NULLIF(email, ''), ?)
      WHERE id = ?`, [soul.winner_id, teamId, soul.id, soul.consent_recorded_at, soul.email, member.id]);
    member.identity.email ||= identity(soul).email;
  } else {
    const { title, name } = splitTitle(soul.full_name);
    member = await insertMember(conn, {
      ...splitName(name), title, phone: soul.phone, address: soul.address, email: soul.email,
      status: 'New Convert', spiritual_status: 'Salvation', kdf_area: 'General Area', consent_given: 1,
      consent_at: soul.consent_recorded_at, registered_by: profile.id, registered_by_name: profile.name,
      date_registered: today, red_soul_id: soul.id, red_winner_id: soul.winner_id, red_team_id: teamId,
    });
    directory.push({ ...member, identity: identity(member) });
  }
  await queryOn(conn, 'UPDATE red_souls SET church_member_id = ? WHERE id = ?', [member.id, soul.id]);
  return match.status === 'new' ? 'created' : 'linked';
}

async function submitReport(req) {
  const { report, notice, teamId } = await auditTransaction(req, async conn => {
    await lockDirectory(conn);
    const team = await ownTeam(conn, req, true);
    const month = req.params.month;
    const settings = await getSettings(conn);
    const window = reportWindow(settings, month);
    if (!window) throw reportDenied();
    const previous = await findReport(conn, team.id, month);
    if (previous) return { data: { report: { ...previous, replayed: true } } };
    const today = todayInLagos();
    if (!teamEligible(team, window) || today < window.opens || today > window.closes) throw reportDenied();
    const { summary, souls, revision } = await buildPreview(conn, team, window, settings.monthly_target);
    if (req.body?.revision !== revision) throw new HttpError(409, 'This report has changed. Review the updated totals before submitting.', { code: 'red_report_changed' });
    const directory = souls.length ? await memberIdentities(conn) : [];
    const outcomes = { created: 0, linked: 0, review: 0 };
    for (const soul of souls) outcomes[await importSoul(conn, directory, soul, team.id, req.profile, today)]++;
    const { created, linked, review } = outcomes;
    const id = randomUUID();
    await queryOn(conn, `INSERT INTO red_reports (id, team_id, leader_id, report_month, submitted_at, submitted_on, summary_json, created_members, linked_members, review_members)
      VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), ?, ?, ?, ?, ?)`, [id, team.id, req.profile.id, month, today, JSON.stringify(summary), created, linked, review]);
    const data = await findReport(conn, team.id, month);
    const notice = await queueRedNotice(conn, {
      type: 'red_report_submitted', title: window.final ? 'Operation R.E.D. final report submitted' : 'Operation R.E.D. monthly report submitted',
      body: `${req.profile.name} submitted the team’s report with ${summary.total} valid ${summary.total === 1 ? 'soul' : 'souls'}.`,
      link: `/app/red?team=${team.id}`,
    }, { management: true });
    return { data: { report: { ...data, replayed: false }, notice, teamId: team.id }, event: reportEvent('submitted', id, { team_id: team.id, month, total: summary.total, ...outcomes }) };
  });
  deliverRedPush(notice);
  if (teamId) signalTeam(teamId);
  return report;
}

module.exports = { getReports, prepareReport, submitReport, nextRecordingMonth, teamEligible, reportView };
