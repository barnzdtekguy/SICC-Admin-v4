'use strict';
// Lightweight in-process scheduler (no extra service needed on shared hosting).
const { query } = require('./db');
const { config } = require('./config');
const { notify, notifyRoles } = require('./lib/notify');
const { purgeOldSessions } = require('./lib/sessions');
const { todayStr } = require('./http');
const { PRIVILEGED } = require('./permissions');
const { sendSms, toIntlNumber } = require('./lib/messaging');
const { decrypt } = require('./lib/crypto');
const { weeklyRedReminders } = require('./lib/red-reminders');

async function runOncePerDay(key, fn) {
  const today = todayStr();
  const row = (await query('SELECT setting_value FROM app_settings WHERE setting_key = ?', [key]))[0];
  if (row?.setting_value === today) return;
  await query('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [key, today]);
  await fn();
}

async function dailyDigest() {
  const md = todayStr().slice(5);
  const birthdays = await query("SELECT id, first_name, last_name, phone, registered_by FROM members WHERE deleted_at IS NULL AND date_of_birth IS NOT NULL AND DATE_FORMAT(date_of_birth, '%m-%d') = ?", [md]);
  if (birthdays.length) {
    await notifyRoles(PRIVILEGED, { type: 'birthday', title: `${birthdays.length} birthday${birthdays.length > 1 ? 's' : ''} today`, body: birthdays.slice(0, 5).map(b => `${b.first_name} ${b.last_name}`).join(', '), link: '/app/overview' });
    const byPastor = new Map();
    for (const b of birthdays) if (b.registered_by) byPastor.set(b.registered_by, [...(byPastor.get(b.registered_by) || []), b]);
    for (const [pastorId, list] of byPastor) await notify([pastorId], { type: 'birthday', title: 'Birthdays among your members today', body: list.map(b => `${b.first_name} ${b.last_name}`).join(', '), link: '/app/myMembers' });
    if (config.autoBirthdaySms) {
      const cfg = (await query('SELECT api_key, sender_id FROM sms_config WHERE id = 1'))[0];
      if (cfg?.api_key) for (const b of birthdays) {
        const to = toIntlNumber(b.phone);
        if (to) await sendSms({ apiKey: decrypt(cfg.api_key), senderId: cfg.sender_id || 'SICC', numbers: [to], message: `Happy birthday ${b.first_name}! Salem International Christian Centre celebrates you today. God bless you.` });
      }
    }
  }
  const overdue = await query("SELECT pastor_id, COUNT(*) AS n FROM follow_ups WHERE status = 'In Progress' AND deleted_at IS NULL AND pastor_id IS NOT NULL AND created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY) GROUP BY pastor_id");
  for (const row of overdue) await notify([row.pastor_id], { type: 'followup', title: `${row.n} follow-up${row.n > 1 ? 's' : ''} need attention`, body: 'These have been in progress for over a week.', link: '/app/followup' });
}

async function tick() {
  try {
    await runOncePerDay('job.daily_digest', dailyDigest);
    await runOncePerDay('job.session_purge', purgeOldSessions);
  } catch (error) { console.error('[jobs] failed:', error.message); }
  try { await weeklyRedReminders(); }
  catch (error) { console.error('[jobs] R.E.D. reminders failed:', error.message); }
}

function startJobs() {
  if (!config.jobsEnabled || config.isTest) return () => {};
  setTimeout(tick, 15000).unref();
  const timer = setInterval(tick, 30 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { startJobs, tick, dailyDigest };
