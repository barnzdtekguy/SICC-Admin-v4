'use strict';
const { query, queryOn } = require('../db');
const { auditTransaction } = require('./audit');
const { getSettings } = require('./red-invites');
const { queueRedNotice, deliverRedPush } = require('./red-notifications');
const { todayInLagos, dateInCampaign, monthOf, pace, weekOf } = require('./red-calendar');

async function weeklyRedReminders(now = new Date()) {
  const today = todayInLagos(now);
  const settings = await getSettings();
  if (!dateInCampaign(settings, today)) return 0;
  const week = weekOf(today);
  const rows = await query(`SELECT m.profile_id, m.team_id, t.leader_id, COUNT(s.id) AS total, r.week_start
    FROM red_team_members m JOIN profiles p ON p.id = m.profile_id JOIN red_teams t ON t.id = m.team_id
    LEFT JOIN red_souls s ON s.winner_id = m.profile_id AND s.report_month = ? AND s.invalidated_at IS NULL
    LEFT JOIN red_reminders r ON r.user_id = m.profile_id AND r.week_start = ?
    WHERE p.is_active = 1 AND t.deactivated_at IS NULL
    GROUP BY m.profile_id, m.team_id, t.leader_id, r.week_start`, [monthOf(today), week]);
  const teams = new Map();
  for (const row of rows) {
    if (!teams.has(row.team_id)) teams.set(row.team_id, { total: 0, size: 0 });
    const team = teams.get(row.team_id);
    team.total += Number(row.total);
    team.size++;
  }
  let sent = 0;
  for (const row of rows) {
    if (row.week_start) continue;
    const individual = pace(today, settings.monthly_target, Number(row.total));
    const team = teams.get(row.team_id);
    const teamPace = pace(today, settings.monthly_target * team.size, team.total);
    const personalBehind = individual.state === 'behind';
    const teamBehind = row.profile_id === row.leader_id && teamPace.state === 'behind';
    if (!personalBehind && !teamBehind) continue;
    const body = [
      personalBehind && `You are ${individual.label.toLowerCase()} on your monthly target.`,
      teamBehind && `Your team is ${teamPace.label.toLowerCase()} on its monthly target.`,
    ].filter(Boolean).join(' ');
    const delivery = await auditTransaction(null, async conn => {
      try { await queryOn(conn, 'INSERT INTO red_reminders (user_id, week_start, created_at) VALUES (?, ?, UTC_TIMESTAMP())', [row.profile_id, week]); }
      catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return { data: null };
        throw error;
      }
      const notification = await queueRedNotice(conn, {
        type: 'red_pace_reminder', title: 'Operation R.E.D. pace reminder', body,
        link: personalBehind ? '/app/overview' : '/app/red-team',
      }, { people: [row.profile_id] });
      return { data: notification, event: { action: 'red.pace_reminder_sent', entity_type: 'profile', entity_id: row.profile_id, after: { week } } };
    });
    if (delivery) { sent++; deliverRedPush(delivery); }
  }
  return sent;
}

module.exports = { weeklyRedReminders };
