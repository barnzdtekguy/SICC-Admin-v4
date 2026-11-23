'use strict';
const { query } = require('../db');
const { auditThrottled } = require('./audit');
const { getSettings, ownTeam } = require('./red-invites');
const { todayInLagos, campaignDate, monthOf, pace, trend, daysBetween } = require('./red-calendar');

function sparkline(points) {
  const visible = points.filter(point => point.actual !== null);
  const length = Math.min(7, visible.length);
  return Array.from({ length }, (_, index) => visible[Math.ceil((index + 1) * visible.length / length) - 1].actual);
}

async function boardMetrics(settings, today) {
  const asOf = campaignDate(settings, today);
  const month = monthOf(asOf);
  const [teamRows, counts] = await Promise.all([
    query(`SELECT t.id, p.name AS name, t.seat_limit, t.created_at, t.deactivated_at,
      (SELECT COUNT(*) FROM red_team_members m WHERE m.team_id = t.id) AS joined
      FROM red_teams t JOIN profiles p ON p.id = t.leader_id`),
    query(`SELECT team_id, report_month, recorded_on, COUNT(*) AS total FROM red_souls
      WHERE invalidated_at IS NULL GROUP BY team_id, report_month, recorded_on`),
  ]);
  const byTeam = new Map();
  for (const row of counts) {
    if (!byTeam.has(row.team_id)) byTeam.set(row.team_id, { total: 0, current: 0, days: [] });
    const group = byTeam.get(row.team_id);
    const amount = Number(row.total);
    group.total += amount;
    if (row.report_month === month) {
      group.current += amount;
      group.days.push({ recorded_on: row.recorded_on, total: amount });
    }
  }
  const teams = teamRows.map(row => {
    const { days, total, current } = byTeam.get(row.id) || { days: [], total: 0, current: 0 };
    const target = Number(row.joined) * settings.monthly_target;
    return {
      ...row, joined: Number(row.joined), current, total, target, pace: pace(asOf, target, current),
      trend: sparkline(trend(asOf, target, days)),
    };
  }).sort((a, b) => b.current - a.current || b.total - a.total || a.name.localeCompare(b.name));
  const total = teams.reduce((sum, team) => sum + team.total, 0);
  const campaignDays = Math.max(1, daysBetween(settings.campaign_start, settings.campaign_end) + 1);
  const elapsed = Math.max(0, daysBetween(settings.campaign_start, asOf) + 1);
  const expected = Math.floor(settings.goal * Math.min(1, elapsed / campaignDays));
  const remaining = Math.max(0, settings.goal - total);
  const daysLeft = Math.max(0, daysBetween(today, settings.campaign_end) + 1);
  return { month, teams, total, goal: settings.goal, expected, remaining, days_left: daysLeft, daily_needed: daysLeft ? Math.ceil(remaining / daysLeft) : null };
}

async function getTeamsBoard(req) {
  await ownTeam(null, req);
  const settings = await getSettings();
  const { month, teams, total, goal } = await boardMetrics(settings, todayInLagos());
  await auditThrottled(req, `red:board:${req.profile.id}`, 60000, { action: 'red.teams_board_viewed', entity_type: 'red_team' });
  return {
    month, total, goal,
    teams: teams.map(({ id, name, current, total: teamTotal, target, pace: status, trend: points }) => ({
      id, name, current, total: teamTotal, target, pace: status, trend: points,
    })),
  };
}

module.exports = { boardMetrics, getTeamsBoard };
