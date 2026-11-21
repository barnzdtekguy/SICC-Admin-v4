# SICC Admin v4

Church administration portal for Salem International Christian Centre: members, follow-ups, attendance, leadership training, reports and communication, for the Bishop, administrators, pastors, department leaders and KDF coordinators.

**Stack:** React 18 + Vite · Express · MySQL/MariaDB · no third-party services required.

## Start here
| I want to… | Read |
|---|---|
| Deploy on Hostinger | [HOSTINGER_SETUP.md](HOSTINGER_SETUP.md) |
| Upgrade my existing v3 install | [UPGRADING.md](UPGRADING.md): rotate secrets first |
| Know who can do what | [docs/ROLES.md](docs/ROLES.md) |
| Run backups / handle incidents | [docs/OPERATIONS.md](docs/OPERATIONS.md) |
| Understand the security model | [SECURITY.md](SECURITY.md) |

## Quick start (development)
Use Node.js 24.15.0 or newer on the Node 24 line. Create a local `.env` with `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and `JWT_SECRET`. Set `DB_PORT` if your database uses a port other than 3306. Generate a secret with `node -e "console.log(require('node:crypto').randomBytes(64).toString('hex'))"`. For an empty database, see [first sign-in](HOSTINGER_SETUP.md#5-first-sign-in) for the initial account settings.

```bash
npm ci --include=dev
npm run dev:api               # API :3001, creates/upgrades tables automatically
npm run dev                   # site :3000
```
Tests need a **disposable** database whose name ends in `_test`. Create a local `.env.test` with the test database settings, a separate `JWT_SECRET`, and `NODE_ENV=test`.

```bash
npm test          # API + unit tests (security rules, audit chain, check-in, corrections…)
npm run test:ui   # UI tests (routing, 2FA flow, forced setup, components)
npm run lint
```

## Scripts
| Command | Purpose |
|---|---|
| `npm run build` / `npm start` | Production build / run |
| `npm run backup` | Encrypted database backup → `backups/` |
| `npm run restore-check -- <file> [--into <scratch-db>]` | Prove a backup restores |
| `npm run find-duplicates` | List old duplicate attendance rows blocking a DB unique rule |
| `npm run vapid` | Generate keys for browser push notifications |
| `npm run smoke` | End-to-end check against a running server on an **empty** database |

## Project layout
```
server/
  index.js app.js config.js        start-up, middleware order, validated configuration
  migrate.js schema.sql            versioned migrations (run automatically)
  permissions.js                   single source of truth for roles → permissions
  middleware.js                    CSP, CSRF/Origin guard, rate limits, sessions, errors
  routes/                          auth, profiles, members, attendance, corrections, training (check-in), admin (audit, SMS, reports, brief)
  lib/                             audit (hash chain), sessions, password, totp, crypto, notify, messaging, locks, csv
  scripts/                         backup, restore-check, vapid, find-duplicates
  tests/                           integration + unit tests
src/
  App.jsx                          routing + lazy loading + auth gates
  lib/                             api client, theme tokens, offline queue, PWA helpers
  components/shared/               UI kit, Layout, search palette, notifications, member drawer, toasts
  components/{security,governance} Security centre, approvals, audit trail, analytics
  components/<role>/               per-role dashboards
public/                            service worker, manifest, icons, offline page
```
