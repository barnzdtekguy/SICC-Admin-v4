// Tiny IndexedDB outbox so attendance entered with no signal is not lost.
// Replays are safe: the server rejects duplicates (409), which we treat as "already saved".
const DB = 'sicc-outbox';
const STORE = 'items';
const listeners = new Map();
const isRetired = item => item.retired || item.path === '/greatness/attendance';
const matchesOwner = (item, ownerId) => ownerId ? item.ownerId === ownerId : !item.ownerId;

const open = () => new Promise((resolve, reject) => {
  if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
  const req = indexedDB.open(DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const tx = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(result?.result ?? result); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
};

const queuedItems = () => tx('readonly', s => s.getAll()).catch(() => []);
const scopedItems = (items, ownerId) => items.filter(item => !isRetired(item) && matchesOwner(item, ownerId));
const notify = async () => {
  const items = await queuedItems();
  listeners.forEach((ownerId, listener) => {
    const scoped = scopedItems(items, ownerId);
    listener(ownerId ? scoped : scoped.length);
  });
};

export async function pendingCount() {
  return scopedItems(await queuedItems()).length;
}

export function onQueueChange(fn) { return subscribe(fn, null); }
export function onRedQueueChange(ownerId, fn) { return subscribe(fn, ownerId); }

function subscribe(fn, ownerId) {
  listeners.set(fn, ownerId);
  queuedItems().then(items => {
    if (!listeners.has(fn)) return;
    const scoped = scopedItems(items, ownerId);
    fn(ownerId ? scoped : scoped.length);
  });
  return () => listeners.delete(fn);
}

export async function enqueueIfOffline(item) {
  if (navigator.onLine) return false; // a real server error is not an offline case
  try { await tx('readwrite', s => s.add({ ...item, queuedAt: new Date().toISOString() })); await notify(); return true; } catch { return false; }
}

export async function removeRedQueueItem(ownerId, id) {
  const item = (await queuedItems()).find(entry => entry.id === id && entry.ownerId === ownerId);
  if (!item) return;
  await tx('readwrite', s => s.delete(item.id));
  await notify();
}

const flushing = new Set();
export async function flushQueue(ownerId = null) {
  if (flushing.has(ownerId) || !navigator.onLine) return { sent: 0, failed: 0 };
  flushing.add(ownerId);
  let sent = 0; let failed = 0;
  try {
    const items = scopedItems(await queuedItems(), ownerId);
    for (const item of items) {
      if (item.failure) continue;
      try {
        const headers = { 'Content-Type': 'application/json', 'X-SICC-Client': 'web' };
        if (ownerId) headers['X-SICC-Queue-Owner'] = ownerId;
        const response = await fetch(`/api${item.path}`, { method: item.method, credentials: 'include', headers, body: JSON.stringify(item.body) });
        if (ownerId) {
          if (response.ok) { await tx('readwrite', s => s.delete(item.id)); sent++; }
          else if ([400, 409].includes(response.status)) {
            const result = await response.json();
            await tx('readwrite', s => s.put({ ...item, failure: result.error || 'Review this entry before trying again.' }));
            failed++;
          } else break;
        } else if (response.ok || [400, 409, 423].includes(response.status)) { await tx('readwrite', s => s.delete(item.id)); sent += response.ok ? 1 : 0; failed += response.ok ? 0 : 1; }
        else if (response.status === 410) { await tx('readwrite', s => s.put({ ...item, retired: true })); failed += 1; }
        else if (response.status === 401) break; // signed out: keep the items, try after sign-in
      } catch { break; }
    }
  } catch { /* storage unavailable (e.g. private browsing): nothing to send */ }
  finally { flushing.delete(ownerId); await notify(); }
  if (ownerId && sent) window.dispatchEvent(new CustomEvent('sicc:red-queue-sent', { detail: ownerId }));
  return { sent, failed };
}
