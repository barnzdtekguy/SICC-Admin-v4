'use strict';
// Lists duplicate attendance rows that block the database-level uniqueness rule (read-only).
const { validate } = require('../config');
const { query, pool } = require('../db');
(async () => {
  validate();
  const a = await query("SELECT date, service, dept_key, COUNT(*) AS copies, GROUP_CONCAT(id ORDER BY created_at) AS ids, GROUP_CONCAT(count ORDER BY created_at) AS counts FROM attendance GROUP BY date, service, dept_key HAVING COUNT(*) > 1");
  const r = await query("SELECT programme_id, attendance_date, identity_key, COUNT(*) AS copies, GROUP_CONCAT(id ORDER BY created_at) AS ids FROM programme_attendance_records GROUP BY programme_id, attendance_date, identity_key HAVING COUNT(*) > 1");
  console.log(`Duplicate department/church attendance groups: ${a.length}`);
  a.forEach(x => console.log(`  ${x.date} · ${x.service} · ${x.dept_key || 'church-wide'} → counts [${x.counts}]\n    ids: ${x.ids}`));
  console.log(`Duplicate person check-in groups: ${r.length}`);
  r.forEach(x => console.log(`  ${x.attendance_date} · ${x.programme_id} · ${x.identity_key} (${x.copies} copies)\n    ids: ${x.ids}`));
  if (a.length + r.length) console.log('\nKeep the correct row of each group, delete the others (back up first: npm run backup), then restart the server.');
  else console.log('\nNo duplicates. Uniqueness is enforced by the database.');
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
