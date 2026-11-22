// Theme tokens. `C` is intentionally a mutable object: existing components read C.* while rendering,
// so switching palettes and re-mounting the tree restyles every screen without touching each one.
const base = {
  qrDark: '#0C1B3A', qrLight: '#FFFFFF',
  gold: '#C9A84C', goldLight: '#E8C96A', goldDark: '#A07828', goldText: '#8A6A1F',
  warning: '#B34700', warningBg: '#FFF3E0',
  success: '#2E7D32', successBg: '#EAF3DE',
  danger: '#C62828', dangerBg: '#FFEBEE',
  info: '#185FA5', infoBg: '#E6F1FB',
  purple: '#6A1B9A', purpleBg: '#F3E5F5',
  blueLight: '#E6F1FB',
};

export const PALETTES = {
  light: {
    ...base,
    navy: '#0C1B3A', navyLight: '#162847', blue: '#042241',
    pageBg: '#F3F4F6', cardBg: '#FFFFFF', sidebarBg: '#0C1B3A', headerBg: '#FFFFFF', inputBg: '#F8F9FA',
    textPrimary: '#0D1B2A', textSecondary: '#475F6D', textMuted: '#566B7A',
    border: '#E0E4E8', borderStrong: '#B0BEC5', hover: '#F3F4F6',
  },
  dark: {
    ...base,
    gold: '#D4B45A', goldText: '#D4B45A',
    success: '#66BB6A', successBg: '#16301A', danger: '#EF7B7B', dangerBg: '#3A1A1D',
    warning: '#FFA040', warningBg: '#3A2A12', info: '#6CB0F0', infoBg: '#14293F', purple: '#C58AE0', purpleBg: '#2C1B38', blueLight: '#14293F',
    navy: '#4F76B8', navyLight: '#1B2D4D', blue: '#4F76B8',
    pageBg: '#0B1220', cardBg: '#131D2F', sidebarBg: '#070E1C', headerBg: '#101A2B', inputBg: '#0F1828',
    textPrimary: '#E8EDF4', textSecondary: '#A9B8C9', textMuted: '#8E9FB4',
    border: '#243349', borderStrong: '#3A4D66', hover: '#182538',
  },
};

export const C = { ...PALETTES.light };

const KEY = 'sicc-theme';
const prefersDark = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;

export function getStoredMode() {
  try { return localStorage.getItem(KEY) || 'light'; } catch { return 'light'; }
}
export function resolveMode(mode) { return mode === 'system' ? (prefersDark() ? 'dark' : 'light') : (mode === 'dark' ? 'dark' : 'light'); }

export function applyTheme(mode) {
  const effective = resolveMode(mode);
  Object.assign(C, PALETTES[effective]);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = effective;
    document.documentElement.style.colorScheme = effective;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', effective === 'dark' ? '#070E1C' : '#0C1B3A');
  }
  return effective;
}
export function storeMode(mode) { try { localStorage.setItem(KEY, mode); } catch { /* storage unavailable */ } }

applyTheme(getStoredMode());
