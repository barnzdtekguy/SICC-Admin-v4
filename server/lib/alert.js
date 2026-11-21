'use strict';
// Optional outbound alert (Slack/Discord/Teams-compatible webhook). Throttled so a storm = one message.
const { config } = require('../config');
const last = new Map();

async function alert(kind, message, { throttleMs = 300000 } = {}) {
  console.error(`[ALERT:${kind}] ${message}`);
  if (!config.alertWebhook || config.isTest) return;
  const now = Date.now();
  if (now - (last.get(kind) || 0) < throttleMs) return;
  last.set(kind, now);
  try {
    await fetch(config.alertWebhook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `SICC Admin [${kind}] ${message}`, content: `SICC Admin [${kind}] ${message}` }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) { console.error('Alert webhook failed:', error.message); }
}
module.exports = { alert };
