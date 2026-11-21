# Roles and permissions

Generated from `server/permissions.js`, the single source of truth. Every API route checks a permission, not a role list. Hiding a button is never the only protection.

| Permission | What it allows | Bishop | Admin | Pastor | Dept leader | KDF coord. |
|---|---|:-:|:-:|:-:|:-:|:-:|
| `profiles.read` | See the full staff list | ✔ | ✔ |  |  |  |
| `profiles.manage` | Create / edit / deactivate staff, reset passwords & 2FA (Admin cannot touch Bishop/Admin accounts) | ✔ | ✔ |  |  |  |
| `audit.read` | View the audit trail and verify its integrity | ✔ | ✔ |  |  |  |
| `members.read.all` | See every member (others see only their own slice) | ✔ | ✔ |  |  |  |
| `members.write` | Register and edit members | ✔ | ✔ | ✔ |  |  |
| `members.delete` | Soft-delete / restore members (reason required) | ✔ | ✔ |  |  |  |
| `members.anonymize` | Permanently erase a person's details (privacy request) | ✔ |  |  |  |  |
| `followups.read` | See follow-ups (own / own area; management sees all) | ✔ | ✔ | ✔ |  | ✔ |
| `followups.write` | Log and update follow-ups | ✔ | ✔ | ✔ |  | ✔ |
| `attendance.read` | See attendance records (department leaders: own department) | ✔ | ✔ |  | ✔ |  |
| `attendance.write` | Record / edit attendance | ✔ | ✔ |  | ✔ |  |
| `attendance.verify` | Verify attendance recorded by someone else | ✔ | ✔ |  |  |  |
| `corrections.request` | Ask for a locked record to be corrected | ✔ | ✔ | ✔ | ✔ |  |
| `corrections.decide` | Approve / reject corrections (never your own) | ✔ | ✔ |  |  |  |
| `programmes.manage` | Create programmes, set venue lock | ✔ | ✔ | ✔ |  |  |
| `checkin.control` | Show the rotating check-in QR | ✔ | ✔ | ✔ |  |  |
| `training.mark` | Record and view programme attendance | ✔ | ✔ | ✔ |  |  |
| `messages.send` | Send SMS / WhatsApp to members | ✔ | ✔ |  |  |  |
| `sms.config` | Change SMS provider settings | ✔ | ✔ |  |  |  |
| `assignments.manage` | Create / manage assignments | ✔ | ✔ |  |  |  |
| `exports.run` | Export CSV (members, attendance, audit) | ✔ | ✔ |  |  |  |
| `reports.org` | Church-wide analytics and submitted reports | ✔ | ✔ |  |  |  |

## Rules that are not just a permission

- **Only the Bishop can create, change or deactivate Bishop and Admin accounts.** An Admin can manage pastors, department leaders and KDF coordinators.
- Nobody can change their own role or deactivate themselves, and at least one active Bishop/Admin must always remain.
- **Two-step verification is mandatory for Bishop and Admin** (set with `MFA_REQUIRED_ROLES`).
- **Four-eyes rule:** you can never approve your own correction, and you cannot verify attendance you recorded.
- **Scoped visibility:** pastors see members they registered; department leaders see their department; KDF coordinators see their area. Department leaders and KDF coordinators do not see pastoral notes.
- Deleting is always a *deactivation* (accounts) or *soft delete* (members) so history stays attributable.
