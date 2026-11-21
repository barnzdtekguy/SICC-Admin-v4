# Operations guide

## Daily / weekly
| What | How |
|---|---|
| **Backup** (daily) | `npm run backup` writes an encrypted file into `backups/`. On Hostinger: hPanel → Advanced → **Cron Jobs** → daily at 02:00 → `cd ~/domains/YOUR-DOMAIN/app && /usr/bin/node server/scripts/backup.js` (adjust the path). Set `BACKUP_PASSPHRASE` first. |
| **Copy backups off the server** | Download the newest file weekly (File Manager or SFTP) to your computer **and** a cloud drive. A backup only on the same server is not a backup. |
| **Check the audit trail** | Bishop/Admin → *Audit Trail* → **Verify integrity**. Green = no entry was altered or removed. |
| **Uptime alert** | Add `https://YOUR-DOMAIN/api/health` to UptimeRobot / Better Stack (free). Alert goes to your phone/email if the site is down. |
| **Error alerts** | Set `ALERT_WEBHOOK_URL` (Slack, Discord or Teams incoming webhook). You get a message on server errors and account lockouts. |

## Prove your backups work (do this once now, then quarterly)
```bash
# 1. Create an empty scratch database in hPanel, e.g. yourprefix_restore_test, and give your DB user access.
# 2. Check the file is readable and complete:
npm run restore-check -- backups/sicc-2026-11-16-0200.sql.gz.enc
# 3. Actually restore it into the scratch database and count rows:
npm run restore-check -- backups/sicc-2026-11-16-0200.sql.gz.enc --into yourprefix_restore_test
```
The tool requires an empty database and refuses to restore over the configured live database. Backups preserve the sessions table structure and omit active sessions, so users sign in again after a restore.

## Incidents
- **Someone lost their phone / can't get a 2FA code:** use a recovery code. If none: the Bishop opens *User Accounts → Manage → Reset two-step verification*. They will set it up again at next sign-in.
- **Forgot password:** an Admin/Bishop opens *User Accounts → Manage → Reset password*, gives the one-time temporary password privately. (There is no email reset link yet because the app has no email service.)
- **Account locked:** wait 15 minutes, or *Manage → Unlock sign-in*.
- **Phone stolen / suspect a stolen session:** the person (or an admin) uses *Security & devices → Sign out all other devices*, or Admin *Deactivate* signs them out everywhere immediately.
- **Audit check says "TAMPERING DETECTED":** stop, do not restart or restore. Make a copy of the database, then investigate who has database (phpMyAdmin / hosting) access. Rotate the hosting password and database password.
- **Leaked secret (.env shared, pushed to GitHub, emailed):** rotate `JWT_SECRET` (signs everyone out), the database password, and the SMS API key. If you rotate `DATA_ENCRYPTION_KEY`, re-enter the SMS key and have users with 2FA reset it, because those values are encrypted with it.

## Reading logs
Logs are JSON, one line per request, with a `request_id`. When a user reports "an unexpected error", they can quote the request id shown with the error; search the log for it. Cookies and passwords are never logged.

## Tuning (environment variables)
See `.env.example`. Common ones: `ATTENDANCE_LOCK_HOURS` (default 48), `CHECKIN_ROTATE_SECONDS` (60), `CHECKIN_MAX_PER_DEVICE` (2: a husband checking in his wife is fine, ten people on one phone is not), `SESSION_IDLE_MINUTES` (120).

## Verifying a fresh install
After first deploy, on an **empty** database you can run the end-to-end smoke test (it creates data, so never run it on live data):
`BASE_URL=https://your-domain BOOT_EMAIL=... BOOT_PASSWORD=... npm run smoke`
