'use strict';
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const COST = 12;
const COMMON = ['password', 'passw0rd', 'qwerty', 'letmein', 'welcome', 'admin', 'church', 'salem', 'sicc', 'jesus', 'christ', 'blessed', 'godisgood', 'iloveyou', 'abc123', '123456', '111111', 'lagos', 'nigeria', 'bishop', 'pastor', 'hallelujah', 'amen', 'prayer'];

function hasSequence(pw) {
  const lower = pw.toLowerCase();
  const runs = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  return runs.some(run => {
    for (let i = 0; i + 5 <= run.length; i += 1) {
      const chunk = run.slice(i, i + 5);
      if (lower.includes(chunk) || lower.includes([...chunk].reverse().join(''))) return true;
    }
    return false;
  });
}

// Returns an error message, or null when the password is acceptable.
function validatePassword(password, { email = '', name = '', username = '' } = {}) {
  const pw = String(password || '');
  if (pw.length < 12) return 'Use at least 12 characters.';
  if (pw.length > 128) return 'Use 128 characters or fewer.';
  if (/^(.)\1+$/.test(pw)) return 'Do not repeat a single character.';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(pw)).length;
  if (classes < 3 && pw.length < 16) return 'Mix at least three of: lowercase, UPPERCASE, numbers, symbols (or use 16+ characters).';
  const lower = pw.toLowerCase();
  if (COMMON.some(word => lower.includes(word))) return 'That password contains a very common word. Choose something less guessable.';
  if (hasSequence(pw)) return 'Avoid keyboard or alphabet sequences such as 12345 or qwerty.';
  const tokens = [String(email).split('@')[0], username, ...String(name).split(/\s+/)].map(t => String(t || '').toLowerCase()).filter(t => t.length >= 4);
  if (tokens.some(t => lower.includes(t))) return 'Do not include your name, username or email in the password.';
  return null;
}

const hashPassword = password => bcrypt.hash(String(password), COST);
const verifyPassword = (password, hash) => bcrypt.compare(String(password), hash);
// Compared against when an account does not exist so response time does not reveal it.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-real-password', COST);

function generateTempPassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%*?'];
  const all = sets.join('');
  const chars = sets.map(set => set[crypto.randomInt(set.length)]);
  while (chars.length < 16) chars.push(all[crypto.randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

module.exports = { validatePassword, hashPassword, verifyPassword, generateTempPassword, DUMMY_HASH };
