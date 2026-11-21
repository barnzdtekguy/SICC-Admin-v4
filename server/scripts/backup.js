'use strict';
// Portable logical backup (no mysqldump needed, works on shared hosting).
//   npm run backup              -> backups/sicc-YYYY-MM-DD-HHMM.sql.gz   (or .enc if BACKUP_PASSPHRASE is set)
// Schedule daily from hPanel > Advanced > Cron Jobs, then copy the file off the server (see docs/OPERATIONS.md).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const { config, validate } = require('../config');

async function main() {
  validate();
  if (config.isProd && !config.backup.passphrase) throw new Error('Set BACKUP_PASSPHRASE before backing up a production database.');
  const conn = await mysql.createConnection({ host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, database: config.db.name, charset: 'utf8mb4', timezone: 'Z', dateStrings: true, multipleStatements: false });
  await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  const lines = [`-- SICC Admin backup ${new Date().toISOString()} database=${config.db.name}`, 'SET FOREIGN_KEY_CHECKS=0;', "SET NAMES utf8mb4;"];
  const [tables] = await conn.query('SHOW FULL TABLES WHERE Table_type = "BASE TABLE"');
  const counts = {};
  for (const row of tables) {
    const table = Object.values(row)[0];
    const [[create]] = await conn.query(`SHOW CREATE TABLE \`${table}\``);
    lines.push(`DROP TABLE IF EXISTS \`${table}\`;`, `${create['Create Table']};`);
    // Preserve the table schema, but force users to sign in after a restore.
    if (table === 'sessions') { counts[table] = 0; continue; }
    let offset = 0; let total = 0;
    for (;;) {
      const [rows] = await conn.query(`SELECT * FROM \`${table}\` LIMIT 500 OFFSET ${offset}`);
      if (!rows.length) break;
      const cols = Object.keys(rows[0]).map(c => `\`${c}\``).join(', ');
      lines.push(`INSERT INTO \`${table}\` (${cols}) VALUES\n${rows.map(r => `(${Object.values(r).map(v => conn.escape(v)).join(', ')})`).join(',\n')};`);
      offset += rows.length; total += rows.length;
    }
    counts[table] = total;
  }
  lines.push('SET FOREIGN_KEY_CHECKS=1;', `-- rows: ${JSON.stringify(counts)}`);
  await conn.commit();
  await conn.end();

  const dir = path.resolve(config.backup.dir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, (m) => (m === 'T' ? '-' : '')).replace(/^(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  let data = zlib.gzipSync(Buffer.from(lines.join('\n'), 'utf8'));
  let file = path.join(dir, `sicc-${stamp}.sql.gz`);
  if (config.backup.passphrase) {
    const salt = crypto.randomBytes(16); const iv = crypto.randomBytes(12);
    const key = crypto.scryptSync(config.backup.passphrase, salt, 32);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(data), cipher.final()]);
    data = Buffer.concat([Buffer.from('SICCBK1'), salt, iv, cipher.getAuthTag(), enc]);
    file += '.enc';
  } else console.warn('BACKUP_PASSPHRASE is not set: this backup contains personal data and is NOT encrypted.');
  fs.writeFileSync(file, data, { mode: 0o600 });
  const old = fs.readdirSync(dir).filter(f => /^sicc-.*\.sql\.gz(\.enc)?$/.test(f)).sort().reverse().slice(config.backup.keep);
  old.forEach(f => fs.unlinkSync(path.join(dir, f)));
  console.log(`Backup written: ${file} (${(data.length / 1024).toFixed(1)} KB, ${Object.values(counts).reduce((a, b) => a + b, 0)} rows). Pruned ${old.length} old file(s).`);
}
main().catch(e => { console.error('Backup failed:', e.message); process.exit(1); });
