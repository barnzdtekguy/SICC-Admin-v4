'use strict';
// Versioned, idempotent migrations. Runs automatically on server start, so no manual
// phpMyAdmin import is needed any more. Each migration runs once and is recorded.
const fs = require('fs');
const path = require('path');
const { pool, query, rawQuery, transaction } = require('./db');
const { config } = require('./config');
const { encrypt, isEncrypted } = require('./lib/crypto');
const { phoneLast10 } = require('./http');
const { normalizePhoneLogin } = require('./lib/phone-login');
const lists = require('./data/lists.json');
const { RETIRED_PROGRAMME_ID, RETIRED_PROGRAMME_TYPE } = require('./lib/programmes');

const log = (...args) => { if (!config.isTest) console.info('[migrate]', ...args); };

async function columnExists(table, column) {
  const rows = await query('SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1', [table, column]);
  return rows.length > 0;
}
async function indexExists(table, name) {
  const rows = await query('SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1', [table, name]);
  return rows.length > 0;
}
async function addColumn(table, column, ddl) {
  if (!(await columnExists(table, column))) await rawQuery(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`);
}
async function addIndex(table, name, columns, { unique = false, tolerant = false } = {}) {
  if (await indexExists(table, name)) return;
  try {
    await rawQuery(`ALTER TABLE \`${table}\` ADD ${unique ? 'UNIQUE ' : ''}INDEX \`${name}\` (${columns})`);
  } catch (error) {
    if (!tolerant) throw error;
    console.warn(`[migrate] Could not create ${unique ? 'unique ' : ''}index ${name} on ${table}: ${error.message}. The application still enforces this rule; run \`npm run find-duplicates\`, remove the extra rows, then restart.`);
  }
}

async function runSqlFile(file) {
  const sql = fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r/g, '');
  for (const statement of sql.split(/;\s*\n/).map(s => s.trim()).filter(Boolean)) await rawQuery(statement);
}

const migrations = [
  { id: '001_baseline', up: async () => runSqlFile('schema.sql') },

  {
    id: '002_auth_hardening',
    up: async () => {
      const existing = await query('SELECT COUNT(*) AS n FROM profiles');
      const cols = {
        must_change_password: 'TINYINT(1) NOT NULL DEFAULT 0',
        password_changed_at: 'TIMESTAMP NULL',
        last_login_at: 'TIMESTAMP NULL',
        last_login_ip: 'VARCHAR(64) NULL',
        failed_logins: 'INT NOT NULL DEFAULT 0',
        locked_until: 'TIMESTAMP NULL',
        mfa_enabled: 'TINYINT(1) NOT NULL DEFAULT 0',
        mfa_secret_enc: 'TEXT NULL',
        mfa_pending_secret_enc: 'TEXT NULL',
        mfa_recovery_hashes: 'TEXT NULL',
        mfa_last_step: 'BIGINT NULL',
        updated_at: 'TIMESTAMP NULL',
        deactivated_at: 'TIMESTAMP NULL',
        created_by: 'CHAR(36) NULL',
      };
      for (const [name, ddl] of Object.entries(cols)) await addColumn('profiles', name, ddl);
      // Accounts created under the old 8-character policy must choose a compliant password.
      if (existing[0].n > 0) await rawQuery('UPDATE profiles SET must_change_password = 1 WHERE password_changed_at IS NULL');
    },
  },

  {
    id: '003_sessions',
    up: async () => {
      await rawQuery(`CREATE TABLE IF NOT EXISTS sessions (
        id CHAR(36) PRIMARY KEY,
        user_id CHAR(36) NOT NULL,
        remember TINYINT(1) NOT NULL DEFAULT 0,
        mfa_passed TINYINT(1) NOT NULL DEFAULT 0,
        ip VARCHAR(64) NULL,
        user_agent VARCHAR(255) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        revoked_at TIMESTAMP NULL,
        revoked_reason VARCHAR(60) NULL,
        INDEX sessions_user_idx (user_id, revoked_at),
        CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    },
  },

  {
    id: '004_tamper_evident_audit',
    up: async () => {
      await addColumn('activity_logs', 'seq', 'BIGINT NOT NULL AUTO_INCREMENT, ADD UNIQUE KEY activity_logs_seq_uq (seq)');
      const cols = {
        role: 'VARCHAR(40) NULL', entity_type: 'VARCHAR(60) NULL', entity_id: 'VARCHAR(120) NULL',
        before_json: 'LONGTEXT NULL', after_json: 'LONGTEXT NULL', ip: 'VARCHAR(64) NULL',
        user_agent: 'VARCHAR(255) NULL', request_id: 'VARCHAR(40) NULL', prev_hash: 'CHAR(64) NULL', hash: 'CHAR(64) NULL',
      };
      for (const [name, ddl] of Object.entries(cols)) await addColumn('activity_logs', name, ddl);
      await addIndex('activity_logs', 'activity_logs_entity_idx', 'entity_type, entity_id');
      await addIndex('activity_logs', 'activity_logs_action_idx', 'action');
      await ensureAuditTriggers();
    },
  },

  {
    id: '005_data_integrity',
    up: async () => {
      await addColumn('members', 'updated_at', 'TIMESTAMP NULL');
      await addColumn('members', 'updated_by', 'CHAR(36) NULL');
      await addColumn('members', 'updated_by_name', 'VARCHAR(160) NULL');
      await addColumn('members', 'deleted_at', 'TIMESTAMP NULL');
      await addColumn('members', 'deleted_by', 'CHAR(36) NULL');
      await addColumn('members', 'delete_reason', 'VARCHAR(300) NULL');
      await addColumn('members', 'consent_given', 'TINYINT(1) NOT NULL DEFAULT 0');
      await addColumn('members', 'consent_at', 'TIMESTAMP NULL');
      await addColumn('members', 'phone_last10', 'CHAR(10) NULL');
      await addColumn('follow_ups', 'updated_at', 'TIMESTAMP NULL');
      await addColumn('follow_ups', 'updated_by_name', 'VARCHAR(160) NULL');
      await addColumn('follow_ups', 'deleted_at', 'TIMESTAMP NULL');
      await addColumn('attendance', 'dept_key', "VARCHAR(180) NOT NULL DEFAULT ''");
      await addColumn('attendance', 'status', "VARCHAR(20) NOT NULL DEFAULT 'recorded'");
      await addColumn('attendance', 'verified_by_name', 'VARCHAR(160) NULL');
      await addColumn('attendance', 'verified_at', 'TIMESTAMP NULL');
      await addColumn('attendance', 'updated_at', 'TIMESTAMP NULL');
      await addColumn('attendance', 'updated_by_name', 'VARCHAR(160) NULL');
      for (const [col, ddl] of Object.entries({
        identity_key: "VARCHAR(255) NOT NULL DEFAULT ''", source: "VARCHAR(20) NOT NULL DEFAULT 'manual'", device_id: 'VARCHAR(64) NULL',
        ip: 'VARCHAR(64) NULL', geo_verified: 'TINYINT(1) NOT NULL DEFAULT 0', phone_last10: 'CHAR(10) NULL', updated_by_name: 'VARCHAR(160) NULL',
      })) await addColumn('programme_attendance_records', col, ddl);
      for (const [col, ddl] of Object.entries({
        geo_lat: 'DECIMAL(9,6) NULL', geo_lng: 'DECIMAL(9,6) NULL', geo_radius_m: 'INT NULL', require_token: 'TINYINT(1) NOT NULL DEFAULT 1',
      })) await addColumn('attendance_programmes', col, ddl);

      await rawQuery("UPDATE attendance SET dept_key = COALESCE(dept_name, '') WHERE dept_key = ''");
      await rawQuery("UPDATE programme_attendance_records SET identity_key = COALESCE(NULLIF(phone_normalized, ''), CONCAT('n:', LOWER(TRIM(attendee_name)))) WHERE identity_key = ''");
      await backfillPhoneLast10('members', 'phone');
      await backfillPhoneLast10('programme_attendance_records', 'phone');

      await ensureUniqueIndexes();
      await addIndex('members', 'members_phone_last10_idx', 'phone_last10');
      await addIndex('members', 'members_created_idx', 'created_at');
      await addIndex('members', 'members_deleted_idx', 'deleted_at');
      await addIndex('programme_attendance_records', 'programme_records_last10_idx', 'phone_last10');
      await addIndex('programme_attendance_records', 'programme_records_device_idx', 'programme_id, attendance_date, device_id');
      await addIndex('follow_ups', 'follow_ups_status_idx', 'status, created_at');

      await rawQuery(`CREATE TABLE IF NOT EXISTS record_revisions (
        id CHAR(36) PRIMARY KEY,
        entity_type VARCHAR(60) NOT NULL,
        entity_id VARCHAR(120) NOT NULL,
        revision_json LONGTEXT NOT NULL,
        reason VARCHAR(400) NULL,
        changed_by CHAR(36) NULL,
        changed_by_name VARCHAR(160) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX record_revisions_entity_idx (entity_type, entity_id)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

      await rawQuery(`CREATE TABLE IF NOT EXISTS correction_requests (
        id CHAR(36) PRIMARY KEY,
        entity_type VARCHAR(60) NOT NULL,
        entity_id VARCHAR(120) NOT NULL,
        entity_label VARCHAR(300) NULL,
        proposed_json LONGTEXT NOT NULL,
        current_json LONGTEXT NULL,
        reason VARCHAR(600) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        requested_by CHAR(36) NULL,
        requested_by_name VARCHAR(160) NULL,
        decided_by CHAR(36) NULL,
        decided_by_name VARCHAR(160) NULL,
        decided_at TIMESTAMP NULL,
        decision_note VARCHAR(600) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX correction_status_idx (status, created_at),
        INDEX correction_entity_idx (entity_type, entity_id)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    },
  },

  {
    id: '006_reference_data',
    up: async () => {
      await rawQuery(`CREATE TABLE IF NOT EXISTS departments (
        id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(180) NOT NULL UNIQUE, color VARCHAR(16) NULL,
        sort_order INT NOT NULL DEFAULT 0, is_active TINYINT(1) NOT NULL DEFAULT 1
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      await rawQuery(`CREATE TABLE IF NOT EXISTS kdf_areas (
        id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(180) NOT NULL UNIQUE,
        sort_order INT NOT NULL DEFAULT 0, is_active TINYINT(1) NOT NULL DEFAULT 1
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      // One-time rename of legacy department names (previously re-run on every boot).
      const renames = {
        'Missions Prayer': 'Missions', 'KDF Training': 'KDF', 'Assimilation & Covenant Friends': 'Assimilation / Covenant Friends',
        'Wealth Creation & Cooperative': 'Wealth Creation / Cooperative', 'Facility Management & Projects': 'Facility Management / Projects',
        'Education & Scholarship': 'Education / Scholarship', 'Bookshop & Reading Culture': 'Bookshop / Reading Culture',
        'Healing & Deliverance': 'Healing & Deliverance Crack Team', 'Crack Team': 'Healing & Deliverance Crack Team',
        'Counselling & Call Centre': 'Counselling / Call Centre', 'Marriage & Couples': 'Marriage / Couples', 'Publicity & Branding': 'Publicity / Branding',
      };
      for (const [from, to] of Object.entries(renames)) {
        for (const table of ['members', 'profiles']) await query(`UPDATE ${table} SET department = ? WHERE department = ?`, [to, from]);
        await query('UPDATE attendance SET dept_name = ?, dept_key = ? WHERE dept_name = ?', [to, to, from]);
      }
      for (const d of lists.departments) {
        await query('INSERT IGNORE INTO departments (name, color, sort_order) VALUES (?, ?, ?)', [d.name, d.color, d.sort_order]);
      }
      for (const a of lists.kdfAreas) await query('INSERT IGNORE INTO kdf_areas (name, sort_order) VALUES (?, ?)', [a.name, a.sort_order]);
      await query("INSERT IGNORE INTO kdf_areas (name, sort_order) VALUES ('General Area', 998)");
      // Keep any department/zone already used in data, so nothing becomes invalid.
      for (const table of ['members', 'profiles']) {
        await rawQuery(`INSERT IGNORE INTO departments (name, sort_order) SELECT DISTINCT department, 999 FROM ${table} WHERE department IS NOT NULL AND department <> ''`);
      }
      await rawQuery("INSERT IGNORE INTO kdf_areas (name, sort_order) SELECT DISTINCT kdf_area, 999 FROM members WHERE kdf_area IS NOT NULL AND kdf_area <> ''");
      await rawQuery("INSERT IGNORE INTO kdf_areas (name, sort_order) SELECT DISTINCT kdf_area, 999 FROM profiles WHERE kdf_area IS NOT NULL AND kdf_area <> ''");
    },
  },

  {
    id: '007_notifications_and_messaging',
    up: async () => {
      await rawQuery(`CREATE TABLE IF NOT EXISTS notifications (
        id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, type VARCHAR(40) NOT NULL DEFAULT 'info',
        title VARCHAR(200) NOT NULL, body VARCHAR(600) NULL, link VARCHAR(200) NULL,
        read_at TIMESTAMP NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX notifications_user_idx (user_id, read_at, created_at),
        CONSTRAINT notifications_user_fk FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      await rawQuery(`CREATE TABLE IF NOT EXISTS push_subscriptions (
        id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, endpoint VARCHAR(500) NOT NULL, p256dh VARCHAR(255) NOT NULL, auth VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY push_endpoint_uq (endpoint),
        CONSTRAINT push_user_fk FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      await rawQuery(`CREATE TABLE IF NOT EXISTS message_log (
        id CHAR(36) PRIMARY KEY, channel VARCHAR(20) NOT NULL, audience VARCHAR(200) NULL, recipients INT NOT NULL DEFAULT 0,
        body_excerpt VARCHAR(200) NULL, status VARCHAR(20) NOT NULL, provider_response VARCHAR(500) NULL,
        sent_by CHAR(36) NULL, sent_by_name VARCHAR(160) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX message_log_created_idx (created_at)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      await rawQuery(`CREATE TABLE IF NOT EXISTS app_settings (
        setting_key VARCHAR(80) PRIMARY KEY, setting_value TEXT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    },
  },

  {
    id: '009_submitted_reports',
    up: async () => {
      await rawQuery(`CREATE TABLE IF NOT EXISTS submitted_reports (
        id CHAR(36) PRIMARY KEY, kind VARCHAR(20) NOT NULL, scope VARCHAR(180) NULL, body TEXT NOT NULL,
        submitted_by CHAR(36) NULL, submitted_by_name VARCHAR(160) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX submitted_reports_created_idx (created_at)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    },
  },

  {
    id: '008_encrypt_sms_key',
    up: async () => {
      const rows = await query('SELECT api_key FROM sms_config WHERE id = 1');
      if (rows[0]?.api_key && !isEncrypted(rows[0].api_key)) {
        await query('UPDATE sms_config SET api_key = ? WHERE id = 1', [encrypt(rows[0].api_key)]);
      }
    },
  },
  {
    id: '010_retire_32_day_programme',
    up: async () => transaction(async conn => {
      const retired = [RETIRED_PROGRAMME_ID, RETIRED_PROGRAMME_TYPE];
      await conn.execute('UPDATE attendance_programmes SET is_active = 0 WHERE id = ? OR programme_type = ?', retired);
      await conn.execute(`UPDATE correction_requests AS c
        LEFT JOIN programme_attendance_records AS r ON c.entity_type = 'programme_record' AND c.entity_id = r.id
        SET c.status = 'cancelled', c.decided_at = CURRENT_TIMESTAMP, c.decision_note = 'The 32-day programme was retired.'
        WHERE c.status = 'pending' AND (c.entity_type = 'greatness_attendance' OR r.programme_id = ? OR r.programme_type = ?)`, retired);
    }),
  },
  {
    id: '011_red_onboarding',
    up: async () => {
      const profiles = await query('SELECT id, phone, username FROM profiles');
      const keys = profiles.map(row => ({
        id: row.id,
        phone: normalizePhoneLogin(row.phone) || normalizePhoneLogin(row.username),
      })).filter(row => row.phone);
      await addColumn('profiles', 'phone_login', 'VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL');
      await transaction(async connection => {
        for (const row of keys) await connection.execute('UPDATE profiles SET phone_login = ? WHERE id = ?', [row.phone, row.id]);
      });
      await addIndex('profiles', 'profiles_phone_login_idx', 'phone_login');
      // Legacy staff may share a contact number. A phone used as a R.E.D. login has one owner.
      await addColumn('profiles', 'red_phone_login', "VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN role IN ('red_leader','red_member') THEN phone_login ELSE NULL END) STORED");
      await addIndex('profiles', 'profiles_red_phone_login_unique', 'red_phone_login', { unique: true });
      const [emailColumn] = await query("SELECT IS_NULLABLE AS nullable FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'profiles' AND column_name = 'email'");
      if (emailColumn?.nullable === 'NO') await rawQuery('ALTER TABLE profiles MODIFY COLUMN email VARCHAR(254) NULL');
      await runSqlFile('red-phase-1.sql');
    },
  },
];

// Belt and braces: block edits/deletes of audit rows at the database level where the host allows triggers.
// Runs on every boot so triggers are restored after a backup restore (DROP TABLE removes them).
async function ensureAuditTriggers() {
  for (const [name, event] of [['activity_logs_no_update', 'UPDATE'], ['activity_logs_no_delete', 'DELETE']]) {
    const have = await query('SELECT 1 FROM information_schema.triggers WHERE trigger_schema = DATABASE() AND trigger_name = ? LIMIT 1', [name]);
    if (have.length) continue;
    try {
      await rawQuery(`CREATE TRIGGER ${name} BEFORE ${event} ON activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit log rows are append-only'`);
    } catch (error) {
      console.warn(`[migrate] Could not create trigger ${name} (${error.message}). The hash chain still detects tampering.`);
    }
  }
}

// Retried on every start, so once old duplicate rows are cleaned up (see: npm run find-duplicates) the
// database-level protection switches on by itself. Until then the application enforces the same rule.
async function ensureUniqueIndexes() {
  await addIndex('attendance', 'attendance_unique_session', 'date, service, dept_key', { unique: true, tolerant: true });
  await addIndex('programme_attendance_records', 'programme_records_unique_person', 'programme_id, attendance_date, identity_key', { unique: true, tolerant: true });
}

async function backfillPhoneLast10(table, column) {
  const rows = await query(`SELECT id, ${column} AS phone FROM ${table} WHERE ${column} IS NOT NULL AND phone_last10 IS NULL`);
  for (const row of rows) {
    const last10 = phoneLast10(row.phone);
    if (last10) await query(`UPDATE ${table} SET phone_last10 = ? WHERE id = ?`, [last10, row.id]);
  }
}

async function migrate() {
  const conn = await pool.getConnection();
  try {
    const [[lock]] = await conn.query("SELECT GET_LOCK('sicc_migrate', 60) AS got");
    if (lock.got !== 1) throw new Error('Could not obtain the migration lock.');
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(80) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4`);
    const [done] = await conn.query('SELECT id FROM schema_migrations');
    const applied = new Set(done.map(r => r.id));
    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;
      log(`applying ${migration.id}`);
      await migration.up();
      await conn.query('INSERT INTO schema_migrations (id) VALUES (?)', [migration.id]);
    }
    await ensureAuditTriggers();
    await ensureUniqueIndexes();
  } finally {
    await conn.query("SELECT RELEASE_LOCK('sicc_migrate')").catch(() => {});
    conn.release();
  }
}

module.exports = { migrate, migrations };
