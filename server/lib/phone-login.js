'use strict';

function normalizePhoneLogin(value) {
  const phone = String(value ?? '').trim();
  if (!/^\+?[\d ().-]+$/.test(phone)) return null;
  let digits = phone.replace(/\D/g, '');
  if (!phone.startsWith('+')) {
    if (digits.startsWith('00')) digits = digits.slice(2);
    else if (/^0\d{10}$/.test(digits)) digits = `234${digits.slice(1)}`;
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

module.exports = { normalizePhoneLogin };
