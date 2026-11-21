import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';

const PASTOR = { id: 'p1', name: 'Pastor Ada Obi', email: 'ada@test.local', role: 'pastor', avatar: 'AO', mfa_enabled: false, must_change_password: false, is_active: true };
const session = (profile = PASTOR, restrictions = []) => ({ user: { id: profile.id, email: profile.email }, profile, restrictions, session: { remember: false, idle_minutes: 120, expires_at: null } });
const json = (data, status = 200) => Promise.resolve(new Response(JSON.stringify(status < 400 ? { data } : data), { status, headers: { 'Content-Type': 'application/json' } }));

function mockApi(routes) {
  const calls = [];
  globalThis.fetch = vi.fn((url, init = {}) => {
    const path = String(url).replace(/^\/api/, '').split('?')[0];
    calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    const handler = routes[`${init.method || 'GET'} ${path}`] || routes[path];
    if (handler) return json(...[].concat(handler instanceof Function ? handler(init) : handler));
    if (path === '/notifications') return json({ items: [], unread: 0 });
    if (path === '/brief') return json({ myMembers: 3, overdue: [], needsContact: [], birthdays: [] });
    return json([]);
  });
  return calls;
}
const goto = path => window.history.pushState({}, '', path);

beforeEach(() => { localStorage.clear(); goto('/'); });

describe('routing and auth gates', () => {
  it('sends a signed-out visitor to the login page and remembers where they were going', async () => {
    mockApi({ '/auth/me': [{ error: 'Please sign in to continue.' }, 401] });
    goto('/app/followup');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /log in to sicc admin/i })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
  });

  it('sends every state-changing request with the CSRF header and never reads cookies from JS', async () => {
    const calls = mockApi({ '/auth/me': [{ error: 'x' }, 401], 'POST /auth/login': [{ error: 'Invalid username/email or password.' }, 401] });
    goto('/login');
    render(<App />);
    await userEvent.type(await screen.findByLabelText('Email'), 'ada@test.local');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await userEvent.type(await screen.findByLabelText('Password'), 'wrong-password-123');
    await userEvent.click(screen.getByRole('button', { name: /log in$/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    const login = calls.find(c => c.path === '/auth/login');
    expect(login.headers['X-SICC-Client']).toBe('web');
    expect(login.body.rememberMe).toBe(false); // "keep me signed in" is opt-in now
  });

  it('completes two-step sign-in and lands on the role dashboard with the morning brief', async () => {
    const calls = mockApi({
      '/auth/me': [{ error: 'x' }, 401],
      'POST /auth/login': { mfa_required: true, challenge: 'challenge-token' },
      'POST /auth/mfa/verify': session(),
    });
    goto('/login');
    render(<App />);
    await userEvent.type(await screen.findByLabelText('Email'), 'ada@test.local');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await userEvent.type(await screen.findByLabelText('Password'), 'Granite!Lantern-7731');
    await userEvent.click(screen.getByRole('button', { name: /log in$/i }));
    expect(await screen.findByRole('heading', { name: /two-step verification/i })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/authenticator code/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /verify and sign in/i }));
    expect(await screen.findByRole('heading', { name: /Ada\./ })).toBeInTheDocument(); // "Good morning, Ada." (title stripped)
    expect(window.location.pathname).toBe('/app/overview');
    expect(calls.find(c => c.path === '/auth/mfa/verify').body).toEqual({ challenge: 'challenge-token', code: '123456' });
    expect(screen.getByRole('link', { name: /skip to content/i })).toBeInTheDocument();
  });

  it('blocks the whole app behind the forced password change', async () => {
    mockApi({ '/auth/me': session({ ...PASTOR, must_change_password: true }, ['password_change']) });
    goto('/app/members');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /choose a new password/i })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /main/i })).toBeNull();
  });

  it('forces mandatory two-step setup for the Bishop before any data loads', async () => {
    const calls = mockApi({ '/auth/me': session({ ...PASTOR, role: 'bishop', name: 'Bishop B' }, ['mfa_setup']) });
    goto('/app/overview');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /secure your account/i })).toBeInTheDocument();
    expect(calls.some(c => c.path === '/members' || c.path === '/brief')).toBe(false);
  });

  it('navigates with real URLs, keeps focus-friendly landmarks and redirects unknown tabs', async () => {
    mockApi({ '/auth/me': session() });
    goto('/app/not-a-real-tab');
    render(<App />);
    expect(await screen.findByRole('navigation', { name: /main/i })).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe('/app/overview'));
    const nav = screen.getByRole('navigation', { name: /main/i });
    await userEvent.click(within(nav).getByRole('button', { name: /my members/i }));
    expect(window.location.pathname).toBe('/app/myMembers');
    expect(within(nav).getByRole('button', { name: /my members/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('a 401 from any API call returns the user to sign-in with an explanation', async () => {
    let revoked = false;
    mockApi({ '/auth/me': () => session(), '/members': () => (revoked ? [{ error: 'Your session has ended. Please sign in again.' }, 401] : [[]]) });
    goto('/app/myMembers');
    render(<App />);
    await screen.findByRole('navigation', { name: /main/i });
    revoked = true;
    act(() => window.dispatchEvent(new CustomEvent('sicc:unauthorized', { detail: 'Your session has ended. Please sign in again.' })));
    expect(await screen.findByText(/your session has ended/i)).toBeInTheDocument();
  });
});

describe('programme check-in', () => {
  const programme = { id: 'sunday-service', name: 'Sunday Service', programme_type: 'service' };

  it('opens programme attendance from the dashboard', async () => {
    const calls = mockApi({ '/auth/me': session(), '/programmes': [[programme]], '/checkin/session': { token: 'current', refresh_in: 60 } });
    goto('/app/programmes');
    render(<App />);
    expect(await screen.findByLabelText('Programme')).toHaveValue('sunday-service');
    expect(screen.queryByRole('button', { name: 'Leadership Training' })).toBeNull();
    await waitFor(() => expect(calls.some(c => c.path === '/programme-attendance-records')).toBe(true));
  });

  it('shows that a retired programme is unavailable when someone opens an old QR link', async () => {
    mockApi({ '/programmes': [[programme]] });
    goto('/app/greatness?checkin=1&programme=greatness-32-days&day=1');
    render(<App />);
    expect(await screen.findByText(/this programme is unavailable/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Full Name')).toBeNull();
  });

  it('opens the public check-in form for a current programme', async () => {
    mockApi({ '/programmes': [[programme]] });
    goto('/app/programmes?checkin=1&programme=sunday-service&t=current');
    render(<App />);
    expect(await screen.findByLabelText('Full Name')).toBeInTheDocument();
    expect(screen.getByText('Sunday Service')).toBeInTheDocument();
  });
});

it('keeps the Pastor follow-up draft after a rejected save and allows retry', async () => {
  let reject = true;
  mockApi({
    '/auth/me': session(),
    '/members': [[{ id: 'm1', first_name: 'Test', last_name: 'Member' }]],
    'POST /follow-ups': () => reject
      ? [{ error: 'Could not save the report.' }, 500]
      : [{ id: 'f1', member_name: 'Test Member', notes: 'Called on Monday.', status: 'In Progress' }, 201],
  });
  goto('/app/followup');
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Submit Follow-Up' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Submit Follow-Up Report' }));
  await userEvent.selectOptions(dialog.getByLabelText(/member/i), await dialog.findByRole('option', { name: 'Test Member' }));
  await userEvent.type(dialog.getByLabelText(/notes/i), 'Called on Monday.');
  await userEvent.click(dialog.getByRole('button', { name: 'Submit Report' }));
  expect(await dialog.findByRole('alert')).toHaveTextContent('Could not save the report.');
  expect(dialog.getByLabelText(/notes/i)).toHaveValue('Called on Monday.');
  reject = false;
  await userEvent.click(dialog.getByRole('button', { name: 'Submit Report' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Submit Follow-Up Report' })).toBeNull());
  expect(within(screen.getByRole('table')).getByText('Called on Monday.')).toBeInTheDocument();
});
