'use strict';
const { queryOn } = require('../db');
const { PRIVILEGED } = require('../permissions');
const { writeNotification, sendPush } = require('./notify');

async function queueRedNotice(connection, payload, { management = false, people = [] } = {}) {
  const managers = management
    ? await queryOn(connection, `SELECT id FROM profiles WHERE is_active = 1 AND role IN (${PRIVILEGED.map(() => '?').join(',')})`, PRIVILEGED)
    : [];
  const ids = [...new Set([...people, ...managers.map(row => row.id)])];
  for (const id of ids) await writeNotification(connection, id, payload);
  return { ids, payload };
}

function deliverRedPush(delivery) {
  if (!delivery) return;
  for (const id of delivery.ids) sendPush(id, delivery.payload).catch(() => {});
}

module.exports = { queueRedNotice, deliverRedPush };
