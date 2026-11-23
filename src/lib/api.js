import { enqueueIfOffline } from './offlineQueue';

export class ApiError extends Error {
  constructor(message, { status, code, data } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

// Paths that may be saved on the device and replayed when the connection returns.
const QUEUEABLE = [/^\/attendance$/, /^\/programme-attendance-records$/];

export async function apiRequest(path, options = {}) {
  const { method = 'GET', body, queueable = false, queueOwner, signal } = options;
  const headers = { 'X-SICC-Client': 'web' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (queueOwner && path === '/red/souls' && method === 'POST') headers['X-SICC-Queue-Owner'] = queueOwner;

  let response;
  try {
    response = await fetch(`/api${path}`, { method, credentials: 'include', headers, signal, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    const redEntry = queueOwner && path === '/red/souls';
    if (queueable && method === 'POST' && (redEntry || QUEUEABLE.some(re => re.test(path)))) {
      const queued = await enqueueIfOffline({ path, method, body, ...(redEntry ? { ownerId: queueOwner } : {}) });
      if (queued) return { queued: true, offline: true, ...body };
    }
    throw new ApiError('You appear to be offline. Check your connection and try again.', { code: 'network' });
  }

  let payload;
  try { payload = await response.json(); } catch {
    throw new ApiError(`The server returned an invalid response (${response.status}).`, { status: response.status });
  }

  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login' && path !== '/auth/mfa/verify' && path !== '/auth/me') {
      window.dispatchEvent(new CustomEvent('sicc:unauthorized', { detail: payload.error }));
    }
    throw new ApiError(payload.error || `Request failed (${response.status}).`, { status: response.status, code: payload.code, data: payload });
  }
  return payload.data;
}

export async function mutationResult(path, options = {}) {
  try {
    return { data: await apiRequest(path, options), error: null };
  } catch (error) {
    return { data: null, error };
  }
}

// Download a CSV/other file through the authenticated session.
export async function downloadFile(path, fallbackName = 'export.csv') {
  const response = await fetch(`/api${path}`, { credentials: 'include', headers: { 'X-SICC-Client': 'web' } });
  if (!response.ok) {
    let message = `Download failed (${response.status}).`;
    try { message = (await response.json()).error || message; } catch { /* not json */ }
    throw new ApiError(message, { status: response.status });
  }
  const blob = await response.blob();
  const match = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') || '');
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: match?.[1] || fallbackName });
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
