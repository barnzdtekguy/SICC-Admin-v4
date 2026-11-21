'use strict';
// Verifies a backup can be read, and optionally restores it into a SCRATCH database to prove it works.
//   node server/scripts/restore-check.js backups/sicc-....sql.gz[.enc]
//   node server/scripts/restore-check.js <file> --into sicc_restore_test   (database must already exist and be empty)
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const { config } = require('../config');

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: restore-check.js <backup-file> [--into <scratch-database>]');
  let data = fs.readFileSync(file);
  if (data.subarray(0, 7).toString() === 'SICCBK1') {
    if (!config.backup.passphrase) throw new Error('This backup is encrypted. Set BACKUP_PASSPHRASE.');
    const salt = data.subarray(7, 23); const iv = data.subarray(23, 35); const tag = data.subarray(35, 51);
    const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(config.backup.passphrase, salt, 32), iv);
    d.setAuthTag(tag);
    data = Buffer.concat([d.update(data.subarray(51)), d.final()]);
  }
  const sql = zlib.gunzipSync(data).toString('utf8');
  const tables = [...sql.matchAll(/^CREATE TABLE `([^`]+)`/gm)].map(m => m[1]);
  console.log(`Readable. ${tables.length} tables: ${tables.join(', ')}`);
  console.log(sql.split('\n').filter(l => l.startsWith('-- rows:')).join('\n'));
  if (process.argv.length === 3) return;
  const into = process.argv[4];
  if (process.argv.length !== 5 || process.argv[3] !== '--into' || !into) {
    throw new Error('Usage: restore-check.js <backup-file> [--into <scratch-database>]');
  }
  if (into === config.db.name) throw new Error('Refusing to restore over the live database.');
  const conn = await mysql.createConnection({ host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, database: into, multipleStatements: true, charset: 'utf8mb4' });
  try {
    const [existing] = await conn.query('SHOW FULL TABLES');
    if (existing.length) throw new Error('Refusing to restore into a database that contains tables or views.');
    await conn.query(sql);
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM profiles');
    console.log(`Restore into "${into}" succeeded. profiles: ${n}`);
  } finally {
    await conn.end();
  }
}
main().catch(e => { console.error('Restore check failed:', e.message); process.exit(1); });
