import { useState } from 'react';
import { Lock, ShieldCheck, Clock } from 'lucide-react';
import { C } from '../../lib/theme';
import { useAuth } from '../../hooks/useAuth';
import { updateAttendance, verifyAttendance, requestCorrection } from '../../lib/db';
import { useToast } from './Toast';
import { DataTable, Badge, Btn, Modal, Input, Textarea } from './UI';

// Attendance table with trust signals (recorded / verified / locked / correction pending) and the safe edit paths.
export default function AttendanceHistory({ records, reload, showDept = false, accent = C.navy, deptView = false }) {
  const { profile } = useAuth();
  const toast = useToast();
  const privileged = ['bishop', 'admin'].includes(profile.role);
  const [edit, setEdit] = useState(null); // { row, mode: 'edit' | 'request' }
  const [value, setValue] = useState(''); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);

  const open = (row, mode) => { setEdit({ row, mode }); setValue(String(deptView ? (row.dept_count ?? row.count) : row.count)); setReason(''); };
  const field = deptView ? 'dept_count' : 'count';

  const submit = async () => {
    setBusy(true);
    const n = Number(value);
    const { error } = edit.mode === 'request'
      ? await requestCorrection({ entity_type: 'attendance', entity_id: edit.row.id, proposed: deptView ? { count: n, dept_count: n } : { [field]: n }, reason })
      : await updateAttendance(edit.row.id, { ...(deptView ? { count: n, dept_count: n } : { [field]: n }), reason: reason || undefined });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(edit.mode === 'request' ? 'Correction sent to the Bishop/Admin for approval.' : 'Attendance updated.');
    setEdit(null); reload?.();
  };

  const verify = async row => { const { error } = await verifyAttendance(row.id); if (error) toast.error(error.message); else { toast.success('Marked as verified.'); reload?.(); } };

  const columns = [
    { key: 'date', label: 'Date' },
    { key: 'service', label: 'Service' },
    ...(showDept ? [{ key: 'dept_name', label: 'Department', render: v => v || 'Church-wide' }] : []),
    { key: deptView ? 'dept_count' : 'count', label: deptView ? 'Members present' : 'Total', render: (v, r) => <strong className="num" style={{ color: accent, fontSize: 16 }}>{v ?? r.count}</strong> },
    { key: 'recorded_by_name', label: 'Recorded by' },
    {
      key: 'status', label: 'Status', sortValue: r => r.status,
      render: (_, r) => (
        <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
          {r.status === 'verified' ? <Badge label="Verified" color={C.success} /> : r.status === 'corrected' ? <Badge label="Corrected" color={C.info} /> : r.locked ? <Badge label="Locked" color={C.warning} /> : <Badge label="Open" color={C.textSecondary} />}
          {r.pending_corrections > 0 && <Badge label="Correction pending" color={C.purple} />}
        </span>
      ),
    },
    {
      key: 'actions', label: '',
      render: (_, r) => {
        const own = r.recorded_by === profile.id;
        return (
          <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
            {!r.locked && (own || privileged) && <Btn size="sm" variant="ghost" color={C.info} onClick={() => open(r, 'edit')}>Edit</Btn>}
            {r.locked && privileged && <Btn size="sm" variant="ghost" color={C.info} onClick={() => open(r, 'edit')}><Lock size={12} aria-hidden /> Edit with reason</Btn>}
            {r.locked && !privileged && r.pending_corrections === 0 && <Btn size="sm" variant="ghost" color={C.warning} onClick={() => open(r, 'request')}><Clock size={12} aria-hidden /> Request correction</Btn>}
            {privileged && !own && r.status !== 'verified' && <Btn size="sm" variant="ghost" color={C.success} onClick={() => verify(r)}><ShieldCheck size={12} aria-hidden /> Verify</Btn>}
          </span>
        );
      },
    },
  ];

  const needsReason = edit && (edit.mode === 'request' || (edit.row.locked && privileged));
  return (
    <>
      <DataTable columns={columns} rows={records} emptyText="No attendance records yet." exportName="attendance" caption="Attendance history" />
      {edit && (
        <Modal title={edit.mode === 'request' ? 'Request a correction' : 'Edit attendance'} onClose={() => setEdit(null)} width={460}
          footer={<><Btn variant="outline" color={C.textSecondary} onClick={() => setEdit(null)}>Cancel</Btn><Btn color={C.navy} loading={busy} onClick={submit} disabled={value === '' || (needsReason && reason.trim().length < 10)}>{edit.mode === 'request' ? 'Send for approval' : 'Save'}</Btn></>}>
          <div style={{ display: 'grid', gap: 12 }}>
            <p style={{ fontSize: 13, color: C.textSecondary }}>{edit.row.service} · {edit.row.date}{edit.row.dept_name ? ` · ${edit.row.dept_name}` : ''}</p>
            <Input label="Correct number" type="number" value={value} onChange={setValue} min={0} inputMode="numeric" />
            {needsReason && <Textarea label="Reason" value={reason} onChange={setReason} rows={3} hint={edit.mode === 'request' ? 'A second leader reviews this. At least 10 characters.' : 'This record is locked. The reason is saved in the audit trail.'} />}
          </div>
        </Modal>
      )}
    </>
  );
}
