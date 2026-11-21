// Service worker registration, install prompt and web-push subscription helpers.
import { apiRequest } from './api';

let deferredPrompt = null;
const listeners = new Set();

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(error => console.warn('Service worker failed:', error)));
}

window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredPrompt = event; listeners.forEach(fn => fn(true)); });
window.addEventListener('appinstalled', () => { deferredPrompt = null; listeners.forEach(fn => fn(false)); });

export const canInstall = () => Boolean(deferredPrompt);
export const onInstallAvailable = fn => { listeners.add(fn); fn(Boolean(deferredPrompt)); return () => listeners.delete(fn); };
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null; listeners.forEach(fn => fn(false));
  return outcome === 'accepted';
}

const urlBase64ToUint8Array = base64 => {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
};

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function enablePush() {
  if (!pushSupported()) throw new Error('This browser does not support push notifications.');
  const { publicKey } = await apiRequest('/push/public-key');
  if (!publicKey) throw new Error('Push notifications are not configured on the server yet.');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications were blocked. Allow them in your browser settings.');
  const registration = await navigator.serviceWorker.ready;
  const subscription = (await registration.pushManager.getSubscription()) || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  await apiRequest('/push/subscribe', { method: 'POST', body: subscription.toJSON() });
  return true;
}

export async function disablePush() {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) { await apiRequest('/push/unsubscribe', { method: 'POST', body: { endpoint: subscription.endpoint } }); await subscription.unsubscribe(); }
}

export async function pushEnabled() {
  if (!pushSupported()) return false;
  const registration = await navigator.serviceWorker.ready;
  return Boolean(await registration.pushManager.getSubscription());
}
