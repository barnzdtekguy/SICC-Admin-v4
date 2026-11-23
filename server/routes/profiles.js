'use strict';
const express = require('express');
const crypto = require('crypto');
const { query } = require('../db');
const { asyncRoute, HttpError, sendData, str } = require('../http');
const { secured, requirePerm, publicProfile } = require('../middleware');
const { CHURCH_ROLES, PRIVILEGED, canManageRole } = require('../permissions');
const { normalizePhoneLogin } = require('../lib/phone-login');
const { validatePassword, hashPassword, generateTempPassword } = require('../lib/password');
const { revokeAllForUser } = require('../lib/sessions');
const { audit } = require('../lib/audit');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const churchRoleParams = CHURCH_ROLES.map(() => '?').join(', ');

async function loadTarget(req) {
  const rows = await query('SELECT * FROM profiles WHERE id = ? LIMIT 1', [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'User not found.');
  if (!CHURCH_ROLES.includes(rows[0].role)) throw new HttpError(404, 'User not found.');
  if (!canManageRole(req.profile.role, rows[0].role) && rows[0].id !== req.profile.id) {
    throw new HttpError(403, 'Only the Bishop can manage Bishop and Administrator accounts.');
  }
  return rows[0];
}

async function ensureAnotherActivePrivileged(excludeId) {
  const rows = await query(`SELECT COUNT(*) AS n FROM profiles WHERE is_active = 1 AND role IN ('bishop','admin') AND id <> ?`, [excludeId]);
  if (!rows[0].n) throw new HttpError(400, 'At least one active Bishop or Administrator account must remain.');
}

// Full staff list (management only).
router.get('/profiles', ...secured, requirePerm('profiles.read'), asyncRoute(async (_req, res) => {
  const rows = await query(`SELECT * FROM profiles WHERE role IN (${churchRoleParams}) ORDER BY name`, CHURCH_ROLES);
  sendData(res, rows.map(publicProfile));
}));

// Minimal directory for any signed-in user (names only; no contact details, no security fields).
router.get('/directory', ...secured, requirePerm('directory.read'), asyncRoute(async (_req, res) => {
  sendData(res, await query(`SELECT id, name, role, avatar, department, kdf_area FROM profiles WHERE is_active = 1 AND role IN (${churchRoleParams}) ORDER BY name`, CHURCH_ROLES));
}));

router.post('/profiles', ...secured, requirePerm('profiles.manage'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const name = str(body.name, { max: 160, required: true, field: 'Name' });
  const email = str(body.email, { max: 254, required: true, field: 'Email' }).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (!CHURCH_ROLES.includes(body.role)) throw new HttpError(400, 'Choose a valid user role.');
  if (!canManageRole(req.profile.role, body.role)) throw new HttpError(403, 'Only the Bishop can create Bishop and Administrator accounts.');
  const problem = validatePassword(body.password, { email, name });
  if (problem) throw new HttpError(400, problem);
  if (body.role === 'department_leader' && body.department) {
    const d = await query('SELECT 1 FROM departments WHERE name = ? LIMIT 1', [body.department]);
    if (!d.length) throw new HttpError(400, 'Choose a valid department.');
  }
  if (body.role === 'kdf_coordinator' && body.kdf_area) {
    const a = await query('SELECT 1 FROM kdf_areas WHERE name = ? LIMIT 1', [body.kdf_area]);
    if (!a.length) throw new HttpError(400, 'Choose a valid KDF area.');
  }
  const id = crypto.randomUUID();
  const avatar = String(body.avatar || name.split(/\s+/).map(p => p[0]).join('').slice(0, 2)).toUpperCase().slice(0, 8);
  const phone = str(body.phone, { max: 40 });
  await query(
    `INSERT INTO profiles (id, name, email, phone, phone_login, role, department, kdf_area, avatar, password_hash, must_change_password, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [id, name, email, phone, normalizePhoneLogin(phone), body.role, body.role === 'department_leader' ? body.department || null : null,
      body.role === 'kdf_coordinator' ? body.kdf_area || null : null, avatar, await hashPassword(body.password), req.profile.id]);
  const created = (await query('SELECT * FROM profiles WHERE id = ?', [id]))[0];
  await audit(req, { action: 'user.create', entity_type: 'profile', entity_id: id, detail: `${name} (${body.role})`, after: publicProfile(created) });
  sendData(res, publicProfile(created), 201);
}));

router.patch('/profiles/:id', ...secured, requirePerm('profiles.manage'), asyncRoute(async (req, res) => {
  const target = await loadTarget(req);
  const body = req.body || {};
  const updates = {};
  if (body.name !== undefined) updates.name = str(body.name, { max: 160, required: true, field: 'Name' });
  if (body.phone !== undefined) {
    updates.phone = str(body.phone, { max: 40 });
    updates.phone_login = normalizePhoneLogin(updates.phone) || normalizePhoneLogin(target.username);
  }
  if (body.department !== undefined) updates.department = str(body.department, { max: 180 });
  if (body.kdf_area !== undefined) updates.kdf_area = str(body.kdf_area, { max: 180 });
  if (body.role !== undefined && body.role !== target.role) {
    if (target.id === req.profile.id) throw new HttpError(400, 'You cannot change your own role.');
    if (!CHURCH_ROLES.includes(body.role)) throw new HttpError(400, 'Choose a valid user role.');
    if (!canManageRole(req.profile.role, body.role)) throw new HttpError(403, 'Only the Bishop can grant Bishop or Administrator access.');
    if (PRIVILEGED.includes(target.role) && !PRIVILEGED.includes(body.role)) await ensureAnotherActivePrivileged(target.id);
    updates.role = body.role;
  }
  if (body.is_active !== undefined && Boolean(body.is_active) !== Boolean(target.is_active)) {
    if (target.id === req.profile.id) throw new HttpError(400, 'You cannot deactivate your own account.');
    if (!body.is_active && PRIVILEGED.includes(target.role)) await ensureAnotherActivePrivileged(target.id);
    updates.is_active = body.is_active ? 1 : 0;
    updates.deactivated_at = body.is_active ? null : new Date().toISOString().slice(0, 19).replace('T', ' ');
  }
  const fields = Object.keys(updates);
  if (!fields.length) throw new HttpError(400, 'Provide at least one field to change.');
  await query(`UPDATE profiles SET ${fields.map(f => `${f} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...fields.map(f => updates[f]), target.id]);
  if (updates.is_active === 0 || updates.role) await revokeAllForUser(target.id, null, updates.is_active === 0 ? 'deactivated' : 'role_changed');
  const after = (await query('SELECT * FROM profiles WHERE id = ?', [target.id]))[0];
  await audit(req, { action: updates.is_active === 0 ? 'user.deactivate' : updates.is_active === 1 ? 'user.reactivate' : 'user.update', entity_type: 'profile', entity_id: target.id, detail: target.name, before: publicProfile(target), after: publicProfile(after) });
  sendData(res, publicProfile(after));
}));

// Accounts are never hard-deleted (that would orphan the audit trail); DELETE deactivates.
router.delete('/profiles/:id', ...secured, requirePerm('profiles.manage'), asyncRoute(async (req, res) => {
  const target = await loadTarget(req);
  if (target.id === req.profile.id) throw new HttpError(400, 'You cannot deactivate your own account.');
  if (PRIVILEGED.includes(target.role)) await ensureAnotherActivePrivileged(target.id);
  await query('UPDATE profiles SET is_active = 0, deactivated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [target.id]);
  await revokeAllForUser(target.id, null, 'deactivated');
  await audit(req, { action: 'user.deactivate', entity_type: 'profile', entity_id: target.id, detail: target.name, before: publicProfile(target) });
  sendData(res, { success: true, deactivated: true });
}));

router.post('/profiles/:id/reset-password', ...secured, requirePerm('profiles.manage'), asyncRoute(async (req, res) => {
  const target = await loadTarget(req);
  if (target.id === req.profile.id) throw new HttpError(400, 'Use Security settings to change your own password.');
  const temp = generateTempPassword();
  await query('UPDATE profiles SET password_hash = ?, must_change_password = 1, password_changed_at = NULL, failed_logins = 0, locked_until = NULL WHERE id = ?', [await hashPassword(temp), target.id]);
  await revokeAllForUser(target.id, null, 'password_reset');
  await audit(req, { action: 'user.password_reset', entity_type: 'profile', entity_id: target.id, detail: target.name });
  sendData(res, { temporary_password: temp, note: 'Share this once, in person or by a private call. They must change it at next sign-in.' });
}));

router.post('/profiles/:id/reset-mfa', ...secured, requirePerm('profiles.manage'), asyncRoute(async (req, res) => {
  const target = await loadTarget(req);
  if (target.id === req.profile.id) throw new HttpError(400, 'You cannot reset your own two-factor setup.');
  await query('UPDATE profiles SET mfa_enabled = 0, mfa_secret_enc = NULL, mfa_pending_secret_enc = NULL, mfa_recovery_hashes = NULL, mfa_last_step = NULL WHERE id = ?', [target.id]);
  await revokeAllForUser(target.id, null, 'mfa_reset');
  await audit(req, { action: 'user.mfa_reset', entity_type: 'profile', entity_id: target.id, detail: target.name });
  sendData(res, { success: true });
}));

router.post('/profiles/:id/unlock', ...secured, requirePerm('profiles.manage'), asyncRoute(async (req, res) => {
  const target = await loadTarget(req);
  await query('UPDATE profiles SET failed_logins = 0, locked_until = NULL WHERE id = ?', [target.id]);
  await audit(req, { action: 'user.unlock', entity_type: 'profile', entity_id: target.id, detail: target.name });
  sendData(res, { success: true });
}));

module.exports = router;
