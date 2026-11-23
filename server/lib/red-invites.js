'use strict';
const crypto = require('crypto');
const { config } = require('../config');
const { query, queryOn: run } = require('../db');
const { HttpError, str, validDate } = require('../http');
const { audit, auditTransaction } = require('./audit');
const { normalizePhoneLogin } = require('./phone-login');
const { validatePassword, hashPassword } = require('./password');
const { createSession } = require('./sessions');
const { queueRedNotice, deliverRedPush } = require('./red-notifications');
const { signalTeam } = require('./red-live');

const LEADER_CAPACITIES = [1, 5, 10, 25, 50];
const settingsFields = {
  goal: [1, 1000000], monthly_target: [1, 1000], team_size: [2, 50], report_open_day: [1, 28],
  report_close_day: [1, 28], leader_expiry_hours: [1, 720], member_expiry_days: [1, 30],
};
const dateFields = ['campaign_start', 'campaign_end', 'final_report_opens'];
const selectInvite = 'SELECT red_invites.*, expires_at <= UTC_TIMESTAMP() AS expired FROM red_invites';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hashToken = token => crypto.createHash('sha256').update(token).digest();
const memberToken = id => crypto.createHmac('sha256', config.jwtSecret).update(`sicc:red-member-invite:v1:${id}`).digest('base64url');

const eventFor = (action, entity_type, entity_id, extra) => ({ action: `red.${action}`, entity_type, entity_id, ...extra });
const invalidInvite = kind => new HttpError(404,
  kind === 'leader' ? 'This invitation is unavailable. Ask the church for a new link.' : 'This team link is unavailable. Ask the team leader for a current link.',
  { code: 'red_invite_unavailable' });
const accountUnavailable = () => new HttpError(409, 'We couldn’t create this account. If you already have an account, sign in.', { code: 'red_account_unavailable' });

function statusOf(row) {
  if (row.revoked_at) return 'Revoked';
  if (row.expired) return 'Expired';
  return row.used_count >= row.capacity ? 'Full' : 'Active';
}

function inviteView(row, token) {
  return {
    id: row.id, status: statusOf(row), capacity: row.capacity, used: row.used_count, declines: Number(row.declines || 0),
    created_at: row.created_at, expires_at: row.expires_at,
    ...(token ? { path: `/red/invite/${row.kind}#${token}` } : {}),
  };
}

async function getSettings(conn = null, lock = false) {
  const [settings] = await run(conn, `SELECT * FROM red_settings WHERE id = 1${lock ? ' FOR UPDATE' : ''}`);
  const { id: _id, ...data } = settings;
  return data;
}

async function saveSettings(req) {
  return auditTransaction(req, async conn => {
    const before = await getSettings(conn, true);
    const updates = {};
    for (const [key, [min, max]] of Object.entries(settingsFields)) {
      if (req.body?.[key] === undefined) continue;
      const value = req.body[key];
      if (!Number.isInteger(value) || value < min || value > max) throw new HttpError(400, `Enter a valid ${key.replaceAll('_', ' ')}.`);
      updates[key] = value;
    }
    for (const key of dateFields) {
      if (req.body?.[key] === undefined) continue;
      if (!validDate(req.body[key])) throw new HttpError(400, `Enter a valid ${key.replaceAll('_', ' ')}.`);
      updates[key] = req.body[key];
    }
    if (req.body?.leader_link_capacity !== undefined) updates.leader_link_capacity = validCapacity(req.body.leader_link_capacity);
    const after = { ...before, ...updates };
    if (after.campaign_start >= after.campaign_end || after.final_report_opens < after.campaign_end) {
      throw new HttpError(400, 'The campaign end must follow the start. The final report can open on or after the campaign end.');
    }
    if (after.report_close_day >= after.report_open_day) throw new HttpError(400, 'Choose a report closing day earlier in the next month.');
    const keys = Object.keys(updates);
    if (!keys.length) throw new HttpError(400, 'Choose a setting to update.');
    await run(conn, `UPDATE red_settings SET ${keys.map(key => `${key} = ?`).join(', ')} WHERE id = 1`, keys.map(key => updates[key]));
    return { data: after, event: eventFor('settings_updated', 'red_settings', '1', { before, after }) };
  });
}

function validCapacity(value) {
  if (!LEADER_CAPACITIES.includes(value)) throw new HttpError(400, 'Choose a capacity of 1, 5, 10, 25 or 50.');
  return value;
}

async function issueInvite(conn, { kind, teamId = null, capacity, owner, ttl }) {
  const id = crypto.randomUUID();
  const token = kind === 'leader' ? crypto.randomBytes(32).toString('base64url') : memberToken(id);
  await run(conn, `INSERT INTO red_invites (id, kind, team_id, token_hash, capacity, created_by, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP()))`,
  [id, kind, teamId, hashToken(token), capacity, owner, ttl]);
  const [row] = await run(conn, `${selectInvite} WHERE id = ?`, [id]);
  return inviteView(row, token);
}

async function leaderInviteById(conn, id, lock = false) {
  const [row] = await run(conn, `${selectInvite} WHERE id = ? AND kind = 'leader'${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!row) throw new HttpError(404, 'Invitation not found.');
  return row;
}

async function listLeaderInvites(req) {
  const rows = await query(`SELECT i.*, i.expires_at <= UTC_TIMESTAMP() AS expired,
    (SELECT COUNT(*) FROM red_invite_responses r WHERE r.invite_id = i.id AND r.kind = 'declined') AS declines
    FROM red_invites i WHERE i.kind = 'leader' ORDER BY i.created_at DESC, i.id DESC`);
  await audit(req, eventFor('invites_viewed', 'red_invite', null));
  return rows.map(row => inviteView(row));
}

async function readLeaderInvite(req) {
  const row = await leaderInviteById(null, req.params.id);
  const responses = await query(`SELECT r.kind, p.id AS profile_id, p.name, r.responded_at FROM red_invite_responses r
    LEFT JOIN profiles p ON p.id = r.profile_id WHERE r.invite_id = ? ORDER BY r.responded_at DESC, r.id`, [row.id]);
  await audit(req, eventFor('invite_viewed', 'red_invite', row.id));
  const joined = responses.filter(response => response.kind === 'accepted');
  return { ...inviteView({ ...row, declines: responses.length - joined.length }), joined };
}

async function createLeaderInvite(req, replace = false) {
  return auditTransaction(req, async conn => {
    const settings = await getSettings(conn);
    const old = replace ? await leaderInviteById(conn, req.params.id, true) : null;
    const capacity = validCapacity(req.body?.capacity ?? old?.capacity ?? settings.leader_link_capacity);
    if (old) await run(conn, 'UPDATE red_invites SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()) WHERE id = ?', [old.id]);
    const data = await issueInvite(conn, { kind: 'leader', capacity, owner: req.profile.id, ttl: settings.leader_expiry_hours * 3600 });
    return { data, event: eventFor(old ? 'invite_replaced' : 'invite_created', 'red_invite', data.id, { after: { capacity, replaced_invite_id: old?.id } }) };
  });
}

async function revokeLeaderInvite(req) {
  return auditTransaction(req, async conn => {
    const row = await leaderInviteById(conn, req.params.id, true);
    await run(conn, 'UPDATE red_invites SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()) WHERE id = ?', [row.id]);
    return { data: { id: row.id, status: 'Revoked' }, event: eventFor('invite_revoked', 'red_invite', row.id) };
  });
}

async function teamById(conn, id, lock = false) {
  const [team] = await run(conn, `SELECT * FROM red_teams WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
  return team;
}

async function ownTeam(conn, req, lock = false) {
  const [membership] = await run(conn, 'SELECT team_id FROM red_team_members WHERE profile_id = ?', [req.profile.id]);
  const team = membership ? await teamById(conn, membership.team_id, lock) : null;
  if (!team || team.deactivated_at) throw new HttpError(403, 'Your Operation R.E.D. team is unavailable.');
  return team;
}

async function countJoined(conn, teamId) {
  if (conn) {
    const members = await run(conn, 'SELECT profile_id FROM red_team_members WHERE team_id = ? FOR UPDATE', [teamId]);
    return members.length;
  }
  const [row] = await run(conn, 'SELECT COUNT(*) AS total FROM red_team_members WHERE team_id = ?', [teamId]);
  return Number(row.total);
}

async function teamSummary(team, conn = null) {
  const [leader] = await run(conn, 'SELECT name FROM profiles WHERE id = ?', [team.leader_id]);
  return {
    id: team.id, leader_name: leader.name, joined: await countJoined(conn, team.id),
    seat_limit: team.seat_limit, deactivated_at: team.deactivated_at,
  };
}

async function teamRoster(teamId) {
  return query(`SELECT p.id, p.name, p.role, m.joined_at FROM red_team_members m JOIN profiles p ON p.id = m.profile_id
    WHERE m.team_id = ? ORDER BY m.joined_at, p.name`, [teamId]);
}

async function getOwnTeam(req) {
  const team = await ownTeam(null, req);
  const data = await teamSummary(team);
  if (team.leader_id === req.profile.id) data.members = await teamRoster(team.id);
  await audit(req, eventFor('team_viewed', 'red_team', team.id));
  return data;
}

async function readJoinLink(req) {
  const team = await ownTeam(null, req);
  if (team.leader_id !== req.profile.id) throw new HttpError(403, 'Only the team leader can manage its invite.');
  const [row] = await query(`${selectInvite} WHERE team_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`, [team.id]);
  await audit(req, eventFor('join_link_viewed', 'red_team', team.id));
  if (!row) return null;
  const token = memberToken(row.id);
  const canShare = statusOf(row) === 'Active' && hashToken(token).equals(row.token_hash);
  return inviteView(row, canShare ? token : undefined);
}

async function rotateJoinLink(req) {
  return auditTransaction(req, async conn => {
    const team = await ownTeam(conn, req, true);
    if (team.leader_id !== req.profile.id) throw new HttpError(403, 'Only the team leader can manage its invite.');
    const capacity = Math.min(4, team.seat_limit - await countJoined(conn, team.id));
    if (capacity < 1) throw new HttpError(409, 'Your team is full.');
    const settings = await getSettings(conn);
    await run(conn, 'UPDATE red_invites SET revoked_at = UTC_TIMESTAMP() WHERE team_id = ? AND revoked_at IS NULL', [team.id]);
    const data = await issueInvite(conn, { kind: 'member', teamId: team.id, capacity, owner: req.profile.id, ttl: settings.member_expiry_days * 86400 });
    return { data, event: eventFor('join_link_replaced', 'red_invite', data.id, { after: { team_id: team.id, capacity } }) };
  });
}

async function listTeams(req) {
  const data = await query(`SELECT t.id, p.name AS leader_name, t.seat_limit, t.deactivated_at,
    (SELECT COUNT(*) FROM red_team_members m WHERE m.team_id = t.id) AS joined
    FROM red_teams t JOIN profiles p ON p.id = t.leader_id ORDER BY t.created_at DESC, t.id DESC`);
  await audit(req, eventFor('teams_viewed', 'red_team', null));
  return data;
}

async function deactivateTeam(req) {
  return auditTransaction(req, async conn => {
    const team = await teamById(conn, req.params.id, true);
    if (!team) throw new HttpError(404, 'Team not found.');
    const reason = str(req.body?.reason, { max: 500 });
    await run(conn, 'UPDATE red_teams SET deactivated_at = COALESCE(deactivated_at, UTC_TIMESTAMP()) WHERE id = ?', [team.id]);
    await run(conn, 'UPDATE red_invites SET revoked_at = UTC_TIMESTAMP() WHERE team_id = ? AND revoked_at IS NULL', [team.id]);
    await run(conn, `UPDATE profiles p JOIN red_team_members m ON m.profile_id = p.id
      SET p.is_active = 0, p.deactivated_at = COALESCE(p.deactivated_at, UTC_TIMESTAMP()) WHERE m.team_id = ?`, [team.id]);
    await run(conn, `UPDATE sessions s JOIN red_team_members m ON m.profile_id = s.user_id
      SET s.revoked_at = UTC_TIMESTAMP(), s.revoked_reason = 'red_team_deactivated' WHERE m.team_id = ? AND s.revoked_at IS NULL`, [team.id]);
    return { data: await teamSummary(await teamById(conn, team.id), conn), event: eventFor('team_deactivated', 'red_team', team.id, { detail: reason }) };
  });
}

async function lookup(kind, token, conn) {
  if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) throw invalidInvite(kind);
  const [row] = await run(conn, `${selectInvite} WHERE token_hash = ? AND kind = ?`, [hashToken(token), kind]);
  if (!row || statusOf(row) !== 'Active') throw invalidInvite(kind);
  return row;
}

async function publicContext(kind, token, conn = null) {
  let invite = await lookup(kind, token, conn);
  // Join, rotation and deactivation take the team lock before touching its link.
  const team = kind === 'member' ? await teamById(conn, invite.team_id, Boolean(conn)) : null;
  if (conn) {
    // Lock the primary key so another signup waiting on this link does not block insertion of a new team link.
    [invite] = await run(conn, `${selectInvite} WHERE id = ? FOR UPDATE`, [invite.id]);
    if (!invite || statusOf(invite) !== 'Active') throw invalidInvite(kind);
  }
  if (kind === 'member' && (!team || team.deactivated_at || await countJoined(conn, team.id) >= team.seat_limit)) throw invalidInvite(kind);
  return { invite, team };
}

async function inspectInvite(req, kind) {
  const { invite, team } = await publicContext(kind, req.body?.token);
  await audit(req, eventFor('invite_opened', 'red_invite', invite.id));
  if (!team) return { kind };
  const { leader_name, joined, seat_limit } = await teamSummary(team);
  return { kind, leader_name, joined, seat_limit };
}

async function declineInvite(req) {
  return auditTransaction(req, async conn => {
    const { invite } = await publicContext('leader', req.body?.token, conn);
    await recordResponse(conn, invite.id, 'declined', null);
    return { data: { recorded: true }, event: eventFor('invite_declined', 'red_invite', invite.id) };
  });
}

function signupDetails(body) {
  const name = str(typeof body?.name === 'string' ? body.name : null, { max: 160, required: true, field: 'Full name' });
  const phone = typeof body?.phone === 'string' ? normalizePhoneLogin(body.phone) : null;
  if (!phone) throw new HttpError(400, 'Enter a valid phone number, including the country code for numbers outside Nigeria.');
  const email = str(body?.email, { max: 254, field: 'Email' })?.toLowerCase() || null;
  if (email && !emailPattern.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  const password = typeof body?.password === 'string' ? body.password : '';
  const problem = validatePassword(password, { email, name, username: phone });
  if (problem) throw new HttpError(400, problem);
  return { name, phone, email, password };
}

async function recordResponse(conn, inviteId, kind, profileId) {
  await run(conn, `INSERT INTO red_invite_responses (id, invite_id, kind, profile_id, responded_at)
    VALUES (?, ?, ?, ?, UTC_TIMESTAMP())`, [crypto.randomUUID(), inviteId, kind, profileId]);
}

async function acceptInvite(req, kind) {
  const token = req.body?.token;
  await publicContext(kind, token);
  const details = signupDetails(req.body);
  const passwordHash = await hashPassword(details.password);
  const role = kind === 'leader' ? 'red_leader' : 'red_member';
  const result = await auditTransaction(req, async conn => {
    const { invite, team } = await publicContext(kind, token, conn);
    const [existing] = await run(conn, 'SELECT id FROM profiles WHERE phone_login = ? LIMIT 1 FOR UPDATE', [details.phone]);
    if (existing) throw accountUnavailable();
    const profileId = crypto.randomUUID();
    const avatar = details.name.split(/\s+/).map(part => part[0]).join('').toUpperCase().slice(0, 2);
    try {
      await run(conn, `INSERT INTO profiles (id, username, name, email, phone, phone_login, role, avatar, password_hash, password_changed_at, last_login_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [profileId, details.phone, details.name, details.email, details.phone, details.phone, role, avatar, passwordHash]);
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY') throw error;
      throw accountUnavailable();
    }
    const teamId = team?.id || crypto.randomUUID();
    const settings = team ? null : await getSettings(conn);
    if (!team) await run(conn, 'INSERT INTO red_teams (id, leader_id, seat_limit, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP())', [teamId, profileId, settings.team_size]);
    await run(conn, 'INSERT INTO red_team_members (profile_id, team_id, joined_at) VALUES (?, ?, UTC_TIMESTAMP())', [profileId, teamId]);
    if (!team) await issueInvite(conn, { kind: 'member', teamId, capacity: Math.min(4, settings.team_size - 1), owner: profileId, ttl: settings.member_expiry_days * 86400 });
    await recordResponse(conn, invite.id, 'accepted', profileId);
    await run(conn, 'UPDATE red_invites SET used_count = used_count + 1 WHERE id = ?', [invite.id]);
    const [profile] = await run(conn, 'SELECT * FROM profiles WHERE id = ?', [profileId]);
    const session = await createSession(profile, { ip: req.ip, userAgent: req.get('user-agent') }, conn);
    const notice = kind === 'leader'
      ? await queueRedNotice(conn, {
        type: 'red_leader_signup', title: 'New Operation R.E.D. team leader', body: `${profile.name} signed up through leader invitation ${invite.id}.`,
        link: `/app/red?invite=${invite.id}`,
      }, { management: true })
      : [
        await queueRedNotice(conn, {
          type: 'red_member_join', title: 'New team member', body: `${profile.name} joined your Operation R.E.D. team.`, link: '/app/red-team',
        }, { people: [team.leader_id] }),
        await queueRedNotice(conn, {
          type: 'red_member_join', title: 'New Operation R.E.D. team member', body: `${profile.name} joined a team.`, link: `/app/red?team=${teamId}`,
        }, { management: true }),
      ];
    return { data: { profile, session, notice, teamId }, event: eventFor(`${kind}_signup`, 'red_team', teamId, {
      actor: { id: profile.id, name: profile.name, role: profile.role }, after: { invite_id: invite.id },
    }) };
  });
  for (const delivery of [result.notice].flat()) deliverRedPush(delivery);
  if (kind === 'member') signalTeam(result.teamId);
  return { profile: result.profile, session: result.session };
}

module.exports = {
  getSettings, saveSettings, listLeaderInvites, readLeaderInvite, createLeaderInvite, revokeLeaderInvite,
  getOwnTeam, readJoinLink, rotateJoinLink, listTeams, deactivateTeam, inspectInvite, declineInvite, acceptInvite,
  ownTeam, teamById,
};
