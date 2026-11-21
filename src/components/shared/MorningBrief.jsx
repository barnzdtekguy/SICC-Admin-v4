import { useEffect, useState } from 'react';
import { Link2, AlertTriangle, Cake, Inbox, CheckCircle2, UserPlus, Phone } from 'lucide-react';
import { C } from '../../lib/theme';
import { getBrief, createAttendance } from '../../lib/db';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from './Toast';
import { Btn, Input, Select, Skeleton } from './UI';

const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const first = n => String(n || '').replace(/^(Bishop|Archbishop|Pastor|Pst\.?|Rev\.?|Dr\.?|Mr\.?|Mrs\.?)\s+/i, '').split(' ')[0];
const Tile = ({ icon, value, label, tone = C.info, onClick }) => {
  const Tag = onClick ? 'button' : 'div';
  return <Tag type={onClick ? 'button' : undefined} onClick={onClick} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px', background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, color: '#fff', textAlign: 'left', font: 'inherit' }}>
    <span aria-hidden style={{ width: 38, height: 38, borderRadius: 10, background: `${tone}30`, color: tone, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
    <span><span className="display" style={{ fontSize: 28, lineHeight: 1, display: 'block' }}>{value}</span><span style={{ fontSize: 12, color: 'rgba(255,255,255,.78)' }}>{label}</span></span>
  </Tag>;
};

function QuickAttendance({ brief, onSaved }) {
  const toast = useToast();
  const [service, setService] = useState(''); const [count, setCount] = useState(''); const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const save = async () => {
    setBusy(true);
    const { data, error } = await createAttendance({ service, date: today, count: Number(count) });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(data?.queued ? 'Saved on this phone. It will send when you’re back online.' : `Recorded ${count} for ${service}.`); setCount(''); onSaved?.();
  };
  return (
    <div style={{ background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 14, padding: 14, display: 'grid', gap: 10 }}>
      <div style={{ fontWeight: 600, fontSize: 14, color: '#fff' }}>{brief.recordedThisWeek ? 'Record another service' : 'Record this week’s attendance'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr) auto', gap: 10, alignItems: 'end' }} className="sicc-grid">
        <Select label="" value={service} onChange={setService} options={brief.services?.length ? brief.services : ['Sunday Service', 'Mid-Week Service']} placeholder="Which service?" />
        <Input label="" type="number" value={count} onChange={setCount} placeholder="Count" inputMode="numeric" min={0} />
        <Btn color={C.gold} onClick={save} loading={busy} disabled={!service || count === ''}>Save</Btn>
      </div>
    </div>
  );
}

export default function MorningBrief({ setActiveTab }) {
  const { profile } = useAuth();
  const [b, setB] = useState(null); const [err, setErr] = useState('');
  const load = () => getBrief().then(setB).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  const role = profile.role; const go = k => setActiveTab?.(k);
  const trend = b?.attendanceTrend || b?.recent || [];
  const max = Math.max(1, ...trend.map(t => Number(t.count || 0)));
  const delta = b ? (b.newMembers7d ?? 0) - (b.newMembersPrev7d ?? 0) : 0;

  return (
    <section aria-label="Today at a glance" style={{ position: 'relative', overflow: 'hidden', borderRadius: 20, padding: 'clamp(18px, 3vw, 28px)', marginBottom: 22, color: '#fff', background: 'linear-gradient(135deg, #0C1B3A 0%, #162847 60%, #1d3358 100%)', boxShadow: 'var(--shadow-2)' }}>
      <div aria-hidden style={{ position: 'absolute', right: -60, top: -60, width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle, rgba(201,168,76,.28), transparent 70%)' }} />
      <div style={{ position: 'relative', display: 'grid', gap: 16 }}>
        <div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.78)' }}>{new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h2 className="display" style={{ fontSize: 'clamp(28px, 4vw, 38px)', lineHeight: 1.1, color: '#fff' }}>{greet()}, {first(profile.name)}.</h2>
        </div>
        {err && <div role="alert" style={{ fontSize: 13, color: '#FFD2D2' }}>{err}</div>}
        {!b && !err && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>{[0, 1, 2, 3].map(i => <Skeleton key={i} h={64} style={{ borderRadius: 14 }} />)}</div>}

        {b && ['bishop', 'admin'].includes(role) && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
              <Tile icon={<UserPlus size={18} />} value={b.newMembers7d} label={`new members this week${delta ? ` (${delta > 0 ? '+' : ''}${delta} vs last)` : ''}`} tone={C.gold} onClick={() => go('members')} />
              <Tile icon={<Inbox size={18} />} value={b.pendingApprovals} label="awaiting your approval" tone={b.pendingApprovals ? '#FFA040' : '#66BB6A'} onClick={() => go('approvals')} />
              <Tile icon={<Phone size={18} />} value={b.overdueFollowUps} label="follow-ups overdue (7+ days)" tone={b.overdueFollowUps ? '#EF7B7B' : '#66BB6A'} onClick={() => go(role === 'admin' ? 'followups' : 'followups')} />
              <Tile icon={<Cake size={18} />} value={b.birthdaysToday} label="birthdays today" tone="#C58AE0" />
              <Tile icon={<AlertTriangle size={18} />} value={b.unverifiedAttendance} label="attendance records unverified" tone={b.unverifiedAttendance ? '#FFA040' : '#66BB6A'} onClick={() => go(role === 'admin' ? 'attendance' : 'reports')} />
            </div>
            {trend.length > 0 && <div><div style={{ fontSize: 12, color: 'rgba(255,255,255,.78)', marginBottom: 6 }}>Last {trend.length} services</div>
              <div role="img" aria-label={`Attendance trend: ${trend.map(t => t.count).join(', ')}`} style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 64 }}>{trend.map((t, i) => <div key={i} title={`${t.service} ${t.date}: ${t.count}`} style={{ flex: 1, height: `${Math.max(8, (Number(t.count) / max) * 100)}%`, background: i === trend.length - 1 ? C.gold : 'rgba(255,255,255,.35)', borderRadius: '6px 6px 2px 2px' }} />)}</div></div>}
          </>
        )}

        {b && role === 'pastor' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
              <Tile icon={<UserPlus size={18} />} value={b.myMembers} label="people in your care" tone={C.gold} onClick={() => go('myMembers')} />
              <Tile icon={<AlertTriangle size={18} />} value={b.overdue.length} label="follow-ups overdue" tone={b.overdue.length ? '#EF7B7B' : '#66BB6A'} onClick={() => go('followup')} />
              <Tile icon={<Phone size={18} />} value={b.needsContact.length} label="not contacted in 14 days" tone={b.needsContact.length ? '#FFA040' : '#66BB6A'} onClick={() => go('followup')} />
              <Tile icon={<Cake size={18} />} value={b.birthdays.length} label="birthdays today" tone="#C58AE0" />
            </div>
            {b.needsContact.length > 0 && <div style={{ fontSize: 13, color: 'rgba(255,255,255,.88)' }}><strong>Reach out today:</strong> {b.needsContact.slice(0, 5).map(m => `${m.first_name} ${m.last_name}`).join(', ')}{b.needsContact.length > 5 ? ` and ${b.needsContact.length - 5} more` : ''}.</div>}
            {b.birthdays.length > 0 && <div style={{ fontSize: 13, color: 'rgba(255,255,255,.88)' }}><strong>Birthdays:</strong> {b.birthdays.map(m => `${m.first_name} ${m.last_name}`).join(', ')}.</div>}
          </>
        )}

        {b && role === 'kdf_coordinator' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
            <Tile icon={<UserPlus size={18} />} value={b.members} label={`members in ${b.area || 'your area'}`} tone={C.gold} onClick={() => go('kdfMembers')} />
            <Tile icon={<UserPlus size={18} />} value={b.newConverts} label="new converts" tone="#6CB0F0" />
            <Tile icon={<CheckCircle2 size={18} />} value={`${b.coveragePct}%`} label="followed up in last 30 days" tone={b.coveragePct >= 70 ? '#66BB6A' : '#FFA040'} onClick={() => go('followup')} />
            <Tile icon={<AlertTriangle size={18} />} value={b.overdueFollowUps} label="follow-ups overdue" tone={b.overdueFollowUps ? '#EF7B7B' : '#66BB6A'} />
          </div>
        )}

        {b && role === 'department_leader' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
              <Tile icon={<CheckCircle2 size={18} />} value={b.recordedThisWeek ? 'Done' : 'Due'} label={b.recordedThisWeek ? 'attendance recorded this week' : 'attendance not yet recorded'} tone={b.recordedThisWeek ? '#66BB6A' : '#FFA040'} />
              <Tile icon={<UserPlus size={18} />} value={b.members} label={`members in ${b.department || 'your department'}`} tone={C.gold} onClick={() => go('deptMembers')} />
              {trend.length > 0 && <Tile icon={<Link2 size={18} />} value={trend[trend.length - 1].dept_count ?? trend[trend.length - 1].count} label={`last: ${trend[trend.length - 1].service}`} />}
            </div>
            <QuickAttendance brief={b} onSaved={load} />
          </>
        )}
      </div>
    </section>
  );
}
