import { randomInt } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { detectQuickLogin, unlockWithPin, verifyQuickMfa } from '../lib/quickLogin';

vi.mock('../lib/quickLogin', () => ({
  canTrustBrowser: () => false,
  detectQuickLogin: vi.fn(),
  unlockWithPin: vi.fn(),
  verifyQuickMfa: vi.fn(),
  trustBrowser: vi.fn(), forgetBrowserKey: vi.fn(),
}));

const roles = [
  ['bishop', 'User accounts'], ['admin', 'User management'], ['pastor', 'Register member'],
  ['department_leader', 'Department members'], ['kdf_coordinator', 'Area members'],
  ['red_leader', 'Join link'], ['red_member', 'My souls'],
];
const samplePin = () => String(randomInt(1000, 10000));
const pinPath = '/auth/quick-login/pin';
const profileFor = role => ({ id: `pin-${role}`, role, name: 'Test Person', email: 'pin@example.test', is_active: true, mfa_enabled: ['bishop', 'admin'].includes(role) });
const session = (role = 'pastor', restrictions = [], recent_full_auth = true) => {
  const profile = profileFor(role);
  return { user: { id: profile.id, email: profile.email }, profile, restrictions, quick_login: { pin_configured: !restrictions.includes('pin_setup'), recent_full_auth } };
};
const response = (data, status = 200) => new Response(JSON.stringify(status < 400 ? { data } : data), { status });
const signedOut = [{ error: 'Please sign in to continue.' }, 401];
const go = path => window.history.replaceState({}, '', path);

function stubApi(routes) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    const [path] = String(url).replace('/api', '').split('?');
    const method = options?.method || 'GET';
    const body = options?.body && JSON.parse(options.body);
    calls.push({ method, path, body });
    const entry = routes[`${method} ${path}`] ?? routes[path];
    if (entry) return response(...(Array.isArray(entry) ? entry : [entry]));
    if (path === '/notifications') return response({ items: [], unread: 0 });
    return response([]);
  }));
  return calls;
}

function enterPin(pin, confirmation = pin, label = '4-digit PIN') {
  const field = screen.getByLabelText(label, { exact: false });
  expect(field).toHaveAttribute('type', 'password');
  expect(field).toHaveAttribute('inputmode', 'numeric');
  fireEvent.change(field, { target: { value: pin } });
  fireEvent.change(screen.getByLabelText('Confirm PIN', { exact: false }), { target: { value: confirmation } });
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  go('/app/overview');
  vi.resetAllMocks();
  detectQuickLogin.mockResolvedValue(false);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('PIN setup and authorized routing', () => {
  it.each(roles)('gates the %s dashboard until setup succeeds', async (role, menu) => {
    const calls = stubApi({ '/auth/me': session(role, ['pin_setup']), [`POST ${pinPath}`]: session(role) });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Secure Your Account' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    const pin = samplePin();
    enterPin(pin, String(Number(pin) + (pin === '9999' ? -1 : 1)));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Your PINs do not match. Please try again.');
    expect(calls.some(call => call.path === pinPath)).toBe(false);
    enterPin(pin);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const navigation = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(navigation).getByRole('button', { name: menu })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/app/overview');
    expect(calls.find(call => call.path === pinPath)?.body.action).toBe('setup');
  });
});

describe('returning users', () => {
  it('shows the mobile keypad on a trusted browser and masks keyboard and keypad input', async () => {
    go('/');
    detectQuickLogin.mockResolvedValue(true);
    const pin = samplePin();
    unlockWithPin.mockRejectedValueOnce(new Error('That PIN did not unlock your account.')).mockResolvedValueOnce(session('pastor', [], false));
    stubApi({ '/auth/me': signedOut });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Welcome Back' })).toBeInTheDocument();
    const keypad = screen.getByRole('group', { name: 'Numeric keypad' });
    expect(within(keypad).getAllByRole('button')).toHaveLength(11);
    const entry = screen.getByRole('group', { name: 'PIN entry' });
    for (const digit of pin) fireEvent.keyDown(entry, { key: digit });
    expect(entry).toHaveTextContent('4 of 4 digits entered');
    expect(entry).not.toHaveTextContent(pin);
    fireEvent.click(within(keypad).getByRole('button', { name: 'Delete last digit' }));
    expect(entry).toHaveTextContent('3 of 4 digits entered');
    fireEvent.click(within(keypad).getByRole('button', { name: pin.at(-1) }));
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That PIN did not unlock your account.');
    expect(entry).toHaveTextContent('0 of 4 digits entered');
    for (const digit of pin) fireEvent.keyDown(entry, { key: digit });
    fireEvent.keyDown(entry, { key: 'Enter' });
    await screen.findByRole('navigation', { name: 'Main' });
    expect(unlockWithPin).toHaveBeenCalledTimes(2);
    expect(unlockWithPin.mock.calls.every(([value]) => value === pin)).toBe(true);
  });

  it('uses the existing authenticator screen before letting an administrator enter', async () => {
    detectQuickLogin.mockResolvedValue(true);
    unlockWithPin.mockResolvedValue({ mfa_required: true, challenge: 'mock-challenge' });
    verifyQuickMfa.mockResolvedValue(session('admin', [], false));
    stubApi({ '/auth/me': signedOut });
    render(<App />);
    const entry = await screen.findByRole('group', { name: 'PIN entry' });
    for (const digit of samplePin()) fireEvent.keyDown(entry, { key: digit });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByRole('heading', { name: 'Two-step verification' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    const temporaryCode = samplePin().padStart(6, '0');
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: temporaryCode } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    expect(within(await screen.findByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'User management' })).toBeInTheDocument();
    expect(verifyQuickMfa).toHaveBeenCalledOnce();
  });

  it('shows normal sign-in on unknown browsers and bypasses PIN when the session is valid', async () => {
    const api = stubApi({ '/auth/me': signedOut });
    const first = render(<App />);
    expect(await screen.findByRole('heading', { name: 'Log In to SICC Admin' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Welcome Back' })).toBeNull();
    expect(api.some(call => call.path === '/auth/me')).toBe(true);
    first.unmount();
    detectQuickLogin.mockClear().mockResolvedValue(true);
    go('/app/overview');
    stubApi({ '/auth/me': session() });
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main' });
    expect(detectQuickLogin).not.toHaveBeenCalled();
  });

  it('takes a forgotten PIN through password sign-in before allowing reset in settings', async () => {
    detectQuickLogin.mockResolvedValue(true);
    const calls = stubApi({ '/auth/me': signedOut, 'POST /auth/login': session(), [`POST ${pinPath}`]: session() });
    render(<App />);
    await userEvent.click(await screen.findByRole('link', { name: 'Forgot PIN?' }));
    const email = await screen.findByLabelText('Email');
    expect(screen.queryByRole('heading', { name: 'Welcome Back' })).toBeNull();
    fireEvent.change(email, { target: { value: 'pin@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: `${samplePin()}-Generated!` } });
    fireEvent.click(screen.getByRole('button', { name: 'Log In' }));
    expect(await screen.findByRole('heading', { name: 'Reset your PIN' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/app/security');
    const pin = samplePin();
    enterPin(pin, pin, 'New 4-digit PIN');
    fireEvent.click(screen.getByRole('button', { name: 'Save new PIN' }));
    await waitFor(() => expect(calls.some(call => call.path === pinPath && call.body.action === 'reset')).toBe(true));
    expect(await screen.findByText('Your new PIN was saved.')).toBeInTheDocument();
  });
});
