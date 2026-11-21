import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Download } from 'lucide-react';
import { C } from '../../lib/theme';
import { getAudit, verifyAuditChain } from '../../lib/db';
import { downloadFile } from '../../lib/api';
import { useToast } from '../shared/Toast';
import { Panel, Btn, Input, Select, DataTable, Alert, Badge, PageHeader, Modal } from '../shared/UI';

const when = v => new Date(`${String(v).replace(' ', 'T')}Z`).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'medium' });
const tone = a => (/failed|locked|delete|deactivate|anonymize|reset|reject|tamper/.test(a) ? C.danger : /create|approve|enable|login$/.test(a) ? C.success : /update|correction|verify|export/.test(a) ? C.warning : C.info);

export default function AuditCenter() {
  const toast = useToast();
  const [filters, setFilters] = useState({ q: '', entity_type: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, pageSize: 50 });
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [chain, setChain] = useState(null); const [checking, setChecking] = useState(false);
  const [detail, setDetail] = useState(null);

  const load = useCallback(() => { setLoading(true); getAudit({ ...filters, page, pageSize: 50 }).then(d => { setData(d); setError(''); }).catch(e => setError(e.message)).finally(() => setLoading(false)); }, [filters, page]);
  useEffect(() => { load(); }, [load]);
  const set = k => v => { setPage(1); setFilters(f => ({ ...f, [k]: v })); };

  const verify = async () => { setChecking(true); try { setChain(await verifyAuditChain()); } catch (e) { toast.error(e.message); } finally { setChecking(false); } };
  const open = async row => { try { const d = await getAudit({ entity_id: row.entity_id || undefined, action: row.action, include: 'changes', pageSize: 5 }); setDetail({ row, full: d.items.find(i => i.id === row.id) || row }); } catch { setDetail({ row, full: row }); } };
  const pretty = j => { try { return JSON.stringify(JSON.parse(j), null, 2); } catch { return j; } };
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  const cols = [
    { key: 'created_at', label: 'When', render: (_, r) => <span className="num" style={{ whiteSpace: 'nowrap' }}>{when(r.created_at)}</span> },
    { key: 'user_name', label: 'Who', render: (_, r) => <div><div style={{ fontWeight: 600 }}>{r.user_name || 'System'}</div><div style={{ fontSize: 12, color: C.textMuted }}>{r.role}</div></div> },
    { key: 'action', label: 'Action', render: (_, r) => <Badge label={r.action} color={tone(r.action)} /> },
    { key: 'detail', label: 'Details', sortable: false, render: (_, r) => <span style={{ color: C.textSecondary }}>{r.detail || '–'}</span> },
    { key: 'ip', label: 'IP' },
  ];

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <PageHeader title="Audit trail" subtitle="Every sign-in, change, approval and export, recorded by the server. Entries cannot be edited or deleted."
        action={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Btn variant="outline" color={C.info} loading={checking} onClick={verify}><ShieldCheck size={15} aria-hidden /> Verify integrity</Btn><Btn variant="outline" color={C.textSecondary} onClick={() => downloadFile('/exports/audit.csv').catch(e => toast.error(e.message))}><Download size={15} aria-hidden /> Export CSV</Btn></div>} />
      {chain && (chain.ok
        ? <Alert type="success" message={`The audit trail is intact: ${chain.checked.toLocaleString()} entries checked and none have been altered or removed.`} onDismiss={() => setChain(null)} />
        : <Alert type="error" message={`TAMPERING DETECTED at entry #${chain.firstBadSeq}: ${chain.reason} Contact your developer immediately and keep a copy of the database.`} />)}
      <Panel>
        <div className="sicc-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, alignItems: 'end' }}>
          <Input label="Search" value={filters.q} onChange={set('q')} placeholder="Name, action or detail" />
          <Select label="Record type" value={filters.entity_type} onChange={set('entity_type')} placeholder="All types" options={['member', 'profile', 'attendance', 'programme_record', 'greatness_attendance', 'follow_up', 'programme', 'message', 'sms_config']} />
          <Input label="From" type="date" value={filters.from} onChange={set('from')} />
          <Input label="To" type="date" value={filters.to} onChange={set('to')} />
        </div>
      </Panel>
      {error ? <Alert type="error" message={error} /> : (
        <Panel title={`${data.total.toLocaleString()} entries`}>
          <DataTable columns={cols} rows={data.items} loading={loading} pageSize={0} onRowClick={open} emptyText="No matching activity." caption="Audit trail" />
          {data.total > data.pageSize && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, fontSize: 13, color: C.textSecondary }}>
              <span>Page {page} of {pages}</span>
              <span style={{ display: 'flex', gap: 8 }}><Btn size="sm" variant="outline" color={C.textSecondary} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Btn><Btn size="sm" variant="outline" color={C.textSecondary} disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</Btn></span>
            </div>
          )}
        </Panel>
      )}
      {detail && (
        <Modal title={detail.row.action} onClose={() => setDetail(null)} width={640}>
          <dl style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 12px', fontSize: 13, color: C.textPrimary }}>
            <dt style={{ color: C.textMuted }}>When</dt><dd>{when(detail.row.created_at)}</dd>
            <dt style={{ color: C.textMuted }}>Who</dt><dd>{detail.row.user_name} ({detail.row.role || 'n/a'}) from {detail.row.ip || 'unknown IP'}</dd>
            <dt style={{ color: C.textMuted }}>Record</dt><dd>{detail.row.entity_type || '–'} {detail.row.entity_id || ''}</dd>
            <dt style={{ color: C.textMuted }}>Details</dt><dd>{detail.row.detail || '–'}</dd>
          </dl>
          {(detail.full.before_json || detail.full.after_json) && (
            <div className="sicc-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
              {[['Before', detail.full.before_json, C.dangerBg], ['After', detail.full.after_json, C.successBg]].map(([t, j, bg]) => (
                <div key={t}><div style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 4 }}>{t}</div><pre style={{ background: bg, color: C.textPrimary, padding: 10, borderRadius: 10, fontSize: 12, overflow: 'auto', maxHeight: 260, whiteSpace: 'pre-wrap' }}>{j ? pretty(j) : '–'}</pre></div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
