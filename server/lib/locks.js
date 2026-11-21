'use strict';
const { config } = require('../config');
const { HttpError, addDays } = require('../http');

const sqlToMs = s => Date.parse(`${String(s).replace(' ', 'T')}Z`);

// A record is locked once `lockHours` have passed since it was created.
const lockedByCreation = createdAt => Date.now() - sqlToMs(createdAt) > config.attendance.lockHours * 3600000;
// An attendance-date record locks `lockHours` after the end of that calendar day.
const lockedByDate = dateStr => Date.now() > Date.parse(`${addDays(String(dateStr).slice(0, 10), 1)}T00:00:00Z`) + config.attendance.lockHours * 3600000;

function requireReason(reason, what = 'This record is locked') {
  const text = String(reason || '').trim();
  if (text.length < 8) throw new HttpError(400, `${what}. Give a reason of at least 8 characters.`, { code: 'reason_required' });
  return text.slice(0, 400);
}

module.exports = { lockedByCreation, lockedByDate, requireReason, sqlToMs };
