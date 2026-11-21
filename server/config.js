'use strict';
require('dotenv').config();
const crypto = require('crypto');

const env = process.env;
const num = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const flag = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};
const list = value => String(value || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);

const config = {
  env: env.NODE_ENV || 'development',
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  port: num(env.PORT, 3001),
  trustProxy: env.TRUST_PROXY === undefined || env.TRUST_PROXY === '' ? 1 : (Number.isNaN(Number(env.TRUST_PROXY)) ? env.TRUST_PROXY : Number(env.TRUST_PROXY)),
  allowedOrigins: list(env.APP_ORIGIN),
  jwtSecret: env.JWT_SECRET || '',
  db: {
    host: env.DB_HOST, port: num(env.DB_PORT, 3306), name: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD,
  },
  session: {
    ttlSeconds: num(env.SESSION_TTL_HOURS, 10) * 3600,
    rememberSeconds: num(env.SESSION_REMEMBER_DAYS, 14) * 86400,
    idleMinutes: num(env.SESSION_IDLE_MINUTES, 120),
  },
  login: { maxFailures: num(env.LOGIN_MAX_FAILURES, 5), baseLockMinutes: num(env.LOGIN_LOCK_MINUTES, 15) },
  mfaRequiredRoles: list(env.MFA_REQUIRED_ROLES || 'bishop,admin'),
  attendance: {
    lockHours: num(env.ATTENDANCE_LOCK_HOURS, 48),
    backdateDays: num(env.ATTENDANCE_BACKDATE_DAYS, 3),
  },
  checkin: {
    rotateSeconds: num(env.CHECKIN_ROTATE_SECONDS, 60),
    maxPerDevice: num(env.CHECKIN_MAX_PER_DEVICE, 2),
  },
  consentRequired: flag(env.CONSENT_REQUIRED, true),
  sms: { url: env.SMS_API_URL || 'https://www.bulksmsnigeria.com/api/v1/sms/create' },
  whatsapp: { token: env.WHATSAPP_TOKEN || '', phoneId: env.WHATSAPP_PHONE_NUMBER_ID || '', apiVersion: env.WHATSAPP_API_VERSION || 'v21.0' },
  vapid: { publicKey: env.VAPID_PUBLIC_KEY || '', privateKey: env.VAPID_PRIVATE_KEY || '', subject: env.VAPID_SUBJECT || 'mailto:admin@example.org' },
  alertWebhook: env.ALERT_WEBHOOK_URL || '',
  autoBirthdaySms: flag(env.AUTO_BIRTHDAY_SMS, false),
  jobsEnabled: flag(env.JOBS_ENABLED, true),
  backup: { dir: env.BACKUP_DIR || 'backups', passphrase: env.BACKUP_PASSPHRASE || '', keep: num(env.BACKUP_KEEP, 14) },
  logLevel: env.LOG_LEVEL || (env.NODE_ENV === 'test' ? 'silent' : 'info'),
};

const PLACEHOLDER = /(change.?me|replace|your[-_ ]|example|placeholder|secret123|password)/i;

function validate() {
  const problems = [];
  if (!config.jwtSecret || config.jwtSecret.length < 48) problems.push('JWT_SECRET must be a random value of at least 48 characters (run: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))").');
  else if (PLACEHOLDER.test(config.jwtSecret)) problems.push('JWT_SECRET looks like a placeholder. Generate a fresh random value.');
  for (const key of ['host', 'name', 'user']) if (!config.db[key]) problems.push(`DB_${key.toUpperCase()} is not set.`);
  if (config.db.password === undefined) problems.push('DB_PASSWORD is not set.');
  if (problems.length) throw new Error(`Configuration problems:\n - ${problems.join('\n - ')}`);
  return config;
}

// Sub-keys are derived so that one master secret never signs and encrypts directly.
function deriveKey(purpose) {
  const master = env.DATA_ENCRYPTION_KEY ? crypto.createHash('sha256').update(env.DATA_ENCRYPTION_KEY).digest() : Buffer.from(config.jwtSecret);
  return Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), `sicc-admin:${purpose}`, 32));
}

module.exports = { config, validate, deriveKey, flag };
