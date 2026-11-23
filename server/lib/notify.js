'use strict';
const crypto = require('crypto');
const { query, queryOn } = require('../db');
const { config } = require('../config');

let webpush = null;
function push() {
  if (webpush !== null) return webpush;
  if (!config.vapid.publicKey || !config.vapid.privateKey) { webpush = false; return webpush; }
  try {
    webpush = require('web-push');
    webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
  } catch (error) { console.warn('Web push unavailable:', error.message); webpush = false; }
  return webpush;
}

async function sendPush(userId, payload) {
  const wp = push();
  if (!wp) return;
  const subs = await query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?', [userId]);
  await Promise.all(subs.map(async sub => {
    try {
      await wp.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 3600 });
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) await query('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
    }
  }));
}

async function writeNotification(connection, userId, { type = 'info', title, body = null, link = null }) {
  await queryOn(connection, 'INSERT INTO notifications (id, user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?, ?)',
    [crypto.randomUUID(), userId, type, String(title).slice(0, 200), body ? String(body).slice(0, 600) : null, link ? String(link).slice(0, 200) : null]);
}

// userIds: array of profile ids. Never throws: notifications must not break the main action.
async function notify(userIds, payload) {
  try {
    const ids = [...new Set((userIds || []).filter(Boolean))];
    for (const userId of ids) {
      await writeNotification(null, userId, payload);
      sendPush(userId, { ...payload, type: payload.type || 'info' }).catch(() => {});
    }
  } catch (error) { console.error('notify failed:', error.message); }
}

async function notifyRoles(roles, payload, exceptUserId = null) {
  const rows = await query(`SELECT id FROM profiles WHERE is_active = 1 AND role IN (${roles.map(() => '?').join(',')})`, roles);
  return notify(rows.map(r => r.id).filter(id => id !== exceptUserId), payload);
}

module.exports = { notify, notifyRoles, writeNotification, sendPush, pushEnabled: () => Boolean(push()) };
