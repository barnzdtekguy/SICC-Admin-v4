'use strict';
// Provider calls are made server-side only, so API keys never reach a browser.
const { config } = require('../config');

function toIntlNumber(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('234') && d.length === 13) return d;
  if (d.length === 11 && d.startsWith('0')) return `234${d.slice(1)}`;
  if (d.length === 10) return `234${d}`;
  return null;
}

// BulkSMSNigeria-compatible endpoint (override with SMS_API_URL). Sent in chunks of 100.
async function sendSms({ apiKey, senderId, numbers, message }) {
  const details = [];
  for (let i = 0; i < numbers.length; i += 100) {
    const chunk = numbers.slice(i, i + 100);
    try {
      const response = await fetch(config.sms.url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ api_token: apiKey, from: senderId, to: chunk.join(','), body: message, dnd: 2 }),
        signal: AbortSignal.timeout(20000),
      });
      const text = await response.text();
      let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
      const failed = !response.ok || json?.error || (json?.status && !/^(ok|success)$/i.test(String(json.status)));
      if (failed) return { ok: false, detail: String(json?.error?.message || json?.message || text).slice(0, 300) };
      details.push(json?.message || 'ok');
    } catch (error) { return { ok: false, detail: error.message }; }
  }
  return { ok: true, detail: details.join(' | ') };
}

async function sendWhatsAppTemplate({ to, template, language = 'en', params = [] }) {
  try {
    const response = await fetch(`https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneId}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${config.whatsapp.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template: { name: template, language: { code: language }, components: params.length ? [{ type: 'body', parameters: params.map(text => ({ type: 'text', text: String(text) })) }] : [] } }),
      signal: AbortSignal.timeout(15000),
    });
    return { ok: response.ok, detail: response.ok ? 'ok' : (await response.text()).slice(0, 300) };
  } catch (error) { return { ok: false, detail: error.message }; }
}

module.exports = { toIntlNumber, sendSms, sendWhatsAppTemplate };
