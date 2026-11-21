// End-to-end smoke test against a running server with a fresh, disposable database.
//   BASE_URL=http://localhost:3001 BOOT_EMAIL=... BOOT_PASSWORD=... npm run test:smoke
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const totp = require('../../server/lib/totp.js');
const ROOT = process.env.BASE_URL || 'http://localhost:3001';
const EMAIL = process.env.BOOT_EMAIL || 'bishop@sicc.test';
const BOOT = process.env.BOOT_PASSWORD || 'Marble!Orchard-5512';
const BASE = `${ROOT}/api`;
let cookie = '';
const call = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', 'X-SICC-Client': 'web', Cookie: cookie, Origin: ROOT }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  let j = {}; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, body: j, data: j.data };
};
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  -> ' + extra}`); if (!cond) process.exitCode = 1; };

let r = await call('post', '/auth/login', { identifier: EMAIL, password: BOOT });
ok('bootstrap Bishop can sign in', r.status === 200 && r.data.restrictions.includes('password_change') && r.data.restrictions.includes('mfa_setup'), JSON.stringify(r.body));
r = await call('get', '/members'); ok('data is blocked until password changed', r.status === 403 && r.body.code === 'password_change');
r = await call('post', '/auth/password', { current_password: BOOT, new_password: 'Velvet!Harbour-4420' });
ok('password changed; mfa still required', r.status === 200 && r.data.restrictions.join() === 'mfa_setup', JSON.stringify(r.body));
r = await call('post', '/auth/mfa/setup', {}); const secret = r.data.secret; ok('mfa setup returns secret + otpauth url', !!secret && r.data.otpauth_url.startsWith('otpauth://totp/'));
r = await call('post', '/auth/mfa/enable', { code: totp.hotp(secret, totp.stepFor()) }); ok('mfa enabled with 8 recovery codes', r.status === 200 && r.data.recovery_codes.length === 8, JSON.stringify(r.body));
const recovery = r.data.recovery_codes;
r = await call('get', '/members'); ok('API open after setup', r.status === 200);
await call('post', '/auth/logout', {}); cookie = '';
r = await call('post', '/auth/login', { identifier: EMAIL, password: 'Velvet!Harbour-4420' }); ok('login now asks for a code', r.data?.mfa_required === true);
let challenge = r.data.challenge;
r = await call('post', '/auth/mfa/verify', { challenge, code: totp.hotp(secret, totp.stepFor()) }); ok('same-window TOTP code is rejected (replay protection)', r.status === 401);
r = await call('post', '/auth/mfa/verify', { challenge, code: totp.hotp(secret, totp.stepFor() + 1) }); ok('next-window TOTP code signs in', r.status === 200 && r.data.restrictions.length === 0, JSON.stringify(r.body));
await call('post', '/auth/logout', {}); cookie = '';
r = await call('post', '/auth/login', { identifier: EMAIL, password: 'Velvet!Harbour-4420' });
r = await call('post', '/auth/mfa/verify', { challenge: r.data.challenge, code: recovery[0] }); ok('recovery code signs in', r.status === 200);
r = await call('post', '/auth/login', { identifier: EMAIL, password: 'Velvet!Harbour-4420' });
r = await call('post', '/auth/mfa/verify', { challenge: r.data.challenge, code: recovery[0] }); ok('recovery code cannot be reused', r.status === 401);
r = await call('post', '/auth/login', { identifier: EMAIL, password: 'Velvet!Harbour-4420' });
r = await call('post', '/auth/mfa/verify', { challenge: r.data.challenge, code: recovery[1] }); ok('second recovery code works', r.status === 200);

// Admin lifecycle by the Bishop
r = await call('post', '/profiles', { name: 'Pastor Ada Obi', email: 'ada@sicc.test', role: 'pastor', password: 'Cobalt!Meadow-9981' }); ok('Bishop creates a pastor (temp password)', r.status === 201);
const pastorId = r.data.id;
r = await call('post', '/members', { first_name: 'Test', last_name: 'Member', phone: '08031234567', consent_given: true, kdf_area: 'General Area' }); ok('member registered with consent', r.status === 201, JSON.stringify(r.body));
r = await call('put', '/sms-config', { api_key: 'TESTKEY-1234567', sender_id: 'SICC' }); ok('SMS key stored; only hint returned', r.status === 200 && r.data.api_key_hint === '••••4567' && !JSON.stringify(r.body).includes('TESTKEY'));
r = await call('post', '/messages/sms', { audience: { kind: 'all' }, message: 'Hello from the test' }); ok('SMS send fails cleanly when provider is unreachable (502, not crash)', [502].includes(r.status), `${r.status} ${JSON.stringify(r.body)}`);
r = await call('get', '/audit/verify'); ok('audit chain verifies', r.data.ok === true && r.data.checked >= 8, JSON.stringify(r.data));
r = await call('get', '/audit?page=1&pageSize=5'); ok('audit list paginates', r.data.items.length > 0 && r.data.total > 5);
r = await call('get', '/brief'); ok('bishop morning brief loads', r.status === 200 && 'pendingApprovals' in r.data, JSON.stringify(r.body));
r = await call('get', '/reports/overview'); ok('analytics overview loads', r.status === 200 && Array.isArray(r.data.weekly));
r = await call('get', '/search?q=Test'); ok('search finds the member', r.data.members.length === 1);
r = await call('post', `/profiles/${pastorId}/reset-password`, {}); ok('password reset returns one-time temp password', r.status === 200 && r.data.temporary_password.length >= 14);
const exp = await fetch(BASE + '/exports/members.csv', { headers: { Cookie: cookie, 'X-SICC-Client': 'web' } }); const csv = await exp.text(); ok('members CSV export works', exp.status === 200 && csv.includes('Member'));
const spa = await fetch(`${ROOT}/app/overview`); ok('SPA deep link served', spa.status === 200 && (await spa.text()).includes('id="root"'));
const sw = await fetch(`${ROOT}/sw.js`); ok('service worker served with no-cache', sw.status === 200 && sw.headers.get('cache-control') === 'no-cache');
const man = await fetch(`${ROOT}/manifest.json`); ok('manifest served', man.status === 200 && (await man.json()).icons.length === 3);
const nf = await fetch(BASE + '/nope'); ok('unknown API route is JSON 404', nf.status === 404 && (await nf.json()).error);
