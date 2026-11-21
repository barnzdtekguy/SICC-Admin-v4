# Hostinger setup (v4)

SICC Admin is one Node.js application (API + website) with a MySQL/MariaDB database. It needs a Hostinger plan with Node.js apps (Business or Cloud).

## 1. Create the database
1. hPanel → **Databases → MySQL**: create a database and a user. Note the full names Hostinger shows (they carry a prefix).
2. **You do not import any SQL.** On first start the app creates and upgrades its own tables (versioned migrations). The database user needs normal create/alter rights, which Hostinger gives by default.

## 2. Create the Node.js app
hPanel → **Websites → Add website → Node.js Apps** → upload the deployment ZIP or connect GitHub. The ZIP has `package.json` at its root. Choose Express or a custom Node.js app with `server/index.js` as the entry file. Do **not** upload `node_modules`, `build`, `backups` or any `.env` file.

| Setting | Value |
|---|---|
| Install command | `npm ci --include=dev` |
| Build command | `npm run build` |
| Start command | `node server/index.js` |
| Node version | Node.js 24 (24.15.0 or newer) |

## 3. Environment variables
Set these values in the app's **Environment variables** screen. Set `APP_ORIGIN` to the exact HTTPS address users will open, including a separate entry for each supported hostname when applicable. Let Hostinger assign the port.

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | from step 1 |
| `JWT_SECRET` | 64+ random characters (`node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`) |
| `DATA_ENCRYPTION_KEY` | a **different** 64+ random value. Back it up; it protects the SMS key and 2FA secrets |
| `APP_ORIGIN` | `https://your-domain` |
| `TRUST_PROXY` | `1` |
| `INITIAL_ADMIN_NAME`, `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD` | only for the very first start on an empty database. Password: 12+ characters |
| `BACKUP_PASSPHRASE` | long passphrase for encrypted backups |
| `ALERT_WEBHOOK_URL` | optional Slack/Discord/Teams webhook |

The start-up check refuses to run with a weak or placeholder `JWT_SECRET`, and tells you what is wrong in the app log.

## 4. Turn on HTTPS only
hPanel → **Security → SSL** → install and **Force HTTPS**. In production the session cookie is `Secure`, so it will not work on plain http.

## 5. First sign-in

For an existing v4 deployment, retain the current data encryption key and database settings. If `DATA_ENCRYPTION_KEY` was never configured, keep the existing `JWT_SECRET` until you have a plan to migrate the values encrypted with it. For a v3 upgrade, see `UPGRADING.md` and rehearse migrations on a restored copy of the database before using the live database.

For an empty database:
1. Open your site → *Log in* with the initial email and password.
2. You will be asked to choose a new password, then to set up two-step verification (scan the QR code with Google/Microsoft Authenticator; **save the recovery codes**).
3. Delete `INITIAL_ADMIN_PASSWORD` from the environment variables and restart the app.
4. *User Accounts* → create the real Bishop/Administrator and staff accounts. Each person gets a temporary password and must choose their own at first sign-in.

## 6. Schedule backups and monitoring
See `docs/OPERATIONS.md` for the daily backup command and restore check. After deployment, open `https://YOUR-DOMAIN/api/health` and check that it returns HTTP 200. Sign in on a phone as a test Pastor, register a test member, and confirm a submitted follow-up remains visible after reload. Configure and test any messaging or push integrations you intend to use.

## Local development

Create a local `.env` using the [development setup in the README](README.md#quick-start-development).

```bash
npm ci --include=dev
npm run dev:api          # API on :3001 (creates tables automatically)
npm run dev              # website on :3000 (proxies /api)
npm test && npm run test:ui
```
