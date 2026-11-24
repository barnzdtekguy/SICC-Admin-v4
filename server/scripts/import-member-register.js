'use strict';
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const { pool, query } = require('../db');
const { validDate, todayStr } = require('../http');
const { auditTransaction } = require('../lib/audit');
const { BIRTHDAY_MONTHS, partialBirthdayNote, identity, splitTitle, splitName, matchMember, lockDirectory, memberIdentities, insertMember } = require('../lib/church-members');

function birthdayFields(value) {
  if (!value) return {};
  if (validDate(value) && value >= '1900-01-01' && value <= todayStr()) return { date_of_birth: value };
  const cleaned = value.toLowerCase().replace(/(\d)(st|nd|rd|th)/g, '$1').replace(/[^\da-z]+/g, ' ').trim();
  const partial = cleaned.match(/^(\d{1,2})\s*([a-z]+)$/) || cleaned.match(/^([a-z]+)\s*(\d{1,2})$/);
  const numeric = value.match(/^(\d{2})-(\d{2})$/);
  const word = partial?.slice(1).find(part => /^[a-z]+$/.test(part));
  const day = Number(numeric?.[2] ?? partial?.slice(1).find(part => /^\d+$/.test(part)));
  const month = numeric ? Number(numeric[1]) : BIRTHDAY_MONTHS.findIndex(full => word?.length >= 3 && full.toLowerCase().startsWith(word)) + 1;
  if (!validDate(`2000-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)) return null;
  return { notes: partialBirthdayNote(month, day) };
}

function readRegister(path) {
  const python = process.env.SICC_IMPORT_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const result = spawnSync(python, [join(__dirname, 'read-member-register.py'), path], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw Object.assign(new Error('Could not start Python. Set SICC_IMPORT_PYTHON to a Python 3 executable.'), { publicMessage: true });
  if (result.status !== 0) throw Object.assign(new Error('Could not read the register workbook or find its expected columns.'), { publicMessage: true });
  return JSON.parse(result.stdout).map(({ sheet, row, data, problems }) => {
    const reference = `${sheet}!${row}`;
    const inline = splitTitle(data.name);
    const prefix = data.title;
    const title = [prefix, inline.title].filter(Boolean).filter((value, index, parts) => !index || value.toLowerCase() !== parts[0].toLowerCase()).join(' ');
    const name = inline.name.replace(/\s+/gu, ' ');
    const birthday = birthdayFields(data.birthday);
    const member = { ...splitName(name), title: title || null, phone: data.phone || null, email: data.email || null, ...birthday,
      register_import_key: createHash('sha256').update(JSON.stringify(data)).digest('hex') };
    if (!birthday && !problems.includes('ambiguous_birthday_format')) problems.push('invalid_birthday');
    if (!/\p{L}/u.test(name) || [...name].length > 240 || title.length > 80) problems.push('invalid_name_or_title');
    if (data.phone && (!/^[+\d ().-]+$/.test(data.phone) || data.phone.replace(/\D/g, '').length < 7 || data.phone.length > 40)) problems.push('invalid_phone');
    if (data.email && (data.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(data.email))) problems.push('invalid_email');
    return { reference, member, identity: identity(member), problems };
  });
}

function planImport(entries, directory) {
  const seen = new Set(directory.filter(member => member.register_import_key).map(member => member.register_import_key));
  const firstRows = new Map();
  const sourceRows = new Map();
  const keys = entry => Object.entries(entry.identity).filter(([, value]) => value).map(([field, value]) => `${field}:${value}`);
  for (const entry of entries) {
    if (firstRows.has(entry.member.register_import_key)) continue;
    firstRows.set(entry.member.register_import_key, entry.reference);
    for (const key of keys(entry)) {
      if (!sourceRows.has(key)) sourceRows.set(key, []);
      sourceRows.get(key).push(entry.reference);
    }
  }
  return entries.map(entry => {
    const duplicateOf = firstRows.get(entry.member.register_import_key);
    if (duplicateOf !== entry.reference) return { ...entry, outcome: 'duplicatesInRegister', duplicateOf };
    if (seen.has(entry.member.register_import_key)) return { ...entry, outcome: 'alreadyExists' };
    if (entry.problems.length) return { ...entry, outcome: 'needsReview' };
    const relatedRows = [...new Set(keys(entry).flatMap(key => sourceRows.get(key)))].filter(row => row !== entry.reference);
    if (relatedRows.length) return { ...entry, outcome: 'needsReview', problems: ['overlapping_register_entries'], relatedRows };
    const match = matchMember(entry.member, directory);
    if (match.status === 'review') return { ...entry, outcome: 'needsReview', problems: [match.reason] };
    return { ...entry, outcome: match.status === 'linked' ? 'alreadyExists' : 'ready' };
  });
}

function report(plan, mode) {
  const rows = { ready: [], alreadyExists: [], needsReview: [], duplicatesInRegister: [] };
  for (const { outcome, reference, problems, duplicateOf, relatedRows } of plan) {
    const row = duplicateOf ? { row: reference, duplicateOf } : problems.length ? { row: reference, reasons: problems, relatedRows } : reference;
    rows[outcome].push(row);
  }
  return { mode, entries: plan.length, counts: Object.fromEntries(Object.entries(rows).map(([key, refs]) => [key, refs.length])), rows };
}

async function main(args) {
  const [path, flag, ...extra] = args;
  if (!path || extra.length || (flag && flag !== '--apply')) {
    console.error('Usage: npm run import-members -- <register.xlsx> [--apply]');
    process.exitCode = 1;
    return;
  }
  const entries = readRegister(path);
  const [column] = await query("SHOW COLUMNS FROM members LIKE 'register_import_key'");
  if (!flag) {
    const directory = await memberIdentities(null, { legacy: !column });
    console.log(JSON.stringify(report(planImport(entries, directory), 'dry-run'), null, 2));
    return;
  }
  if (!column) throw Object.assign(new Error('Run the church directory migration before applying the import.'), { publicMessage: true });
  const result = await auditTransaction(null, async conn => {
    await lockDirectory(conn);
    const plan = planImport(entries, await memberIdentities(conn));
    const output = report(plan, 'applied');
    for (const { member, outcome } of plan) {
      if (outcome === 'ready') await insertMember(conn, { ...member, status: 'Active Member', spiritual_status: '' });
    }
    const inserted = output.counts.ready;
    return { data: { ...output, inserted }, event: inserted ? { action: 'members.register_import', entity_type: 'member', after: output.counts } : undefined };
  });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.publicMessage ? error.message : `Register import failed (${error.code || 'unexpected error'}).`);
    process.exitCode = 1;
  }).finally(() => pool.end());
}

module.exports = { readRegister, planImport, report };
