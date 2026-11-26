import { apiRequest } from './api';

const DB_NAME = 'sicc-quick-login';
const STORE = 'keys';
const ENTRY = 'browser';
const algorithm = { name: 'ECDSA', namedCurve: 'P-256' };

export const canTrustBrowser = () => Boolean(globalThis.indexedDB && globalThis.crypto?.subtle);

function openDatabase() {
  if (!canTrustBrowser()) throw new Error('Quick Login needs a secure browser with device storage enabled.');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other SICC Admin tabs and try again.'));
  });
}

async function keyStore(mode, operation) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || request.error);
    });
  } finally { database.close(); }
}

const loadKey = () => keyStore('readonly', store => store.get(ENTRY));
export const forgetBrowserKey = () => keyStore('readwrite', store => store.delete(ENTRY));
const encode = value => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function enrollKey() {
  const existing = await loadKey();
  if (existing) return existing;
  const pair = await crypto.subtle.generateKey(algorithm, false, ['sign', 'verify']);
  const record = { privateKey: pair.privateKey, publicKey: encode(await crypto.subtle.exportKey('spki', pair.publicKey)) };
  try { await keyStore('readwrite', store => store.add(record, ENTRY)); }
  catch (error) {
    if (error?.name === 'ConstraintError') return loadKey();
    throw error;
  }
  return record;
}

export async function trustBrowser() {
  const { publicKey } = await enrollKey();
  return apiRequest('/auth/quick-login/devices', { method: 'POST', body: { publicKey } });
}

export async function detectQuickLogin() {
  try {
    if (!(await loadKey())?.privateKey) return false;
    const result = await apiRequest('/auth/quick-login/status');
    return result.available === true;
  } catch { return false; }
}

async function proveDevice(purpose, challenge) {
  const record = await loadKey();
  if (!record?.privateKey) throw new Error('Quick Login is unavailable. Sign in with your password to continue.');
  const data = new TextEncoder().encode(`sicc-admin:quick-login:v1:${purpose}:${challenge}`);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, record.privateKey, data);
  return encode(signature);
}

export async function unlockWithPin(pin) {
  const { challenge } = await apiRequest('/auth/quick-login/challenge', { method: 'POST' });
  const proof = await proveDevice('pin', challenge);
  return apiRequest('/auth/quick-login/unlock', { method: 'POST', body: { pin, challenge, proof } });
}

export async function verifyQuickMfa(challenge, code) {
  const proof = await proveDevice('mfa', challenge);
  return apiRequest('/auth/quick-login/mfa', { method: 'POST', body: { challenge, code, proof } });
}
