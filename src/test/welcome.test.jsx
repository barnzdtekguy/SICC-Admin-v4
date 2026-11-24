import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import { navigationFor } from '../components/shared/Layout';
import { PASSWORD_HINT } from '../../shared/password-policy.mjs';

const roles = [
  ['bishop', 'Operation R.E.D.', 'Register member'],
  ['admin', 'User management', 'Communication'],
  ['pastor', 'Register member', 'User accounts'],
  ['department_leader', 'Department members', 'Programme attendance'],
  ['kdf_coordinator', 'Area members', 'User management'],
  ['red_leader', 'Join link', 'Church Members'],
  ['red_member', 'Add soul', 'Join link'],
];

const reply = (data, status = 200) => new Response(JSON.stringify(status < 400 ? { data } : data), { status });
const visit = path => window.history.replaceState({}, '', path);

function stubSession(role, { pending = true, restrictions = [] } = {}) {
  const id = `tour-test-${role}`;
  const calls = [];
  const state = { pending, restrictions };
  const profile = { id, email: 'person@example.test', name: 'Test User', role, avatar: 'TU', is_active: true, mfa_enabled: true };
  const session = () => ({ user: { id, email: profile.email }, profile, restrictions: state.restrictions, welcome_tour_pending: state.pending });
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    calls.push({ url, body: options?.body && JSON.parse(options.body) });
    if (url === '/api/auth/me') return reply(session());
    if (url === '/api/auth/welcome-tour') {
      state.pending = false;
      return reply({ welcome_tour_pending: false });
    }
    if (url === '/api/auth/password') {
      state.restrictions = [];
      return reply(session());
    }
    if (url === '/api/notifications') return reply({ items: [], unread: 0 });
    return reply([]);
  }));
  return { id, calls, state };
}

beforeEach(() => { localStorage.clear(); visit('/app/security'); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('the welcome tour', () => {
  it.each(roles)('explains the %s role on mobile or desktop using its real navigation', async (role, available, forbidden) => {
    const testSession = stubSession(role);
    const mobile = ['admin', 'pastor', 'kdf_coordinator', 'red_member'].includes(role);
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ matches: mobile && query.includes('max-width'), addEventListener() {}, removeEventListener() {} }));
    render(<App />);

    const guide = within(await screen.findByRole('dialog', { name: 'Welcome tour' }));
    expect(guide.getByRole('heading')).toHaveTextContent('Welcome to SICC Admin');
    expect(guide.getByRole('button', { name: 'Back' })).toBeDisabled();
    const next = () => fireEvent.click(guide.getByRole('button', { name: 'Next' }));
    next();
    expect(guide.getByRole('heading')).not.toHaveTextContent('Welcome to SICC Admin');
    fireEvent.click(guide.getByRole('button', { name: 'Back' }));
    expect(guide.getByRole('heading')).toHaveTextContent('Welcome to SICC Admin');

    let isLast = false;
    const titles = [];
    const cues = [];
    const allowedPages = navigationFor({ role });
    for (let i = 0; i < allowedPages.length + 4; i += 1) {
      titles.push(guide.getByRole('heading').textContent);
      cues.push(guide.getByRole('heading').nextElementSibling.textContent);
      isLast = Boolean(guide.queryByRole('button', { name: 'Finish' }));
      if (isLast) break;
      next();
    }
    expect(isLast).toBe(true);
    expect(titles).toContain(available);
    expect(titles).not.toContain(forbidden);
    expect(titles).toEqual(expect.arrayContaining(allowedPages.filter(page => page.key !== 'overview').map(page => page.label)));
    if (mobile) {
      expect(cues.some(cue => cue.includes('bottom menu'))).toBe(true);
      expect(cues.some(cue => cue.includes('Open More'))).toBe(true);
    }
    fireEvent.click(guide.getByRole('button', { name: role === 'red_member' ? 'Skip tour' : 'Finish' }));
    expect(screen.queryByRole('dialog', { name: 'Welcome tour' })).toBeNull();
    await waitFor(() => expect(testSession.calls).toContainEqual({ url: '/api/auth/welcome-tour', body: { account_id: testSession.id } }));
  });

  it.each(['Skip tour', 'Finish'])('keeps the tour dismissed at the next sign-in after %s', async action => {
    const { state } = stubSession('red_member');
    const first = render(<App />);
    const guide = within(await screen.findByRole('dialog', { name: 'Welcome tour' }));
    if (action === 'Finish') {
      for (let i = 0; i < navigationFor({ role: 'red_member' }).length + 2; i += 1) fireEvent.click(guide.getByRole('button', { name: 'Next' }));
    }
    fireEvent.click(guide.getByRole('button', { name: action }));
    await waitFor(() => expect(state.pending).toBe(false));
    first.unmount();
    localStorage.clear();
    render(<App />);
    await screen.findByRole('main');
    expect(screen.queryByRole('dialog', { name: 'Welcome tour' })).toBeNull();
  });
});

it('waits for required security setup and validates the new password before sending it', async () => {
  const { calls } = stubSession('bishop', { restrictions: ['password_change'] });
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Welcome tour' })).toBeNull();
  const current = screen.getByLabelText(/^Temporary password/);
  const next = screen.getByLabelText(/^New password/);
  const confirm = screen.getByLabelText(/^Confirm new password/);
  fireEvent.change(current, { target: { value: 'Old1!Password' } });
  fireEvent.change(next, { target: { value: 'ABCDEFG1' } });
  fireEvent.change(confirm, { target: { value: 'ABCDEFG1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(PASSWORD_HINT);
  expect(calls.some(call => call.url === '/api/auth/password')).toBe(false);
  fireEvent.change(next, { target: { value: 'ABCD12!Z' } });
  fireEvent.change(confirm, { target: { value: 'ABCD12!Z' } });
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
  expect(await screen.findByRole('dialog', { name: 'Welcome tour' })).toBeInTheDocument();
  expect(calls.find(call => call.url === '/api/auth/password').body.new_password).toBe('ABCD12!Z');
});

it('shows the Operation R.E.D. mission and team targets to signed-out visitors', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply({ error: 'Please sign in to continue.' }, 401)));
  visit('/');
  render(<App />);
  const heading = await screen.findByRole('heading', { name: 'Project 3000 by Love Revolution — Operation R.E.D.' });
  const section = within(heading.closest('section'));
  expect(section.getByText(/more than 3,000 souls before SOC Africa 2027/)).toHaveTextContent('22 to 25 April 2027');
  for (const step of ['Recruit', 'Equip', 'Deploy']) expect(section.getByRole('heading', { name: step })).toBeInTheDocument();
  expect(section.getByText('teams of five: one leader and four members')).toBeInTheDocument();
  expect(section.getByText('three souls per month')).toBeInTheDocument();
  expect(window.location.pathname).toBe('/');
});
