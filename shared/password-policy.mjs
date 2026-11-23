export const MIN_PASSWORD_LENGTH = 8;

export const PASSWORD_RULES = [
  { label: `At least ${MIN_PASSWORD_LENGTH} characters`, test: value => Array.from(value).length >= MIN_PASSWORD_LENGTH },
  { label: 'At least one uppercase letter', test: value => /\p{Lu}/u.test(value) },
  { label: 'At least one number', test: value => /\p{Nd}/u.test(value) },
  { label: 'At least one special character', test: value => /[\p{P}\p{S}]/u.test(value) },
];

export const PASSWORD_HINT = `Use at least ${MIN_PASSWORD_LENGTH} characters, including an uppercase letter, a number, and a special character such as !, @, or #.`;

export function validatePassword(value) {
  return typeof value === 'string' && PASSWORD_RULES.every(rule => rule.test(value)) ? null : PASSWORD_HINT;
}
