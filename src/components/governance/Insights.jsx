import { useCallback, useEffect, useState } from 'react';
import { Printer, Download } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line } from 'recharts';
import { C } from '../../lib/theme';
import { getReportOverview, getSubmittedReports } from '../../lib/db';
import { downloadFile } from '../../lib/api';
import { useToast } from '../shared/Toast';
import { Panel, Btn, Input, DataTable, StatCard, Alert, PageHeader, PageSkeleton } from '../shared/UI';

const iso = d => d.toISOString().slice(0, 10);
const presets = [{ l: '30 days', d: 30 }, { l: '90 days', d: 90 }, { l: '12 months', d: 365 }];

export default function Insights() {
  const toast = useToast();
  const [range, setRange] = useState({ from: iso(new Date(Date.now() - 89 * 86400000)), to: iso(new Date()) });
  const [data, setData] = useState(null); const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState([]);
  useEffect(() => { getSubmittedReports().then(setSubmitted).catch(() => {}); }, []);
  const load = useCallback(() => { setData(null); getReportOverview(range).then(setData).catch(e => setError(e.message)); }, [range]);
  useEffect(() => { load(); }, [load]);
  const sum = (rows, k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
  const tick = { fill: C.textMuted, fontSize: 12 };
  const tip = { background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.textPrimary };
  const exportAtt = () => downloadFile(`/exports/attendance.csv?from=${range.from}&to=${range.to}`).catch(e => toast.error(e.message));
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <PageHeader title="Analytics & exports" subtitle="Attendance, growth and follow-up performance for any period."
        action={<div className="no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Btn variant="outline" color={C.textSecondary} onClick={() => window.print()}><Printer size={15} aria-hidden /> Print / save PDF</Btn><Btn variant="outline" color={C.textSecondary} onClick={exportAtt}><Download size={15} aria-hidden /> Attendance CSV</Btn><Btn variant="outline" color={C.textSecondary} onClick={() => downloadFile('/exports/members.csv').catch(e => toast.error(e.message))}><Download size={15} aria-hidden /> Members CSV</Btn></div>} />
      <Panel>
        <div className="no-print sicc-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, alignItems: 'end' }}>
          <Input label="From" type="date" value={range.from} onChange={v => setRange(r => ({ ...r, from: v }))} />
          <Input label="To" type="date" value={range.to} onChange={v => setRange(r => ({ ...r, to: v }))} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{presets.map(p => <Btn key={p.l} size="sm" variant="ghost" color={C.info} onClick={() => setRange({ from: iso(new Date(Date.now() - (p.d - 1) * 86400000)), to: iso(new Date()) })}>{p.l}</Btn>)}</div>
        </div>
        <p style={{ fontSize: 12, color: C.textMuted, marginTop: 10 }}>Showing {range.from} to {range.to}. Exports are limited to the Bishop and Administrators and every download is recorded in the audit trail.</p>
      </Panel>
      {error ? <Alert type="error" message={error} /> : !data ? <PageSkeleton /> : (
        <>
          <div className="sicc-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            <StatCard label="Church-wide attendance" value={sum(data.byService, 'total').toLocaleString()} sub={`${sum(data.byService, 'sessions')} services`} color={C.info} />
            <StatCard label="Average per service" value={data.byService.length ? Math.round(sum(data.byService, 'total') / Math.max(1, sum(data.byService, 'sessions'))).toLocaleString() : '–'} color={C.success} />
            <StatCard label="New members" value={sum(data.newMembers, 'n')} color={C.gold} />
            <StatCard label="Follow-ups logged" value={sum(data.followUps, 'n')} sub={`${data.followUps.find(f => f.status === 'Completed')?.n || 0} completed`} color={C.purple} />
          </div>
          <Panel title="Weekly attendance">
            {data.weekly.length ? <div role="img" aria-label="Line chart of weekly attendance" style={{ height: 260 }}><ResponsiveContainer><LineChart data={data.weekly.map(w => ({ week: String(w.week_start).slice(5), total: Number(w.total) }))}><CartesianGrid stroke={C.border} vertical={false} /><XAxis dataKey="week" tick={tick} /><YAxis tick={tick} /><Tooltip contentStyle={tip} /><Line type="monotone" dataKey="total" name="Attendance" stroke={C.gold} strokeWidth={3} dot={{ r: 3 }} /></LineChart></ResponsiveContainer></div> : <p style={{ color: C.textMuted, fontSize: 14 }}>No attendance recorded for this period.</p>}
          </Panel>
          <div className="sicc-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 18 }}>
            <Panel title="By service"><DataTable exportName="attendance-by-service" pageSize={10} dense columns={[{ key: 'service', label: 'Service' }, { key: 'sessions', label: 'Sessions' }, { key: 'average', label: 'Average' }, { key: 'total', label: 'Total' }]} rows={data.byService.map((r, i) => ({ id: i, ...r, sessions: Number(r.sessions), average: Number(r.average), total: Number(r.total) }))} emptyText="No data" /></Panel>
            <Panel title="Top departments">
              {data.byDept.length ? <div role="img" aria-label="Bar chart of department attendance" style={{ height: 300 }}><ResponsiveContainer><BarChart data={data.byDept.slice(0, 8).map(d => ({ name: d.department.length > 18 ? `${d.department.slice(0, 17)}…` : d.department, total: Number(d.total) }))} layout="vertical" margin={{ left: 20 }}><CartesianGrid stroke={C.border} horizontal={false} /><XAxis type="number" tick={tick} /><YAxis type="category" dataKey="name" tick={tick} width={120} /><Tooltip contentStyle={tip} /><Bar dataKey="total" name="Attendance" fill={C.info} radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer></div> : <p style={{ color: C.textMuted, fontSize: 14 }}>No department attendance yet.</p>}
            </Panel>
          </div>
          <Panel title="Reports submitted by leaders">
            {submitted.length ? <div style={{ display: 'grid', gap: 12 }}>{submitted.slice(0, 15).map(r => (
              <details key={r.id} style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 14px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14, color: C.textPrimary }}>{r.kind === 'kdf' ? 'KDF area' : 'Department'}: {r.scope || '–'} <span style={{ fontWeight: 400, color: C.textMuted }}>· {r.submitted_by_name} · {String(r.created_at).slice(0, 10)}</span></summary>
                <p style={{ marginTop: 10, whiteSpace: 'pre-wrap', fontSize: 14, color: C.textSecondary, lineHeight: 1.55 }}>{r.body}</p>
              </details>))}</div> : <p style={{ color: C.textMuted, fontSize: 14 }}>No reports submitted yet.</p>}
          </Panel>
        </>
      )}
    </div>
  );
}
