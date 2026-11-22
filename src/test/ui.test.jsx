import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, Modal, ConfirmDialog, Input, Btn, Alert, StatCard } from '../components/shared/UI';
import { applyTheme, C, PALETTES } from '../lib/theme';

const rows = Array.from({ length: 30 }, (_, i) => ({ id: i, name: `Person ${String(i).padStart(2, '0')}`, n: 30 - i }));
const columns = [{ key: 'name', label: 'Name', render: (v) => <b>{v}</b> }, { key: 'n', label: 'Count' }];

describe('DataTable', () => {
  it('keeps the (value, row) render signature, pages, sorts and labels sort state', async () => {
    render(<DataTable columns={columns} rows={rows} pageSize={10} exportName="people" />);
    expect(screen.getAllByRole('row')).toHaveLength(11); // header + 10
    expect(within(screen.getByRole('table')).getByText('Person 00').tagName).toBe('B');
    expect(screen.getByText(/1–10 of 30/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(within(screen.getByRole('table')).getByText('Person 10')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Count' }));
    expect(screen.getByRole('columnheader', { name: /count/i })).toHaveAttribute('aria-sort', 'ascending');
    expect(within(screen.getAllByRole('row')[1]).getByText('1')).toBeInTheDocument();
  });
  it('rows are keyboard-activatable', async () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} rows={rows.slice(0, 2)} onRowClick={onRowClick} />);
    const row = screen.getAllByRole('button').find(el => el.tagName === 'TR');
    row.focus(); await userEvent.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenCalledOnce();
  });
  it('shows an empty state', () => { render(<DataTable columns={columns} rows={[]} emptyText="Nothing here" />); expect(screen.getByText('Nothing here')).toBeInTheDocument(); });
  it('shows six columns by default, keeps actions and reveals the remaining values', async () => {
    const extra = Array.from({ length: 7 }, (_, i) => ({ key: `field-${i}`, label: `Field ${i}` }));
    const manage = { key: 'actions', label: '', render: () => <button type="button">Manage</button> };
    render(<DataTable columns={[...extra, manage]} rows={[{ id: 1, 'field-6': 'Last value' }]} />);
    const table = within(screen.getByRole('table'));
    expect(table.getAllByRole('columnheader')).toHaveLength(6);
    expect(table.getByRole('button', { name: 'Manage' })).toBeInTheDocument();
    expect(table.queryByText('Last value')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show all columns' }));
    expect(table.getAllByRole('columnheader')).toHaveLength(8);
    expect(table.getByText('Last value')).toBeInTheDocument();
  });
});

describe('Modal + ConfirmDialog accessibility', () => {
  it('is a labelled modal dialog that closes on Escape and traps focus', async () => {
    const onClose = vi.fn();
    render(<Modal title="Edit thing" onClose={onClose}><Input label="Name" value="" onChange={() => {}} /></Modal>);
    const dialog = screen.getByRole('dialog', { name: 'Edit thing' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('Name')).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
  it('requires a reason before confirming', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog title="Delete" message="Sure?" requireReason confirmLabel="Delete" onConfirm={onConfirm} onCancel={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Delete' });
    expect(btn).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/reason/i), 'Registered by mistake');
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledWith('Registered by mistake');
  });
});

describe('form + feedback primitives', () => {
  it('Input ties label, error and aria-invalid together', () => {
    render(<Input label="Email" value="" onChange={() => {}} error="Enter a valid email" required />);
    const input = screen.getByLabelText(/email/i);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email');
  });
  it('Btn exposes loading state and blocks clicks', async () => {
    const onClick = vi.fn();
    render(<Btn loading onClick={onClick}>Save</Btn>);
    const b = screen.getByRole('button', { name: /save/i });
    expect(b).toHaveAttribute('aria-busy', 'true'); await userEvent.click(b); expect(onClick).not.toHaveBeenCalled();
  });
  it('Alert uses alert role for errors and status for info; StatCard is a button only when clickable', () => {
    const { rerender } = render(<Alert type="error" message="Bad" />); expect(screen.getByRole('alert')).toBeInTheDocument();
    rerender(<Alert type="info" message="FYI" />); expect(screen.getByRole('status')).toBeInTheDocument();
    rerender(<StatCard label="Members" value={5} onClick={() => {}} />); expect(screen.getByRole('button', { name: /members/i })).toBeInTheDocument();
    rerender(<StatCard label="Members" value={5} />); expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('theme', () => {
  it('switches palette tokens and keeps text contrast above 4.5:1', () => {
    const lum = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    for (const mode of ['light', 'dark']) {
      const p = PALETTES[mode];
      for (const fg of ['textPrimary', 'textSecondary', 'textMuted']) expect(ratio(p[fg], p.cardBg), `${mode} ${fg}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(p.textMuted, p.pageBg), `${mode} muted on page`).toBeGreaterThanOrEqual(4.5);
    }
    applyTheme('dark'); expect(C.cardBg).toBe(PALETTES.dark.cardBg); expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme('light'); expect(C.cardBg).toBe(PALETTES.light.cardBg);
  });
});
