# Upgrading from v3 to v4

## Before you start (15 minutes)
1. **Rotate every secret that was ever in the zip you shared**: the database password (hPanel → Databases), `JWT_SECRET` (new random value), the SMS provider API token (BulkSMSNigeria dashboard). Changing `JWT_SECRET` signs everyone out, which is what you want.
2. **Back up the database** (phpMyAdmin → Export), and keep that file somewhere safe.
3. Make sure you are not uploading `.env`, `node_modules` or `build`.

## Deploy
1. Replace the project files with v4 (your Hostinger environment variables stay).
2. Set `DATA_ENCRYPTION_KEY`, `APP_ORIGIN`, and `BACKUP_PASSPHRASE` using the [environment settings in the Hostinger guide](HOSTINGER_SETUP.md#3-environment-variables). Re-run the install and build commands, then restart.
3. On start the app upgrades your existing database automatically (nine migrations, safe to re-run) and keeps all your data. Check the app log for completed migrations and startup errors.

## What happens to existing data and users
| Item | Result |
|---|---|
| Members, follow-ups, attendance, programmes | Kept. Departments renamed in the old v3 ways are normalised once. |
| Staff accounts | Kept, but **every account must choose a new password at next sign-in** (the old policy allowed 8 characters). Bishop/Admin will also be asked to set up two-step verification. |
| Old activity log | Kept and still visible, but only entries from the upgrade onwards are hash-protected. |
| SMS API key | Encrypted in place; it is no longer visible in Settings (blank = keep). |
| Duplicate attendance rows | Not deleted. If you have any, run `npm run find-duplicates`, remove the extras, restart; the database then enforces uniqueness. Until then the app enforces it itself. |
| Existing members | Have no recorded consent. New registrations require it; existing members are unaffected. |

## Behaviour changes your users will notice
- Sign-in: *Keep me signed in* is now off by default and lasts 14 days at most. Idle sessions end after 2 hours.
- Attendance: one record per service/date/department. After 48 hours a record is **locked**; changes then need a **correction request** approved by the Bishop/Admin (or a reason, if you are the Bishop/Admin).
- Check-in QR codes: old printed codes **stop working on purpose**. Show the live code on a screen (*Projector mode*) in Leadership Training → QR Attendance. Optional *venue lock* limits check-in to the building.
- Staff accounts are **deactivated, not deleted**, so history stays attributed.
- Admins can no longer create or promote Bishop/Admin accounts. The Bishop does it from *User Accounts*.
- "Register Member" requires the person's consent; duplicates (same name + phone) are flagged.
- Department leaders no longer see a "Register Member" menu (it never worked for them).
- Department / KDF reports are now **saved** and appear in *Analytics & exports → Reports submitted* (before, only a log line was written and the text was discarded).
- SMS is sent by the server. WhatsApp links still open WhatsApp on the sender's phone.

## Rolling back
Restore the database backup from step 2 and redeploy the v3 files. (v4 only adds columns and tables; v3 ignores them. Do not restore over a v4 database that has new data you want to keep.)

# What changed (summary)
**Security:** server-side tamper-evident audit trail · sessions with revocation · lockout · mandatory 2FA for Bishop/Admin · password policy, change & admin reset · centralised permissions · four-eyes corrections and verification · locked attendance · rotating signed check-in QR, device limits, venue geofence · SMS key encrypted & server-side · CSP/CSRF/Origin hardening · consent, view-logging, audited exports, erasure · encrypted backups.
**Product:** URL routing (bookmarks and the back button work) · code-splitting (first page load ≈ 285 KB (≈ 90 KB compressed) vs 756 KB; charts load only when needed) · design tokens, self-hosted fonts, improved contrast · accessible dialogs, tables, forms and keyboard focus · dark theme (beta) · role-based Morning Brief · global search (Ctrl/⌘ K) · member profile with timeline · notifications (in-app, push, SMS, WhatsApp API) · analytics with CSV/print-to-PDF · installable PWA with offline attendance queue.
**Engineering:** API integration, unit and UI tests · CI workflow · lint · structured logs with request ids · versioned migrations · backup/restore tooling.

# Known limits (honest list)
- The existing screens still use inline styles (≈570 places). The shared components, tokens, layout and palette were modernised, so they all inherit the new look, but pages were not individually redesigned. Landing and sign-in pages keep their original artwork.
- **I could not run a real browser in the build environment**, so the layout was verified through automated DOM tests, not screenshots. Look through every role's screens on phone and desktop once, especially **dark mode** (labelled beta).
- SMS (BulkSMSNigeria-style), WhatsApp Cloud API and browser-push code follow the providers' documented formats but were **not tested against live accounts**. Send one test message first.
- No SMS-code or email password reset: password resets are admin-assisted, 2FA is authenticator-app + recovery codes.
- Lists in dashboards still load up to 5,000 rows at once (tables page client-side). Server-side paging exists in the API for members, follow-ups and audit; move the large lists to it if you grow beyond a few thousand members.
- Undo for destructive actions is not implemented; deletes are soft and reversible by the Bishop/Admin through the API, but there is no "Undo" button yet.
