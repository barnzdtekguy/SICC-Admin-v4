import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
  expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument();
  expect(writes).toEqual(['/api/notifications/1/read']);
  expect(dialog.queryByRole('button', { name: /update 1.*unread/i })).toBeNull();
  expect(dialog.getByRole('button', { name: /update 2.*unread/i })).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(bell).toHaveFocus();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('keeps an item unread if the selected-item update fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_path, { method }) => method === 'POST'
    ? response({ error: 'Could not save' }, 500)
    : response({ items: items.slice(0, 2), unread: 2 })));
  const user = userEvent.setup();
  render(<NotificationBell onNavigate={vi.fn()} />);
  const bell = await screen.findByRole('button', { name: 'Notifications, 2 unread' });
  await user.click(bell);
  await user.click(screen.getByRole('button', { name: /update 1.*unread/i }));
  expect(await screen.findByRole('status')).toHaveTextContent('Couldn’t mark that notification as read.');
  expect(bell).toHaveAccessibleName('Notifications, 2 unread');
});
