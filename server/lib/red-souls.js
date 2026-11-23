'use strict';
const { randomUUID } = require('node:crypto');
const { query, queryOn, int } = require('../db');
const { HttpError, str } = require('../http');
const { can } = require('../permissions');
const { audit, auditThrottled, auditTransaction } = require('./audit');
const { normalizePhoneLogin } = require('./phone-login');
const { ownTeam, teamById, getSettings } = require('./red-invites');
const { nextRecordingMonth } = require('./red-reports');
const { signalTeam } = require('./red-live');
const { dateInCampaign, todayInLagos, campaignDate, monthOf, shiftMonth, pace, trend, monthHistory } = require('./red-calendar');

const STAGES = ['recorded', 'under_training', 'completed_training', 'equipped', 'deployed'];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const duplicate = () => new HttpError(409, 'This soul could not be recorded. Check the details before trying again.', { code: 'red_soul_duplicate' });
const unavailable = () => new HttpError(404, 'Soul record was not found.');
const event = (action, id, extras) => ({ action: `red.soul_${action}`, entity_type: 'red_soul', entity_id: id, ...extras });
const soulFields = `s.id, s.winner_id, s.team_id, s.full_name, s.address, s.phone, s.email, s.consent_recorded_at, s.stage,
  s.recorded_at, s.recorded_on, s.report_month, s.invalidated_at, s.invalidation_reason`;
const text = (value, options) => str(typeof value === 'string' ? value : null, options);

function soulData(body) {
  const id = body?.id;
  if (typeof id !== 'string' || !uuid.test(id)) throw new HttpError(400, 'Open a new soul form and try again.');
  const fullName = text(body.full_name, { required: true, field: 'Full name', max: 240 });
  const address = text(body.address, { required: true, field: 'Address', max: 500 });
  const suppliedPhone = text(body.phone, { field: 'Phone', max: 40 });
  const phone = suppliedPhone && normalizePhoneLogin(suppliedPhone);
  const email = text(body.email, { field: 'Email', max: 254 })?.toLowerCase() || null;
  if (suppliedPhone && !phone) throw new HttpError(400, 'Enter a valid phone number.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (body.consent !== true) throw new HttpError(400, 'Confirm that this person agreed to be followed up.');
  return { id: id.toLowerCase(), fullName, address, phone, email };
}

async function addStage(conn, soulId, actorId, prior, stage, reason = null) {
  await queryOn(conn, `INSERT INTO red_soul_stages (id, soul_id, actor_id, prior_stage, stage, reason, changed_at)
    VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`, [randomUUID(), soulId, actorId, prior, stage, reason]);
}

async function createSoul(req) {
  const replayOwner = req.get('X-SICC-Queue-Owner');
  if (replayOwner && replayOwner !== req.profile.id) throw new HttpError(403, 'Sign in with the account that recorded this soul.');
  const values = soulData(req.body);
  const winner = req.profile.id;
  const { response, teamId } = await auditTransaction(req, async conn => {
    const team = await ownTeam(conn, req, true);
    const [previous] = await queryOn(conn, 'SELECT id, winner_id FROM red_souls WHERE id = ? FOR UPDATE', [values.id]);
    if (previous) {
      if (previous.winner_id !== winner) throw duplicate();
      return { data: { response: { id: previous.id, replayed: true } } };
    }
    const settings = await getSettings(conn);
    const today = todayInLagos();
    if (!dateInCampaign(settings, today)) throw new HttpError(409, 'Soul entry is closed for this campaign.', { code: 'red_entry_closed' });
    const recorded = await queryOn(conn, 'SELECT id FROM red_souls WHERE winner_id = ? AND recorded_on = ? FOR UPDATE', [winner, today]);
    if (recorded.length >= 30) throw new HttpError(429, 'You have reached the daily limit of 30 souls. Try again tomorrow in Lagos time.', { code: 'red_daily_limit' });
    const period = await nextRecordingMonth(conn, team.id, settings, today);
    try {
      await queryOn(conn, `INSERT INTO red_souls (id, winner_id, team_id, full_name, address, phone, email, consent_recorded_at, recorded_at, recorded_on, report_month)
        VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), ?, ?)`,
      [values.id, winner, team.id, values.fullName, values.address, values.phone, values.email, today, period]);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw duplicate();
      throw error;
    }
    await addStage(conn, values.id, winner, null, 'recorded');
    return { data: { response: { id: values.id, replayed: false }, teamId: team.id }, event: event('recorded', values.id, { after: { team_id: team.id, stage: 'recorded' } }) };
  });
  if (teamId) signalTeam(teamId);
  return response;
}

async function listSouls(req) {
  const team = await ownTeam(null, req);
  const fullTeam = req.query.scope === 'team';
  if (fullTeam && team.leader_id !== req.profile.id) throw new HttpError(403, 'Only the leader can view the team’s soul records.');
  const field = fullTeam ? 's.team_id' : 's.winner_id';
  const key = fullTeam ? team.id : req.profile.id;
  const pageSize = 20;
  const offset = int(req.query.offset, { max: 2000000 });
  const rows = await query(`SELECT ${soulFields}, p.name AS winner_name FROM red_souls s JOIN profiles p ON p.id = s.winner_id
    WHERE ${field} = ? ORDER BY s.recorded_at DESC, s.id DESC LIMIT ${pageSize + 1} OFFSET ${offset}`, [key]);
  await auditThrottled(req, `red:list:${req.profile.id}:${key}`, 60000, event('list_viewed', null, { after: { scope: fullTeam ? 'team' : 'own' } }));
  return { items: rows.slice(0, pageSize), next_offset: rows.length > pageSize ? offset + pageSize : null };
}

async function findSoul(req, conn = null, lock = false) {
  const manages = can(req.profile.role, 'red.manage');
  const team = manages ? null : await ownTeam(conn, req, lock);
  const id = req.params.id;
  if (!uuid.test(id)) throw unavailable();
  const [base] = await queryOn(conn, 'SELECT team_id FROM red_souls WHERE id = ?', [id]);
  if (!base || (team && base.team_id !== team.id)) throw unavailable();
  if (manages && lock) await teamById(conn, base.team_id, true);
  const [row] = await queryOn(conn, `SELECT ${soulFields} FROM red_souls s WHERE s.id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!row || (team && team.leader_id !== req.profile.id && row.winner_id !== req.profile.id)) throw unavailable();
  return row;
}

async function soulDetail(req) {
  const soul = await findSoul(req);
  const history = await query(`SELECT e.prior_stage, e.stage, e.reason, e.changed_at, p.name AS actor_name
    FROM red_soul_stages e JOIN profiles p ON p.id = e.actor_id WHERE e.soul_id = ? ORDER BY e.changed_at, e.id`, [soul.id]);
  const [winner] = await query('SELECT name FROM profiles WHERE id = ?', [soul.winner_id]);
  await audit(req, event('viewed', soul.id));
  return { ...soul, winner_name: winner.name, history };
}

function reasonFor(value) {
  const reason = text(value, { required: true, field: 'Reason', max: 500 });
  if (reason.length < 8) throw new HttpError(400, 'Enter a reason of at least eight characters.');
  return reason;
}

async function changeStage(req) {
  const manages = can(req.profile.role, 'red.manage');
  const { response, teamId } = await auditTransaction(req, async conn => {
    const soul = await findSoul(req, conn, true);
    if (!manages && soul.winner_id !== req.profile.id) throw new HttpError(403, 'Only the person who won this soul can change its stage.');
    if (soul.invalidated_at) throw new HttpError(409, 'This soul has been flagged invalid.');
    const stage = req.body?.stage;
    const next = STAGES.indexOf(stage);
    if (next === -1) throw new HttpError(400, 'Choose a valid training stage.');
    if (soul.stage === stage) return { data: { response: { id: soul.id, stage } } };
    if (req.body?.expected_stage && req.body.expected_stage !== soul.stage) throw new HttpError(409, 'The stage changed. Refresh the record before trying again.');
    const previous = STAGES.indexOf(soul.stage);
    if (!manages && next > previous + 1) throw new HttpError(400, 'Move forward one stage at a time.');
    const reason = manages || next < previous ? reasonFor(req.body?.reason) : null;
    await queryOn(conn, 'UPDATE red_souls SET stage = ? WHERE id = ?', [stage, soul.id]);
    await addStage(conn, soul.id, req.profile.id, soul.stage, stage, reason);
    return { data: { response: { id: soul.id, stage }, teamId: soul.team_id }, event: event('stage_changed', soul.id, { before: { stage: soul.stage }, after: { stage }, detail: reason }) };
  });
  if (teamId) signalTeam(teamId);
  return response;
}

async function invalidateSoul(req) {
  const reason = reasonFor(req.body?.reason);
  const { response, teamId } = await auditTransaction(req, async conn => {
    const soul = await findSoul(req, conn, true);
    if (soul.invalidated_at) return { data: { response: { id: soul.id, invalid: true } } };
    await queryOn(conn, 'UPDATE red_souls SET invalidated_at = UTC_TIMESTAMP(), invalidated_by = ?, invalidation_reason = ? WHERE id = ?', [req.profile.id, reason, soul.id]);
    return { data: { response: { id: soul.id, invalid: true }, teamId: soul.team_id }, event: event('invalidated', soul.id, { detail: reason }) };
  });
  if (teamId) signalTeam(teamId);
  return response;
}

async function getDashboard(req) {
  const team = await ownTeam(null, req);
  const leader = team.leader_id === req.profile.id;
  const settings = await getSettings();
  const today = todayInLagos();
  const asOf = campaignDate(settings, today);
  const month = monthOf(asOf);
  const historyEnd = today > settings.campaign_end ? shiftMonth(month, 1) : month;
  const [ownDaily, roster, previousMonths] = await Promise.all([
    query(`SELECT recorded_on, COUNT(*) AS total FROM red_souls WHERE winner_id = ? AND report_month = ? AND invalidated_at IS NULL GROUP BY recorded_on`, [req.profile.id, month]),
    leader ? query(`SELECT p.id, p.name, p.role, m.joined_at, COUNT(s.id) AS total FROM red_team_members m JOIN profiles p ON p.id = m.profile_id
      LEFT JOIN red_souls s ON s.winner_id = p.id AND s.report_month = ? AND s.invalidated_at IS NULL
      WHERE m.team_id = ? GROUP BY p.id, p.name, p.role, m.joined_at ORDER BY m.joined_at, p.name`, [month, team.id]) : null,
    query(`SELECT report_month, COUNT(*) AS total FROM red_souls WHERE winner_id = ? AND report_month >= ? AND report_month < ?
      AND invalidated_at IS NULL GROUP BY report_month`, [req.profile.id, monthOf(settings.campaign_start), historyEnd]),
  ]);
  const target = settings.monthly_target;
  const current = ownDaily.reduce((total, row) => total + Number(row.total), 0);
  await auditThrottled(req, `red:dashboard:${req.profile.id}`, 60000, { action: 'red.dashboard_viewed', entity_type: 'red_team', entity_id: team.id });
  return {
    month, today, as_of: asOf, can_add: dateInCampaign(settings, today), current, target,
    pace: pace(asOf, target, current), trend: trend(asOf, target, ownDaily),
    history: monthHistory(settings.campaign_start, historyEnd, target, previousMonths),
    ...(roster ? { roster: roster.map(member => ({ ...member, total: Number(member.total), pace: pace(asOf, target, Number(member.total)) })),
      team_total: roster.reduce((total, row) => total + Number(row.total), 0), team_target: roster.length * target } : {}),
  };
}

module.exports = { createSoul, listSouls, soulDetail, changeStage, invalidateSoul, getDashboard, STAGES, soulFields };
