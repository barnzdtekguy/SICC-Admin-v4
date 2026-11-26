import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { promisify } from 'node:util';

const browser = process.argv[2];
if (!browser) throw new Error('Pass the path to a Chromium browser executable.');
const run = promisify(execFile);
const build = new URL('../../build/', import.meta.url);
const index = await readFile(new URL('index.html', build), 'utf8');
const widths = [320, 390, 1280];
const screens = ['setup', 'unlock'];
const themes = ['light', 'dark'];
const checks = widths.flatMap(width => screens.map(screen => `${screen}-${width}`));
const profile = { id: 'layout-test', name: 'Layout Test', role: 'pastor', is_active: true };
const session = { user: { id: profile.id }, profile, restrictions: ['pin_setup'], quick_login: { recent_full_auth: true } };

const collect = `
  const pending = new Set(${JSON.stringify(checks)});
  const output = document.getElementById('result');
  addEventListener('message', ({ origin, data }) => {
    if (origin !== location.origin || !pending.delete(data?.check)) return;
    if (data.error) output.textContent += data.check + ': ' + data.error + '\\n';
    if (!pending.size) output.dataset.pinLayout = output.textContent ? 'fail' : 'pass';
  });
`;

const frameCheck = `
  const params = new URLSearchParams(location.search);
  const screen = params.get('screen');
  const width = Number(params.get('width'));
  const theme = params.get('theme');
  localStorage.setItem('sicc-theme', theme);
  const keyReady = screen === 'unlock' ? (async () => {
    const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('sicc-quick-login', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('keys');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const transaction = open.result.transaction('keys', 'readwrite');
        transaction.objectStore('keys').put({ privateKey: key.privateKey }, 'browser');
        transaction.oncomplete = () => { open.result.close(); resolve(); };
        transaction.onabort = () => reject(transaction.error);
      };
    });
  })() : Promise.resolve();
  const nativeFetch = window.fetch;
  window.fetch = async (url, options) => {
    if (url === '/api/auth/me') {
      await keyReady;
      return nativeFetch(url + '?screen=' + screen, options);
    }
    return nativeFetch(url, options);
  };
  addEventListener('load', () => {
    const timer = setInterval(async () => {
      const card = document.querySelector('.quick-login-card');
      if (!card) return;
      clearInterval(timer);
      await document.fonts.ready;
      const rect = card.getBoundingClientRect();
      const targets = [...card.querySelectorAll('button, a[href]')];
      const keypad = card.querySelectorAll('.quick-pin-keypad button');
      const input = card.querySelectorAll('input[type=password]');
      let error;
      if (innerWidth !== width || rect.left < 0 || rect.right > width || document.documentElement.scrollWidth > width) error = 'Horizontal overflow';
      else if (targets.some(element => element.getBoundingClientRect().height < 44)) error = 'Touch target under 44px';
      else if (screen === 'unlock' ? keypad.length !== 11 : input.length !== 2) error = 'Expected input controls are missing';
      else if (document.documentElement.dataset.theme !== theme) error = 'Expected theme is missing';
      parent.postMessage({ check: screen + '-' + width, error }, location.origin);
    }, 80);
  });
`;

const mime = { '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (body, type = 'text/html', status = 200) => res.writeHead(status, { 'content-type': type }).end(body);
  if (url.pathname === '/') {
    const theme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light';
    const frames = widths.flatMap(width => screens.map(screen => `<iframe title="${screen} ${width}" width="${width}" height="760" style="border:0" src="${screen === 'setup' ? '/app/overview' : '/login'}?screen=${screen}&amp;width=${width}&amp;theme=${theme}"></iframe>`));
    return send(`<!doctype html><pre id="result"></pre><script src="/collect.js"></script>${frames.join('')}`);
  }
  if (url.pathname === '/collect.js') return send(collect, 'text/javascript');
  if (url.pathname === '/frame.js') return send(frameCheck, 'text/javascript');
  if (url.pathname === '/api/auth/me') {
    const setup = url.searchParams.get('screen') === 'setup';
    return send(JSON.stringify(setup ? { data: session } : { error: 'Please sign in to continue.' }), 'application/json', setup ? 200 : 401);
  }
  if (url.pathname === '/api/auth/quick-login/status') return send('{"data":{"available":true}}', 'application/json');
  if (['/app/overview', '/login'].includes(url.pathname)) return send(index.replace('<head>', '<head><script src="/frame.js"></script>'));
  if (/^\/(?:assets\/[\w.-]+|salem-logo\.png|favicon\.(?:svg|png))$/.test(url.pathname)) {
    try { return send(await readFile(new URL(url.pathname.slice(1), build)), mime[extname(url.pathname)] || 'application/octet-stream'); }
    catch { return send('', 'text/plain', 404); }
  }
  return send('', 'text/plain', 404);
});

const temp = await realpath(tmpdir());
const browserProfile = await mkdtemp(join(temp, 'sicc-pin-layout-'));
try {
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  for (const theme of themes) {
    const { stdout } = await run(browser, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking',
      `--user-data-dir=${browserProfile}`, '--dump-dom', '--virtual-time-budget=10000',
      `http://127.0.0.1:${server.address().port}/?theme=${theme}`,
    ], { timeout: 45000, windowsHide: true });
    const result = /<pre id="result"[^>]*>[^<]*<\/pre>/.exec(stdout)?.[0];
    assert.match(result || '', /data-pin-layout="pass"/, result || 'The browser did not finish checking the PIN screens.');
    console.log(`PIN setup and unlock fit ${widths.join(', ')} px in ${theme} mode. Buttons and links are at least 44 px tall.`);
  }
} finally {
  server.close();
  const resolved = await realpath(browserProfile);
  if (dirname(resolved) === temp && basename(resolved) === basename(browserProfile)) {
    await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}
