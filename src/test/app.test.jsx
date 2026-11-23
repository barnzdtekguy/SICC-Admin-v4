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

describe('Operation R.E.D. onboarding', () => {
  const token = 'x'.repeat(43);
  const leader = { ...PASTOR, id: 'red-leader', name: 'Ada Leader', email: null, role: 'red_leader' };
  const member = { ...PASTOR, id: 'red-member', name: 'Bola Member', email: null, role: 'red_member' };
  const team = { id: 'team-id', leader_name: leader.name, joined: 2, seat_limit: 5 };
  const signedOut = [{ error: 'Please sign in to continue.' }, 401];

  it('signs up a leader with a phone and opens the private dashboard', async () => {
    const calls = mockApi({
      '/auth/me': signedOut,
      'POST /public/red/leader-invites/inspect': { kind: 'leader' },
      'POST /public/red/leader-invites/accept': [session(leader), 201],
      '/red/team': { ...team, members: [{ ...leader, joined_at: '2026-11-23 10:00:00' }] },
    });
    const user = userEvent.setup();
    goto(`/red/invite/leader#${token}`);
    render(<App />);
    expect(await screen.findByRole('heading', { name: /you have been invited to lead/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await user.type(screen.getByRole('textbox', { name: 'Full name' }), 'Ada Leader');
    await user.type(screen.getByRole('textbox', { name: 'Phone number' }), '08012345678');
    await user.type(screen.getByLabelText(/^Password/), 'Granite!Lantern-7731');
    await user.click(screen.getByRole('button', { name: 'Create account and sign in' }));
    expect(await screen.findByRole('heading', { name: 'Operation R.E.D.' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Team roster' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/app/overview');
    expect(window.location.hash).toBe('');
    expect(calls.find(call => call.path.endsWith('/accept')).body).toEqual({
      name: 'Ada Leader', phone: '08012345678', email: '', password: 'Granite!Lantern-7731', token,
    });
  });

  it('records a decline without opening an account form', async () => {
    const calls = mockApi({
      '/auth/me': signedOut,
      'POST /public/red/leader-invites/inspect': { kind: 'leader' },
      'POST /public/red/leader-invites/decline': { recorded: true },
    });
    goto(`/red/invite/leader#${token}`);
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    expect(await screen.findByText(/recorded your response/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Phone number')).toBeNull();
    expect(calls.find(call => call.path.endsWith('/decline')).body).toEqual({ token });
  });

  it('shows a neutral duplicate phone error and offers sign-in on a team invitation', async () => {
    mockApi({
      '/auth/me': signedOut,
      'POST /public/red/team-invites/inspect': { ...team, kind: 'member' },
      'POST /public/red/team-invites/accept': [{ error: 'We couldn’t create this account.', code: 'red_account_unavailable' }, 409],
    });
    const user = userEvent.setup();
    goto(`/red/invite/member#${token}`);
    render(<App />);
    expect(await screen.findByRole('heading', { name: /join ada leader/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await user.type(screen.getByRole('textbox', { name: 'Full name' }), 'Bola Member');
    await user.type(screen.getByRole('textbox', { name: 'Phone number' }), '08012345678');
    await user.type(screen.getByLabelText(/^Password/), 'Granite!Lantern-7731');
    await user.click(screen.getByRole('button', { name: 'Create account and sign in' }));
    expect(await screen.findByRole('link', { name: 'Sign in to an existing account' })).toHaveAttribute('href', '/login');
  });

  it('supports phone sign-in and keeps a member out of church screens and leader actions', async () => {
    const calls = mockApi({ '/auth/me': signedOut, 'POST /auth/login': session(member), '/red/team': team });
    const user = userEvent.setup();
    goto('/app/members');
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Phone' }));
    await user.type(screen.getByLabelText('Phone'), '08012345678');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText('Password'), 'Granite!Lantern-7731');
    await user.click(screen.getByRole('button', { name: /log in$/i }));
    expect(await screen.findByRole('heading', { name: 'Operation R.E.D.' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/app/overview');
    expect(screen.queryByRole('button', { name: 'Open join link' })).toBeNull();
    expect(calls.find(call => call.path === '/auth/login').body.identifier).toBe('08012345678');
    expect(calls.some(call => ['/members', '/brief', '/red/team/join-link'].includes(call.path))).toBe(false);
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

it('shows the Bishop mobile overview and routes its dock to real Bishop pages', async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(media => ({
    matches: media === '(max-width: 860px)', addEventListener() {}, removeEventListener() {},
  }));
  const calls = mockApi({
    '/auth/me': session({ ...PASTOR, role: 'bishop', name: 'Bishop Obi', mfa_enabled: true }),
    '/brief': { newMembers7d: 5, pendingApprovals: 2, birthdaysToday: 0, attendanceTrend: [{ service: 'Sunday Service', count: 246 }] },
  });
  goto('/app/overview');
  render(<App />);

  const hero = await screen.findByRole('region', { name: 'Latest service attendance' }, { timeout: 3000 });
  expect(await within(hero).findByText('246')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Quick actions' })).getAllByRole('link')).toHaveLength(4);
  expect(calls.map(call => call.path)).not.toContain('/members');

  const dock = within(screen.getByRole('navigation', { name: 'Bishop mobile navigation' }));
  expect(dock.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  const more = dock.getByRole('button', { name: 'More' });
  await userEvent.click(more);
  const pages = within(screen.getByRole('dialog', { name: 'More pages' }));
  expect(pages.getByRole('button', { name: 'User accounts' })).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(more).toHaveFocus();

  const attendance = dock.getByRole('button', { name: 'Programme attendance' });
  await userEvent.click(attendance);
  expect(window.location.pathname).toBe('/app/programmes');
  expect(attendance).toHaveAttribute('aria-current', 'page');
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
