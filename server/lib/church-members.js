'use strict';
const { randomUUID } = require('node:crypto');
const { query, queryOn } = require('../db');
const { phoneLast10, todayInLagos } = require('../http');
const { normalizePhoneLogin } = require('./phone-login');

const MEMBER_NAME_SQL = "CONCAT_WS(' ', first_name, NULLIF(last_name, ''))";
const BIRTHDAY_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const partialBirthdayNote = (month, day) => `Birthday: ${day} ${BIRTHDAY_MONTHS[month - 1]}`;

function listTodayBirthdays(now = new Date()) {
  const [, month, day] = todayInLagos(now).split('-').map(Number);
  // The register importer stores resolved yearless birthdays in this exact note format.
  return query(`SELECT id, ${MEMBER_NAME_SQL} AS name FROM members
    WHERE deleted_at IS NULL AND (
      (MONTH(date_of_birth) = ? AND DAYOFMONTH(date_of_birth) = ?)
      OR (date_of_birth IS NULL AND register_import_key IS NOT NULL AND BINARY notes = BINARY ?)
    ) ORDER BY first_name, last_name, id`, [month, day, partialBirthdayNote(month, day)]);
}

const titlePrefix = /^(?:(?:archbishop|bishop|rev(?:erend)?\.?|pastor|pst\.?|apostle|evangelist|elder|deacon(?:ess)?|dr\.?|prof\.?|barr?\.?|mrs?\.?|ms\.?|miss|bro\.?|sis\.?)\s+)+/iu;

function splitTitle(fullName) {
  const name = fullName.trim();
  const title = name.match(titlePrefix)?.[0] || '';
  return { title: title.trim() || null, name: name.slice(title.length) };
}

function splitName(name) {
  const letters = [...name];
  const firstSpace = letters.findIndex(char => /\s/u.test(char));
  const cut = firstSpace > 0 && firstSpace <= 120 && letters.length - firstSpace <= 121 ? firstSpace : Math.min(120, letters.length);
  return { first_name: letters.slice(0, cut).join('').trim(), last_name: letters.slice(cut).join('').trim() };
}

function identity(person) {
  const fullName = person.full_name ?? `${person.first_name} ${person.last_name}`;
  const { name } = splitTitle(fullName.normalize('NFKC'));
  const tokens = name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const phone = normalizePhoneLogin(person.phone) || String(person.phone || '').replace(/\D/g, '');
  return {
    name: tokens.sort().join(' '),
    phone: phone.length >= 7 ? phone : '',
    email: String(person.email || '').trim().toLowerCase(),
  };
}

function matchMember(person, directory) {
  const key = identity(person);
  const matches = directory.filter(member => ['name', 'phone', 'email'].some(field => key[field] && key[field] === member.identity[field]));
  if (!matches.length) return { status: 'new' };
  if (matches.length > 1) return { status: 'review', reason: 'multiple_matches' };
  const [match] = matches;
  if (match.deleted_at) return { status: 'review', reason: 'deleted_match' };
  const contacts = ['phone', 'email'];
  const contactMatches = contacts.some(field => key[field] && key[field] === match.identity[field]);
  const contactConflict = contacts.some(field => key[field] && match.identity[field] && key[field] !== match.identity[field]);
  if (key.name && key.name === match.identity.name && contactMatches && !contactConflict) return { status: 'linked', member: match };
  return { status: 'review', reason: 'unconfirmed_match' };
}

async function lockDirectory(conn) {
  const [lock] = await queryOn(conn, "SELECT setting_key FROM app_settings WHERE setting_key = 'church_directory_lock' FOR UPDATE");
  if (!lock) throw new Error('Run the church directory migration first.');
}

async function memberIdentities(conn, { legacy = false } = {}) {
  const rows = await queryOn(conn, `SELECT id, first_name, last_name, phone, email, deleted_at${legacy ? '' : ', register_import_key'}
    FROM members${conn ? ' FOR UPDATE' : ''}`);
  return rows.map(row => ({ ...row, identity: identity(row) }));
}

async function insertMember(conn, data) {
  const record = { id: randomUUID(), ...data, phone_last10: phoneLast10(data.phone) };
  const fields = Object.keys(record);
  await queryOn(conn, `INSERT INTO members (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`, Object.values(record));
  return record;
}

module.exports = { MEMBER_NAME_SQL, BIRTHDAY_MONTHS, partialBirthdayNote, listTodayBirthdays,
  splitTitle, splitName, identity, matchMember, lockDirectory, memberIdentities, insertMember };
