'use strict';
const { query, int } = require('../db');
const { HttpError } = require('../http');
const { audit, auditThrottled } = require('./audit');
const { getSettings, teamById } = require('./red-invites');
const { boardMetrics } = require('./red-board');
const { STAGES, soulFields } = require('./red-souls');
const { teamEligible, reportView } = require('./red-reports');
const { todayInLagos, campaignDate, monthOf, shiftMonth, daysBetween, reportWindow, activeReportWindows, utcToLagosDate } = require('./red-calendar');

function trackingWindows(settings, today, requested) {
  const first = monthOf(settings.campaign_start);
  const current = monthOf(campaignDate(settings, today));
  const latest = current < first ? first : current;
  const selected = requested || activeReportWindows(settings, today)[0]?.month || latest;
  const window = reportWindow(settings, selected);
  if (!window) throw new HttpError(400, 'Choose a reporting month in this campaign.');
  const earliest = [first, shiftMonth(latest, -23)].sort().at(-1);
  const windows = [];
  for (let month = earliest; month <= latest; month = shiftMonth(month, 1)) windows.push(reportWindow(settings, month));
  if (!windows.some(period => period.month === selected)) windows.push(window);
  return { window, windows };
}

function reportState(team, window, report, today) {
  if (report) {
    const late = report.submitted_on > window.closes;
    return { status: late ? 'late' : 'submitted', label: late ? 'Submitted late' : 'Submitted', total: report.summary.total, submitted_on: report.submitted_on, review_members: report.review_members };
  }
  if (!teamEligible(team, window) || (team.deactivated_at && utcToLagosDate(team.deactivated_at) < window.opens)) return { status: 'not_due', label: 'Not due' };
  if (today > window.closes) return { status: 'missing', label: 'Missing', days_late: daysBetween(window.closes, today) };
  return { status: 'pending', label: 'Not yet submitted' };
}

function applyTracking(teams, reports, windows, today) {
  const index = new Map(reports.map(row => [`${row.team_id}:${row.report_month}`, reportView(row)]));
  return teams.map(team => ({
    ...team,
    reports: windows.map(window => ({ ...window, ...reportState(team, window, index.get(`${team.id}:${window.month}`), today) })),
  }));
}

async function commandData(req) {
  const settings = await getSettings();
  const today = todayInLagos();
  const { window, windows } = trackingWindows(settings, today, req.query.month);
  const [board, stages, reports] = await Promise.all([
    boardMetrics(settings, today),
    query('SELECT stage, COUNT(*) AS total FROM red_souls WHERE invalidated_at IS NULL GROUP BY stage'),
    query('SELECT * FROM red_reports'),
  ]);
  const totals = new Map(stages.map(row => [row.stage, Number(row.total)]));
  const teams = applyTracking(board.teams, reports, windows, today);
  const attention = teams.flatMap(team => team.reports.filter(report => ['missing', 'late'].includes(report.status))
    .map(report => ({ team_id: team.id, team_name: team.name, ...report })))
    .sort((a, b) => b.month.localeCompare(a.month) || a.team_name.localeCompare(b.team_name));
  return {
    ...board, report_month: window.month, report_windows: windows, attention,
    stages: STAGES.map(stage => ({ stage, total: totals.get(stage) || 0 })),
    teams: teams.map(({ reports: statuses, ...team }) => ({ ...team, report: statuses.find(status => status.month === window.month) })),
  };
}

async function getCommand(req) {
  const result = await commandData(req);
  await auditThrottled(req, `red:command:${req.profile.id}`, 60000, { action: 'red.command_viewed', entity_type: 'red_team' });
  return result;
}

async function getTeamDetail(req) {
  const team = await teamById(null, req.params.id);
  if (!team) throw new HttpError(404, 'Team was not found.');
  const settings = await getSettings();
  const today = todayInLagos();
  const month = monthOf(campaignDate(settings, today));
  const { windows } = trackingWindows(settings, today);
  const pageSize = 20;
  const offset = int(req.query.offset, { max: 2000000 });
  const [members, souls, reports] = await Promise.all([
    query(`SELECT p.id, p.name, p.role, m.joined_at, COUNT(s.id) AS total FROM red_team_members m JOIN profiles p ON p.id = m.profile_id
      LEFT JOIN red_souls s ON s.winner_id = p.id AND s.report_month = ? AND s.invalidated_at IS NULL
      WHERE m.team_id = ? GROUP BY p.id, p.name, p.role, m.joined_at ORDER BY m.joined_at, p.name`, [month, team.id]),
    query(`SELECT ${soulFields}, s.church_member_review, p.name AS winner_name FROM red_souls s JOIN profiles p ON p.id = s.winner_id
      WHERE s.team_id = ? ORDER BY s.church_member_review IS NULL, s.recorded_at DESC, s.id DESC LIMIT ${pageSize + 1} OFFSET ${offset}`, [team.id]),
    query('SELECT * FROM red_reports WHERE team_id = ? ORDER BY report_month DESC', [team.id]),
  ]);
  const [tracked] = applyTracking([team], reports, windows, today);
  await auditThrottled(req, `red:team-detail:${req.profile.id}:${team.id}`, 60000, { action: 'red.team_detail_viewed', entity_type: 'red_team', entity_id: team.id });
  return {
    id: team.id, name: members.find(member => member.id === team.leader_id)?.name,
    deactivated_at: team.deactivated_at, seat_limit: team.seat_limit, month, target: settings.monthly_target,
    members: members.map(member => ({ ...member, total: Number(member.total) })), report_statuses: tracked.reports.slice().reverse(),
    reports: reports.map(reportView), souls: souls.slice(0, pageSize), next_offset: souls.length > pageSize ? offset + pageSize : null,
  };
}

async function exportReports(req) {
  const { teams, report_month: month } = await commandData(req);
  await audit(req, { action: 'red.reports_exported', entity_type: 'red_report', after: { month, teams: teams.length } });
  return teams.map(team => ({
    team: team.name, month, status: team.report.label, submitted_on: team.report.submitted_on, reported_total: team.report.total,
    due: team.report.closes, joined: team.joined, current: team.current, target: team.target, campaign_total: team.total,
  }));
}

module.exports = { getCommand, getTeamDetail, exportReports };
