import { useCallback, useEffect, useState } from 'react';
import { Inbox, Check, X, ArrowRight } from 'lucide-react';
import { C } from '../../lib/theme';
import { useAuth } from '../../hooks/useAuth';
import { PRIVILEGED_ROLES } from './roles';
import { getCorrections, approveCorrection, rejectCorrection } from '../../lib/db';
import { useToast } from '../shared/Toast';
import { Panel, Btn, Badge, EmptyState, ConfirmDialog, PageHeader, PageSkeleton, Alert } from '../shared/UI';

const when = v => new Date(`${String(v).replace(' ', 'T')}Z`).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
const statusBadge = s => <Badge label={s[0].toUpperCase() + s.slice(1)} color={s === 'approved' ? C.success : s === 'rejected' ? C.danger : C.warning} />;
const show = v => Object.entries(v || {}).map(([k, val]) => `${k.replace(/_/g, ' ')}: ${val ?? '–'}`).join(', ');

export default function Approvals() {
  const { profile } = useAuth();
  const toast = useToast();
  const canDecide = PRIVILEGED_ROLES.includes(profile.role);
  const [rows, setRows] = useState(null); const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);
  const load = useCallback(() => getCorrections().then(setRows).catch(e => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const decide = async (note) => {
    const fn = dialog.kind === 'approve' ? approveCorrection : rejectCorrection;
    const { error: err } = await fn(dialog.row.id, note);
    if (err) toast.error(err.message); else toast.success(dialog.kind === 'approve' ? 'Correction approved and applied.' : 'Correction rejected.');
    setDialog(null); load();
  };

  if (error) return <Alert type="error" message={error} />;
  if (!rows) return <PageSkeleton />;
  const pending = rows.filter(r => r.status === 'pending'); const done = rows.filter(r => r.status !== 'pending');
  const card = r => (
    <article key={r.id} style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, background: C.cardBg, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div><div style={{ fontWeight: 600, fontSize: 15, color: C.textPrimary }}>{r.entity_label}</div><div style={{ fontSize: 12, color: C.textMuted }}>Requested by {r.requested_by_name} · {when(r.created_at)}</div></div>
        {statusBadge(r.status)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 14 }}>
        <code style={{ background: C.dangerBg, color: C.danger, padding: '4px 10px', borderRadius: 8 }}>{show(r.current)}</code><ArrowRight size={16} aria-hidden style={{ color: C.textMuted }} />
        <code style={{ background: C.successBg, color: C.success, padding: '4px 10px', borderRadius: 8 }}>{show(r.proposed)}</code>
      </div>
      <p style={{ fontSize: 13, color: C.textSecondary }}><strong>Reason:</strong> {r.reason}</p>
      {r.status !== 'pending' && <p style={{ fontSize: 12, color: C.textMuted }}>{r.status === 'approved' ? 'Approved' : 'Rejected'} by {r.decided_by_name} · {r.decided_at && when(r.decided_at)}{r.decision_note ? ` — ${r.decision_note}` : ''}</p>}
      {r.status === 'pending' && canDecide && (r.requested_by === profile.id
        ? <p style={{ fontSize: 12, color: C.textMuted }}>You requested this, so another leader must decide it.</p>
        : <div style={{ display: 'flex', gap: 8 }}><Btn color={C.success} size="sm" onClick={() => setDialog({ kind: 'approve', row: r })}><Check size={14} aria-hidden /> Approve</Btn><Btn color={C.danger} size="sm" variant="outline" onClick={() => setDialog({ kind: 'reject', row: r })}><X size={14} aria-hidden /> Reject</Btn></div>)}
    </article>
  );
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <PageHeader title={canDecide ? 'Approvals' : 'My corrections'} subtitle={canDecide ? 'Locked records can only change with a second leader’s approval.' : 'Requests you sent for locked records, and their outcome.'} />
      <Panel title={`Waiting (${pending.length})`}>
        {pending.length ? <div style={{ display: 'grid', gap: 12 }}>{pending.map(card)}</div> : <EmptyState icon={<Inbox size={24} />} title="Nothing waiting" description={canDecide ? 'New correction requests will appear here and in your notifications.' : 'When an attendance record is locked, request a correction from the attendance page.'} />}
      </Panel>
      {done.length > 0 && <Panel title="History"><div style={{ display: 'grid', gap: 12 }}>{done.slice(0, 30).map(card)}</div></Panel>}
      {dialog && <ConfirmDialog title={dialog.kind === 'approve' ? 'Approve this correction?' : 'Reject this correction?'} message={dialog.kind === 'approve' ? `This will change the record to: ${show(dialog.row.proposed)}. The previous value is kept in the history.` : 'The requester will be told why.'} confirmLabel={dialog.kind === 'approve' ? 'Approve' : 'Reject'} danger={dialog.kind === 'reject'} requireReason={dialog.kind === 'reject'} reasonLabel="Why are you rejecting it?" onConfirm={decide} onCancel={() => setDialog(null)} />}
    </div>
  );
}
