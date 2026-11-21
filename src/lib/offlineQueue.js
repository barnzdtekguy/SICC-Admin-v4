// Tiny IndexedDB outbox so attendance entered with no signal is not lost.
// Replays are safe: the server rejects duplicates (409), which we treat as "already saved".
const DB = 'sicc-outbox';
const STORE = 'items';
const listeners = new Set();

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

const notify = async () => { const n = await pendingCount(); listeners.forEach(fn => fn(n)); };

export async function pendingCount() {
  try { return await tx('readonly', s => s.count()); } catch { return 0; }
}

export function onQueueChange(fn) { listeners.add(fn); pendingCount().then(fn); return () => listeners.delete(fn); }

export async function enqueueIfOffline(item) {
  if (navigator.onLine) return false; // a real server error is not an offline case
  try { await tx('readwrite', s => s.add({ ...item, queuedAt: new Date().toISOString() })); await notify(); return true; } catch { return false; }
}

let flushing = false;
export async function flushQueue() {
  if (flushing || !navigator.onLine) return { sent: 0, failed: 0 };
  flushing = true;
  let sent = 0; let failed = 0;
  try {
    const items = await tx('readonly', s => s.getAll());
    for (const item of items) {
      try {
        const response = await fetch(`/api${item.path}`, { method: item.method, credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-SICC-Client': 'web' }, body: JSON.stringify(item.body) });
        if (response.ok || [400, 409, 423].includes(response.status)) { await tx('readwrite', s => s.delete(item.id)); sent += response.ok ? 1 : 0; failed += response.ok ? 0 : 1; }
        else if (response.status === 401) break; // signed out: keep the items, try after sign-in
      } catch { break; }
    }
  } catch { /* storage unavailable (e.g. private browsing): nothing to send */ } finally { flushing = false; await notify(); }
  return { sent, failed };
}
