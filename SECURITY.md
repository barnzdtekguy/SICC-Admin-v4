# Security overview

## What this protects against
| Threat | Protection |
|---|---|
| Guessing / stealing passwords | New passwords for every role require at least 8 characters, one uppercase letter, one number, and one special character. New passwords use salted PBKDF2-HMAC-SHA256. Existing bcrypt passwords continue to work. Five failed attempts trigger a 15-minute lock, with longer locks after repeated failures. Wrong passwords and unknown accounts receive the same error. Bishop and Admin require two-step verification. Recovery codes and required changes of temporary passwords are supported. |
| Stolen cookie / device | Sessions live in the database and are revoked on logout, password change, deactivation or 2FA reset; idle timeout; "Sign out all other devices"; HttpOnly + SameSite=Strict (+ `__Host-` prefix and Secure in production) |
| Someone inside "cheating" | Every sign-in, change, approval, export and view of a member record is written **by the server** to a hash-chained audit trail; rows can't be edited (database trigger) and any edit/removal is detected by *Verify integrity*; four-eyes approval for corrections; locked records; verification by a second person; actor identity always comes from the session, never from the request |
| Fake / proxy attendance | Rotating signed QR code (expires in ~2 min), per-phone limit, optional venue geofence, brute-force lockout per phone number, one check-in per person per day enforced by the database |
| Privilege escalation | Central permission map; only the Bishop manages privileged accounts; no self-promotion; last Bishop/Admin protected |
| Cross-site attacks | Custom-header + Origin check on every state-changing request, SameSite=Strict, strict Content-Security-Policy (no third-party scripts, fonts or QR services), frame denial, no-referrer |
| Injection | All SQL is parameterised; input validated against allowed lists; CSV exports neutralise spreadsheet formulas; React escapes output |
| Secret exposure | SMS key and 2FA secrets are AES-256-GCM encrypted at rest and never sent to a browser; `.env` is git-ignored; start-up refuses weak/placeholder secrets; logs redact cookies |
| Data privacy | Consent recorded at registration, pastoral notes hidden from non-pastoral roles, member-view logging, exports limited to management and audited, right-to-erasure ("anonymise") for the Bishop |
| Data loss | Encrypted logical backups, restore verification tool, soft deletes, revision history of every corrected record |

## What it does **not** protect against (be aware)
- **Someone with direct database or hosting access** can read or change data. The audit chain will reveal edits to the *audit log*, but not everything else. Protect your Hostinger and phpMyAdmin logins with 2FA and a long password.
- **A compromised Bishop/Admin phone *and* password** is full access. Recovery codes must be stored safely and offline.
- **Shared phones and screenshots.** Anyone who can see a screen can read it.
- **Geofencing is a deterrent, not proof:** browsers allow location spoofing on rooted/modified devices.
- The SMS and WhatsApp integrations and browser push were written to the providers' documented APIs but **have not been tested against live accounts** in this build. Test with one recipient first.

## Reporting a problem
Contact the developer privately. Do not post vulnerabilities publicly.

## Your responsibilities checklist (10 minutes)
- [ ] Rotated every secret that was ever shared (see UPGRADING.md step 1)
- [ ] `JWT_SECRET` and `DATA_ENCRYPTION_KEY` are different random 64-byte values
- [ ] Site is served over HTTPS only (Hostinger → SSL → Force HTTPS)
- [ ] Hostinger and phpMyAdmin accounts have 2FA
- [ ] Bishop and each Admin have set up two-step verification and saved recovery codes
- [ ] Daily encrypted backup is scheduled **and** a restore test was done
- [ ] Uptime monitor on `/api/health`
- [ ] `INITIAL_ADMIN_PASSWORD` removed from the environment
