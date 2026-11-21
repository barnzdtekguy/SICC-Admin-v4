'use strict';
class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function sendData(res, data, status = 200) {
  return res.status(status).json({ data });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validDate(value) {
  if (!DATE_RE.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const todayStr = () => new Date().toISOString().slice(0, 10);
function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function str(value, { max = 255, required = false, field = 'value' } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (required) throw new HttpError(400, `${field} is required.`);
    return null;
  }
  const s = String(value).trim();
  if (s.length > max) throw new HttpError(400, `${field} must be ${max} characters or fewer.`);
  return s;
}

function oneOf(value, allowed, field) {
  if (value === undefined || value === null || value === '') return undefined;
  if (!allowed.includes(value)) throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}.`);
  return value;
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}
function phoneLast10(value) {
  const digits = normalizePhone(value);
  return digits.length >= 7 ? digits.slice(-10) : null;
}

function pick(source, keys) {
  return Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
}

module.exports = { HttpError, asyncRoute, sendData, validDate, todayStr, addDays, str, oneOf, normalizePhone, phoneLast10, pick };
