'use strict';
const crypto = require('crypto');
const { query } = require('./db');
const { validatePassword, hashPassword } = require('./lib/password');
const { audit } = require('./lib/audit');

// Creates the very first administrator from INITIAL_ADMIN_* variables, only when no accounts exist.
// The account must change this password at first sign-in, then the variables can be deleted.
async function bootstrapAdmin(env = process.env) {
  const [{ n }] = await query('SELECT COUNT(*) AS n FROM profiles');
  if (n > 0) return false;
  const email = String(env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = env.INITIAL_ADMIN_PASSWORD || '';
  const name = env.INITIAL_ADMIN_NAME || 'System Administrator';
  const role = ['bishop', 'admin'].includes(env.INITIAL_ADMIN_ROLE) ? env.INITIAL_ADMIN_ROLE : 'bishop';
  if (!email || !password) { console.warn('No accounts exist yet. Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD to create the first administrator.'); return false; }
  const problem = validatePassword(password, { email, name });
  if (problem) throw new Error(`INITIAL_ADMIN_PASSWORD rejected: ${problem}`);
  const id = crypto.randomUUID();
  await query("INSERT INTO profiles (id, name, email, role, avatar, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, ?, 1)",
    [id, name, email, role, name.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase(), await hashPassword(password)]);
  await audit(null, { action: 'system.bootstrap_admin', entity_type: 'profile', entity_id: id, detail: `Created first account ${email} (${role})`, actor: { id: null, name: 'system', role: null } });
  console.info(`Created first account (${email}). It must set a new password on first sign-in; remove INITIAL_ADMIN_PASSWORD from the environment.`);
  return true;
}
module.exports = { bootstrapAdmin };
