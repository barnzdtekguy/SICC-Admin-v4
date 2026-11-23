'use strict';
const { randomUUID, createHash } = require('node:crypto');
const { query, queryOn } = require('../db');
const { HttpError, phoneLast10 } = require('../http');
const { audit, auditThrottled, auditTransaction } = require('./audit');
const { getSettings, ownTeam } = require('./red-invites');
const { normalizePhoneLogin } = require('./phone-login');
const { queueRedNotice, deliverRedPush } = require('./red-notifications');
const { signalTeam } = require('./red-live');
const { todayInLagos, monthOf, shiftMonth, reportWindow, activeReportWindows, utcToLagosDate } = require('./red-calendar');

const reportEvent = (action, id, after) => ({ action: `red.report_${action}`, entity_type: 'red_report', entity_id: id, after });
const lockedClause = conn => conn ? ' FOR UPDATE' : '';
const reportView = row => ({
  id: row.id, month: row.report_month, submitted_at: row.submitted_at, submitted_on: row.submitted_on,
  summary: typeof row.summary_json === 'string' ? JSON.parse(row.summary_json) : row.summary_json,
  created_members: row.created_members, linked_members: row.linked_members,
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

function splitName(fullName) {
  const letters = [...fullName];
  const firstSpace = letters.findIndex(char => /\s/.test(char));
  const cut = firstSpace > 0 && firstSpace <= 120 && letters.length - firstSpace <= 121 ? firstSpace : Math.min(120, letters.length);
  return [letters.slice(0, cut).join('').trim(), letters.slice(cut).join('').trim()];
}

async function importSoul(conn, soul, teamId, profile, today) {
  const phoneKey = phoneLast10(soul.phone);
  if (phoneKey) {
    const matches = await queryOn(conn, `SELECT id, phone, red_soul_id FROM members WHERE phone_last10 = ?
      ORDER BY deleted_at IS NOT NULL, created_at, id FOR UPDATE`, [phoneKey]);
    const person = matches.find(row => normalizePhoneLogin(row.phone) === soul.phone);
    if (person && (!person.red_soul_id || person.red_soul_id === soul.id)) {
      await queryOn(conn, `UPDATE members SET red_soul_id = ?, red_winner_id = ?, red_team_id = ?,
        consent_given = 1, consent_at = COALESCE(consent_at, ?), email = COALESCE(email, ?)
        WHERE id = ?`, [soul.id, soul.winner_id, teamId, soul.consent_recorded_at, soul.email, person.id]);
      return false;
    }
    if (person) throw new HttpError(409, 'A member link changed before the report was submitted. Please try again.');
  }
  const [first, last] = splitName(soul.full_name);
  await queryOn(conn, `INSERT INTO members (id, first_name, last_name, phone, phone_last10, address, email, status, spiritual_status,
    kdf_area, consent_given, consent_at, registered_by, registered_by_name, date_registered, red_soul_id, red_winner_id, red_team_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'New Convert', 'Salvation', 'General Area', 1, ?, ?, ?, ?, ?, ?, ?)`,
  [randomUUID(), first, last, soul.phone, phoneKey, soul.address, soul.email, soul.consent_recorded_at, profile.id, profile.name, today, soul.id, soul.winner_id, teamId]);
  return true;
}

async function submitReport(req) {
  const { report, notice, teamId } = await auditTransaction(req, async conn => {
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
    let created = 0;
    for (const soul of souls) created += Number(await importSoul(conn, soul, team.id, req.profile, today));
    const id = randomUUID();
    const linked = summary.total - created;
    await queryOn(conn, `INSERT INTO red_reports (id, team_id, leader_id, report_month, submitted_at, submitted_on, summary_json, created_members, linked_members)
      VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), ?, ?, ?, ?)`, [id, team.id, req.profile.id, month, today, JSON.stringify(summary), created, linked]);
    const data = await findReport(conn, team.id, month);
    const notice = await queueRedNotice(conn, {
      type: 'red_report_submitted', title: window.final ? 'Operation R.E.D. final report submitted' : 'Operation R.E.D. monthly report submitted',
      body: `${req.profile.name} submitted the team’s report with ${summary.total} valid ${summary.total === 1 ? 'soul' : 'souls'}.`,
      link: `/app/red?team=${team.id}`,
    }, { management: true });
    return { data: { report: { ...data, replayed: false }, notice, teamId: team.id }, event: reportEvent('submitted', id, { team_id: team.id, month, total: summary.total, created, linked }) };
  });
  deliverRedPush(notice);
  if (teamId) signalTeam(teamId);
  return report;
}

module.exports = { getReports, prepareReport, submitReport, nextRecordingMonth, teamEligible, reportView };
