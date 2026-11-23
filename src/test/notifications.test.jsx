import { afterEach, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationBell from '../components/shared/NotificationBell';

const items = Array.from({ length: 7 }, (_, index) => ({
  id: String(index + 1),
  title: `Update ${index + 1}`,
  body: 'Your latest ministry activity.',
  created_at: '2026-11-20 09:22:00',
  read_at: index < 2 ? null : '2026-11-20 10:00:00',
}));
const response = (data, status = 200) => new Response(JSON.stringify(status === 200 ? { data } : data), { status });

afterEach(() => { vi.unstubAllGlobals(); });

it('preserves unread status when opening or expanding the bell and marks only a selected item', async () => {
  const writes = [];
  vi.stubGlobal('fetch', vi.fn(async (path, { method }) => {
    if (method === 'POST') {
      writes.push(path);
      return response({ success: true });
    }
    return response({ items, unread: 2 });
  }));
  const user = userEvent.setup();
  render(<NotificationBell onNavigate={vi.fn()} />);

  const bell = await screen.findByRole('button', { name: 'Notifications, 2 unread' });
  await user.click(bell);
  const dialog = within(screen.getByRole('dialog', { name: 'Notifications' }));
  expect(dialog.queryByRole('button', { name: /update 7/i })).toBeNull();
  await user.click(dialog.getByRole('button', { name: 'See all' }));
  expect(dialog.getByRole('button', { name: /update 7/i })).toBeInTheDocument();
  expect(writes).toEqual([]);

  await user.click(dialog.getByRole('button', { name: /update 1.*unread/i }));
  expect(dialog.getByRole('heading', { name: 'Update 1' })).toHaveFocus();
  expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument();
  expect(writes).toEqual(['/api/notifications/1/read']);
  expect(dialog.getByText('Read', { exact: true })).toBeInTheDocument();
  await user.click(dialog.getByRole('button', { name: 'Back to notifications' }));
  expect(dialog.queryByRole('button', { name: /update 1.*unread/i })).toBeNull();
  expect(dialog.getByRole('button', { name: /update 2.*unread/i })).toBeInTheDocument();
  expect(dialog.getByRole('button', { name: 'Update 1' })).toHaveFocus();
  expect(dialog.getByRole('button', { name: 'Update 7' })).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(bell).toHaveFocus();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('keeps an item unread until a read update or retry succeeds', async () => {
  let fail = true;
  vi.stubGlobal('fetch', vi.fn(async (_path, { method }) => method === 'POST'
    ? fail ? response({ error: 'Could not save' }, 500) : response({ success: true })
    : response({ items: items.slice(0, 2), unread: 2 })));
  const user = userEvent.setup();
  render(<NotificationBell onNavigate={vi.fn()} />);
  const bell = await screen.findByRole('button', { name: 'Notifications, 2 unread' });
  await user.click(bell);
  await user.click(screen.getByRole('button', { name: /update 1.*unread/i }));
  expect(await screen.findByRole('status')).toHaveTextContent('Couldn’t mark that notification as read.');
  expect(bell).toHaveAccessibleName('Notifications, 2 unread');
  fail = false;
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Read', { exact: true })).toBeInTheDocument();
  expect(bell).toHaveAccessibleName('Notifications, 1 unread');
});

it('opens the whole linked message before offering to navigate to its related page', async () => {
  const linked = {
    ...items[0],
    title: 'Full programme update',
    body: 'Please review the report for the outreach programme.\n\nThe second paragraph explains where the team should meet and what they should bring.',
    link: '/app/reports',
  };
  const writes = [];
  let read = false;
  let finishRead;
  vi.stubGlobal('fetch', vi.fn(async (path, { method }) => {
    if (method === 'POST') {
      writes.push(path);
      return new Promise(resolve => {
        finishRead = () => { read = true; resolve(response({ success: true })); };
      });
    }
    return response({ items: [{ ...linked, read_at: read ? '2026-11-20 10:00:00' : null }], unread: Number(!read) });
  }));
  const navigate = vi.fn();
  const user = userEvent.setup();
  render(<NotificationBell onNavigate={navigate} />);
  const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' });
  await user.click(bell);
  const dialog = within(screen.getByRole('dialog', { name: 'Notifications' }));
  await user.click(dialog.getByRole('button', { name: 'Full programme update, unread' }));
  const detail = dialog.getByRole('article', { name: linked.title });
  expect(detail.querySelector('p').textContent).toBe(linked.body);
  expect(within(detail).getByText('Unread')).toBeInTheDocument();
  await act(async () => finishRead());
  expect(await dialog.findByText('Read', { exact: true })).toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled();
  expect(writes).toEqual(['/api/notifications/1/read']);

  await user.click(dialog.getByRole('button', { name: 'Back to notifications' }));
  await user.click(dialog.getByRole('button', { name: linked.title }));
  expect(writes).toEqual(['/api/notifications/1/read']);
  await user.click(dialog.getByRole('button', { name: 'Open related page' }));
  expect(navigate).toHaveBeenCalledWith(linked.link);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('loads new arrivals as unread when the bell is opened again', async () => {
  let notifications = [items[2]];
  const writes = [];
  vi.stubGlobal('fetch', vi.fn(async (path, { method }) => {
    if (method === 'POST') writes.push(path);
    return response({ items: notifications, unread: notifications.filter(item => !item.read_at).length });
  }));
  const user = userEvent.setup();
  render(<NotificationBell onNavigate={vi.fn()} />);
  const bell = screen.getByRole('button', { name: 'Notifications' });
  await user.click(bell);
  expect(await screen.findByRole('button', { name: 'Update 3' })).toBeInTheDocument();
  await user.keyboard('{Escape}');
  notifications = [{ ...items[0], title: 'New arrival' }, ...notifications];

  await user.click(bell);
  expect(await screen.findByRole('button', { name: 'New arrival, unread' })).toBeInTheDocument();
  expect(bell).toHaveAccessibleName('Notifications, 1 unread');
  expect(writes).toEqual([]);
});

it('receives unread arrivals while the notification box stays open', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    const arrival = { ...items[0], title: 'New team update' };
    let hasArrival = false;
    const fetchMock = vi.fn(async () => response(hasArrival ? { items: [arrival], unread: 1 } : { items: [], unread: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<NotificationBell onNavigate={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('You’re all caught up.')).toBeInTheDocument();

    hasArrival = true;
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(screen.getByRole('button', { name: 'New team update, unread' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
