// src/components/bishop/BishopDashboard.jsx
import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import RoleHome, { attendanceBars, useHomeData } from '../shared/RoleHome';
import { StatCard, Panel, Badge, DataTable, Btn, Modal, Textarea, Input, Select, Grid, SearchInput, C, Alert, Avatar, InfoRow, StatusBadge, SectionTitle, FilterSelect, EmptyState } from '../shared/UI';
import { getMembers, getProfiles, getFollowUps, getAttendance, getLogs, getAssignments, createAssignment, updateAssignment, deleteAssignment, getMessageStatus, sendSms, getBrief } from '../../lib/db';
import { DEPARTMENTS, KDF_AREAS, ROLES, ROLE_COLORS, ROLE_LABELS } from '../../data/constants';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from 'recharts';
import { Users, Star, UserCheck, MapPin, Building2, CheckSquare, TrendingUp, Phone, ClipboardList, BarChart2, Calendar, MessageSquare, Activity, Briefcase, Bell, Clock, Heart, Send, Inbox, QrCode } from 'lucide-react';

import ProgrammeAttendance from '../pastor/ProgrammeAttendance';
import { UserManagement } from '../admin/AdminDashboard';

export default function BishopDashboard({ activeTab, setActiveTab }) {
  const map = { overview: Overview, users: UserManagement, growth: Growth, staff: StaffMonitor, kdf: KDFView, departments: DeptView, followups: FollowUps, programmes: ProgrammeAttendance, communication: Communication, reports: Reports, assignments: Assignments };
  const Comp = map[activeTab] || Overview;
  return <Comp setActiveTab={setActiveTab} />;
}

const loadHome = () => ({ brief: getBrief() });

function Overview() {
  const { data, reload } = useHomeData(loadHome, 30000);
  const brief = data?.brief;
  const latest = brief?.attendanceTrend?.at(-1);
  const attention = [
    { title: 'Pending approvals', value: brief?.pendingApprovals, to: '/app/approvals', Icon: Inbox },
    { title: 'Overdue follow-ups', value: brief?.overdueFollowUps, to: '/app/followups', Icon: Phone },
    { title: 'Unverified attendance', value: brief?.unverifiedAttendance, to: '/app/reports', Icon: CheckSquare },
  ].filter(row => row.value > 0).map(row => ({ ...row, detail: `${row.value} to review` }));
  return (
    <RoleHome
      hero={{ label: 'Latest service attendance', value: latest?.count,
        note: latest?.service || (data ? 'No service recorded yet' : 'Loading attendance…'),
        action: { label: 'View history', to: '/app/reports', Icon: BarChart2 } }}
      stats={[
        { label: 'Church Members', value: brief?.churchMembers, to: '/app/members' },
        { label: 'Operation R.E.D.', value: brief?.redSouls, to: '/app/red', note: 'Souls recorded' },
        { label: 'New members this week', value: brief?.newMembers7d, to: '/app/growth' },
        { label: 'Follow-ups this week', value: brief?.followUps7d, to: '/app/followups' },
        { label: 'Pending approvals', value: brief?.pendingApprovals, to: '/app/approvals' },
        { label: 'Birthdays today', value: brief?.birthdaysToday, to: '/app/members/birthdays' },
      ]}
      chart={{ title: 'Recent service attendance', bars: attendanceBars(brief?.attendanceTrend), to: '/app/reports', unit: 'attendees' }}
      attention={{ rows: attention, to: '/app/approvals', empty: brief ? undefined : 'Review items are unavailable.' }}
      shortcuts={[
        { label: 'Members', to: '/app/members', Icon: Users },
        { label: 'Attendance', to: '/app/programmes', Icon: QrCode },
        { label: 'Follow-ups', to: '/app/followups', Icon: Phone },
        { label: 'Messages', to: '/app/communication', Icon: MessageSquare },
      ]}
      loading={!data} error={data?.error} onRetry={reload}
    />
  );
}



function Growth() {
  const [members, setMembers] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [chart, setChart] = useState('attendance');
  useEffect(() => { Promise.all([getMembers(), getAttendance()]).then(([m, a]) => { setMembers(m); setAttendance(a); }); }, []);
  const deptData = DEPARTMENTS.map(d => ({ name: d.name.split(' ')[0], members: members.filter(m => m.department === d.name).length }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Grid cols="repeat(auto-fit, minmax(160px, 1fr))">
        <StatCard label="Total members" value={members.length} icon={<Users size={18} />} color={C.gold} />
        <StatCard label="New converts" value={members.filter(m => m.status === 'New Convert').length} icon={<TrendingUp size={18} />} color={C.blue} />
        <StatCard label="Active members" value={members.filter(m => m.status === 'Active Member').length} icon={<CheckSquare size={18} />} color={C.success} />
        <StatCard label="Workers" value={members.filter(m => m.status === 'Worker').length} icon={<Briefcase size={18} />} color={C.gold} />
        <StatCard label="Services recorded" value={attendance.length} icon={<Calendar size={18} />} color={C.purple} />
        <StatCard label="Average attendance" value={attendance.length ? Math.round(attendance.reduce((a, b) => a + b.count, 0) / attendance.length) : 'N/A'} icon={<Activity size={18} />} color={C.danger} />
      </Grid>
      <Panel title={chart === 'attendance' ? 'Attendance history' : 'Members by department'}
        action={<FilterSelect placeholder="Chart" value={chart} onChange={value => setChart(value || 'attendance')}
          options={[{ value: 'attendance', label: 'Attendance history' }, { value: 'members', label: 'Members by department' }]} />}>
        {chart === 'attendance' ? (attendance.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={[...attendance].reverse()}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="date" tick={{ fill: C.textMuted, fontSize: 10 }} tickFormatter={d => d?.slice(5)} />
                <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} />
                <Tooltip contentStyle={{ background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="count" stroke="var(--accent-chart)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
        ) : <EmptyState icon={<BarChart2 size={32} color={C.textMuted} />} title="No attendance records yet" />) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={deptData}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="name" tick={{ fill: C.textMuted, fontSize: 10 }} />
              <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} />
              <Tooltip contentStyle={{ background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="members" fill="var(--accent-chart)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Panel>
    </div>
  );
}

function StaffMonitor() {
  const [profiles, setProfiles] = useState([]);
  const [logs, setLogs] = useState([]);
  const [members, setMembers] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  useEffect(() => { Promise.all([getProfiles(), getLogs(100), getMembers(), getFollowUps()]).then(([p, l, m, f]) => { setProfiles(p); setLogs(l); setMembers(m); setFollowUps(f); }); }, []);
  const staff = profiles.filter(p => p.role !== ROLES.BISHOP);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Alert type="info" message="All staff activities are tracked here for full accountability across every level of the church." />
      <div className="sicc-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
        {staff.length === 0 && <EmptyState icon={<Users size={32} color={C.textMuted} />} title="No staff yet" description="Admin creates staff accounts in User Management." />}
        {staff.map(s => {
          const color = ROLE_COLORS[s.role] || C.blue;
          const staffLogs = logs.filter(l => l.user_id === s.id).slice(0, 3);
          const regCount = members.filter(m => m.registered_by === s.id).length;
          const fuCount = followUps.filter(f => f.pastor_id === s.id).length;
          return (
            <Panel key={s.id} style={{ borderLeft: `3px solid ${color}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <Avatar initials={s.avatar} color={color} size={44} />
                <div>
                  <div style={{ fontWeight: 500, fontSize: 14, color: C.textPrimary }}>{s.name}</div>
                  <Badge label={ROLE_LABELS[s.role]} color={color} />
                </div>
              </div>
              {s.role === ROLES.PASTOR && (
                <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                  <div style={{ flex: 1, background: C.pageBg, borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 500, color: C.gold }}>{regCount}</div>
                    <div style={{ fontSize: 10, color: C.textMuted }}>Registered</div>
                  </div>
                  <div style={{ flex: 1, background: C.pageBg, borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 500, color: C.blue }}>{fuCount}</div>
                    <div style={{ fontSize: 10, color: C.textMuted }}>Follow-Ups</div>
                  </div>
                </div>
              )}
              {s.department && <InfoRow icon={<Building2 size={13} />} label="Department" value={s.department} />}
              {s.kdf_area && <InfoRow icon={<MapPin size={13} />} label="KDF area" value={s.kdf_area} />}
              <div style={{ borderTop: `0.5px solid ${C.border}`, paddingTop: 10, marginTop: 8 }}>
                <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 6 }}>Recent activity</div>
                {staffLogs.length === 0
                  ? <div style={{ fontSize: 12, color: C.textMuted }}>No activity yet.</div>
                  : staffLogs.map((l, i) => <div key={i} style={{ fontSize: 12, color: C.textSecondary, padding: '2px 0' }}>• {l.action}: {l.detail}</div>)}
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

function KDFView() {
  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState(null);
  useEffect(() => { getMembers().then(setMembers); }, []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="sicc-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 12 }}>
        {KDF_AREAS.map(k => {
          const count = members.filter(m => m.kdf_area === k.name).length;
          return (
            <div key={k.id} onClick={() => setSelected(k)} style={{ background: C.cardBg, border: `0.5px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', cursor: 'pointer', borderTop: `3px solid ${C.purple}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: C.textPrimary, display: 'flex', alignItems: 'center', gap: 6 }}><MapPin size={13} color={C.purple} /> {k.name}</div>
                <Badge label={count} color={C.purple} />
              </div>
              <div style={{ fontSize: 12, color: C.textSecondary }}><strong style={{ color: k.coordinator ? C.navy : C.danger }}>{k.coordinator || 'No Coordinator'}</strong></div>
              {k.assistantCoordinator && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>Asst: {k.assistantCoordinator}</div>}
            </div>
          );
        })}
      </div>
      {selected && (
        <Modal title={`KDF Area: ${selected.name}`} onClose={() => setSelected(null)}>
          <InfoRow icon={<MapPin size={14} />} label="Area Name" value={selected.name} />
          <InfoRow icon={<UserCheck size={14} />} label="Coordinator" value={selected.coordinator} color={C.gold} />
          <InfoRow icon={<Phone size={14} />} label="Coordinator Phone" value={selected.coordinatorPhone} />
          <InfoRow icon={<Users size={14} />} label="Assistant Coordinator" value={selected.assistantCoordinator} />
          <InfoRow icon={<Phone size={14} />} label="Assistant Phone" value={selected.assistantPhone} />
          <div style={{ marginTop: 14 }}>
            <SectionTitle>Members in This Area</SectionTitle>
            <DataTable columns={[
              { key: 'name', label: 'Name', render: (_, r) => `${r.first_name} ${r.last_name}` },
              { key: 'phone', label: 'Phone' },
              { key: 'status', label: 'Status', render: v => <StatusBadge status={v} /> },
            ]} rows={members.filter(m => m.kdf_area === selected.name)} emptyText="No members in this area yet." />
          </div>
        </Modal>
      )}
    </div>
  );
}

function DeptView() {
  const [members, setMembers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  useEffect(() => { Promise.all([getMembers(), getProfiles()]).then(([m, p]) => { setMembers(m); setProfiles(p); }); }, []);
  return (
    <div className="sicc-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
      {DEPARTMENTS.map(d => {
        const count = members.filter(m => m.department === d.name).length;
        const leader = profiles.find(p => p.role === ROLES.DEPARTMENT_LEADER && p.department === d.name);
        return (
          <Panel key={d.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Building2 size={20} strokeWidth={1.75} color="var(--accent-ink)" aria-hidden="true" />
              <div style={{ fontSize: 14, fontWeight: 500, color: C.textPrimary }}>{d.name}</div>
            </div>
            <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 8, lineHeight: 1.6 }}>
              HODs: <strong style={{ color: C.navy }}>{d.heads.length ? d.heads.join(', ') : 'Not listed'}</strong>
            </div>
            {d.teams?.map(team => (
              <div key={team.name} style={{ fontSize: 11, color: C.textSecondary, marginBottom: 6, lineHeight: 1.5 }}>
                <strong style={{ color: C.navy }}>{team.name}:</strong> {team.heads.join(', ')}
              </div>
            ))}
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 10 }}>
              Portal account: <strong style={{ color: leader ? C.navy : C.textMuted }}>{leader?.name || 'Not assigned'}</strong>
            </div>
            <Badge label={`${count} members`} />
          </Panel>
        );
      })}
    </div>
  );
}

function FollowUps() {
  const [followUps, setFollowUps] = useState([]);
  const [members, setMembers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [search, setSearch] = useState('');
  const [filterPastor, setFilterPastor] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [selected, setSelected] = useState(null);
  useEffect(() => { Promise.all([getFollowUps(), getMembers(), getProfiles()]).then(([f, m, p]) => { setFollowUps(f); setMembers(m); setProfiles(p); }); }, []);
  const pastors = profiles.filter(p => p.role === ROLES.PASTOR);
  const filtered = followUps.filter(f => `${f.member_name} ${f.pastor_name} ${f.notes} ${f.outcome}`.toLowerCase().includes(search.toLowerCase()) && (!filterPastor || f.pastor_name === filterPastor) && (!filterStatus || f.status === filterStatus));
  const byPastor = pastors.map(p => ({ name: p.name, total: followUps.filter(f => f.pastor_id === p.id).length, completed: followUps.filter(f => f.pastor_id === p.id && f.status === 'Completed').length, inProgress: followUps.filter(f => f.pastor_id === p.id && f.status === 'In Progress').length, noResponse: followUps.filter(f => f.pastor_id === p.id && f.status === 'No Response').length }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Grid cols="repeat(auto-fit, minmax(150px, 1fr))">
        <StatCard label="Total Reports" value={followUps.length} icon={<Phone size={18} />} color={C.blue} />
        <StatCard label="Completed" value={followUps.filter(f => f.status === 'Completed').length} icon={<CheckSquare size={18} />} color={C.success} />
        <StatCard label="In progress" value={followUps.filter(f => f.status === 'In Progress').length} icon={<Activity size={18} />} color={C.warning} />
        <StatCard label="No response" value={followUps.filter(f => f.status === 'No Response').length} icon={<MessageSquare size={18} />} color={C.danger} />
      </Grid>
      {byPastor.length > 0 && (
        <Panel title="Pastor Follow-Up Accountability">
          <DataTable columns={[{ key: 'name', label: 'Pastor' }, { key: 'total', label: 'Total', render: v => <Badge label={v} color={C.blue} /> }, { key: 'completed', label: 'Completed', render: v => <Badge label={v} color={C.success} /> }, { key: 'inProgress', label: 'In progress', render: v => <Badge label={v} color={C.warning} /> }, { key: 'noResponse', label: 'No response', render: v => <Badge label={v} color={C.danger} /> }]} rows={byPastor} emptyText="No pastors yet." />
        </Panel>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 200 }}><SearchInput value={search} onChange={setSearch} placeholder="Search member, pastor, notes..." /></div>
        <FilterSelect value={filterPastor} onChange={setFilterPastor} options={pastors.map(p => ({ value: p.name, label: p.name }))} placeholder="All pastors" />
        <FilterSelect value={filterStatus} onChange={setFilterStatus} options={['In Progress', 'Completed', 'No Response'].map(s => ({ value: s, label: s }))} placeholder="All statuses" />
        <Badge label={`${filtered.length} reports`} color={C.gold} />
      </div>
      <Panel title="All Follow-Up Reports">
        <DataTable
          columns={[
            { key: 'member_name', label: 'Member', render: v => <strong style={{ color: C.textPrimary }}>{v}</strong> },
            { key: 'pastor_name', label: 'Pastor' },
            { key: 'date', label: 'Date' },
            { key: 'method', label: 'Method', render: v => v ? <Badge label={v} color={C.blue} /> : 'N/A' },
            { key: 'notes', label: 'Notes', render: v => <span style={{ color: C.textSecondary, fontSize: 12, maxWidth: 200, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span> },
            { key: 'status', label: 'Status', render: v => <StatusBadge status={v} /> },
            { key: 'view', label: '', render: (_, r) => <Btn size="sm" variant="ghost" color={C.gold} onClick={() => setSelected(r)}>View</Btn> },
          ]}
          rows={filtered} emptyText="No follow-up reports submitted yet."
        />
      </Panel>
      {selected && (
        <Modal title="Follow-Up Detail" onClose={() => setSelected(null)}>
          <InfoRow icon={<Users size={14} />} label="Member" value={selected.member_name} color={C.gold} />
          <InfoRow icon={<UserCheck size={14} />} label="Submitted By" value={selected.pastor_name} />
          <InfoRow icon={<Calendar size={14} />} label="Date" value={selected.date} />
          <InfoRow icon={<Phone size={14} />} label="Method" value={selected.method} />
          <InfoRow icon={<Activity size={14} />} label="Status" value={selected.status} />
          <div style={{ marginTop: 14 }}><div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>Notes</div><div style={{ fontSize: 13, color: C.textPrimary, background: C.pageBg, borderRadius: 8, padding: 12, lineHeight: 1.7 }}>{selected.notes}</div></div>
          {selected.outcome && <div style={{ marginTop: 12 }}><div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>Outcome</div><div style={{ fontSize: 13, color: C.textPrimary, background: C.pageBg, borderRadius: 8, padding: 12, lineHeight: 1.7 }}>{selected.outcome}</div></div>}
          {(() => { const m = members.find(m => m.id === selected.member_id); return m ? (<div style={{ marginTop: 14, borderTop: `0.5px solid ${C.border}`, paddingTop: 14 }}><SectionTitle>Member Profile</SectionTitle><InfoRow icon={<MapPin size={13} />} label="KDF area" value={m.kdf_area} color={C.purple} /><InfoRow icon={<Building2 size={13} />} label="Department" value={m.department} /><InfoRow icon={<Star size={13} />} label="Spiritual status" value={m.spiritual_status} /><InfoRow icon={<Phone size={13} />} label="Phone" value={m.phone} /></div>) : null; })()}
        </Modal>
      )}
    </div>
  );
}

function Communication() {
  const [members, setMembers] = useState([]);
  const [status, setStatus] = useState({ sms: false, whatsapp: false });
  const [audience, setAudience] = useState({ kind: 'all', value: '' });
  const [msg, setMsg] = useState('');
  const [alert, setAlert] = useState(null);
  const [sending, setSending] = useState(false);
  useEffect(() => { Promise.all([getMembers(), getMessageStatus()]).then(([m, s]) => { setMembers(m); setStatus(s); }); }, []);

  const withPhone = members.filter(m => m.phone);
  const recipients = audience.kind === 'all' ? withPhone.length : withPhone.filter(m => (audience.kind === 'department' ? m.department : m.kdf_area) === audience.value).length;

  const sendSMS = async () => {
    if (!msg.trim()) return;
    if (!status.sms) { setAlert({ type: 'warning', msg: 'SMS is not set up yet. Ask an Administrator to add the BulkSMSNigeria API key in Settings.' }); return; }
    if (audience.kind !== 'all' && !audience.value) { setAlert({ type: 'warning', msg: 'Choose which department or KDF area should receive this message.' }); return; }
    setSending(true);
    const { data, error } = await sendSms(audience, msg);
    setSending(false);
    setAlert(error ? { type: 'error', msg: error.message } : { type: 'success', msg: `SMS sent to ${data.recipients} members.` });
    if (!error) setMsg('');
    setTimeout(() => setAlert(null), 6000);
  };

  const quickMsgs = [
    { icon: <Bell size={14} />, label: 'Sunday Service Reminder', text: "Dear Salem family, our Sunday service takes place today. We look forward to worshipping with you. Regards, Bishop Enobong Etteh, Salem International Christian Centre." },
    { icon: <Clock size={14} />, label: 'Mid-Week Service', text: "Dear Salem family, please join us for our mid-week service this Wednesday. We look forward to seeing you. Regards, SICC." },
    { icon: <Heart size={14} />, label: 'Prayer Broadcast', text: "Let us pray: The Lord is our strength and shield. May we continue to trust in Him. Regards, Bishop Enobong Etteh, SICC." },
    { icon: <Star size={14} />, label: 'Special Programme', text: "Dear Salem family, please join us for our upcoming special programme. Further details will be shared soon. Regards, SICC." },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {alert && <Alert type={alert.type} message={alert.msg} onDismiss={() => setAlert(null)} />}
      <div className="sicc-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Panel title="SMS Broadcast">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, color: C.textSecondary }}>
              Recipients: <strong style={{ color: C.textPrimary }}>{recipients} members</strong>
              {!status.sms && <span style={{ color: C.danger, marginLeft: 8, fontSize: 12 }}>SMS not set up</span>}
            </div>
            <div className="sicc-grid" style={{ display: 'grid', gridTemplateColumns: audience.kind === 'all' ? '1fr' : '1fr 1fr', gap: 10 }}>
              <Select label="Send to" value={audience.kind} onChange={v => setAudience({ kind: v || 'all', value: '' })} placeholder="All members" options={[{ value: 'all', label: 'All members' }, { value: 'department', label: 'A department' }, { value: 'kdf_area', label: 'A KDF area' }]} />
              {audience.kind === 'department' && <Select label="Department" value={audience.value} onChange={v => setAudience({ ...audience, value: v })} options={DEPARTMENTS.map(d => d.name)} />}
              {audience.kind === 'kdf_area' && <Select label="KDF area" value={audience.value} onChange={v => setAudience({ ...audience, value: v })} options={KDF_AREAS.map(k => k.name)} />}
            </div>
            <Textarea value={msg} onChange={setMsg} placeholder="Type your broadcast message..." rows={5} />
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn onClick={sendSMS} color={C.success} loading={sending} disabled={!msg.trim()}><Send size={14} /> Send SMS</Btn>
              <Btn onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')} color={C.navy} variant="outline"><MessageSquare size={14} /> WhatsApp</Btn>
            </div>
          </div>
        </Panel>
        <Panel title="Quick Message Templates">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {quickMsgs.map((q, i) => (
              <button key={i} onClick={() => setMsg(q.text)} style={{ padding: '11px 14px', background: C.pageBg, border: `1px solid ${C.border}`, borderRadius: 9, color: C.textPrimary, fontSize: 13, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = C.blueLight; e.currentTarget.style.borderColor = C.blue; }}
                onMouseLeave={e => { e.currentTarget.style.background = C.pageBg; e.currentTarget.style.borderColor = C.border; }}>
                <span style={{ color: C.blue, flexShrink: 0 }}>{q.icon}</span>
                <span>{q.label}</span>
              </button>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Reports() {
  const [members, setMembers] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [attendance, setAttendance] = useState([]);
  useEffect(() => { Promise.all([getMembers(), getFollowUps(), getAttendance()]).then(([m, f, a]) => { setMembers(m); setFollowUps(f); setAttendance(a); }); }, []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Grid cols="repeat(auto-fit, minmax(150px, 1fr))">
        <StatCard label="Total members" value={members.length} icon={<ClipboardList size={18} />} color={C.gold} />
        <StatCard label="New converts" value={members.filter(m => m.status === 'New Convert').length} icon={<TrendingUp size={18} />} color={C.blue} />
        <StatCard label="Active members" value={members.filter(m => m.status === 'Active Member').length} icon={<CheckSquare size={18} />} color={C.success} />
        <StatCard label="Workers" value={members.filter(m => m.status === 'Worker').length} icon={<Briefcase size={18} />} color={C.gold} />
        <StatCard label="Follow-Ups" value={followUps.length} icon={<Phone size={18} />} color={C.purple} />
      </Grid>
      <details className="sicc-disclosure"><summary>KDF area breakdown</summary>
        <DataTable columns={[{ key: 'name', label: 'Area' }, { key: 'coordinator', label: 'Coordinator' }, { key: 'count', label: 'Members', render: v => <Badge label={v} color={C.purple} /> }]} rows={KDF_AREAS.map(k => ({ ...k, count: members.filter(m => m.kdf_area === k.name).length }))} />
      </details>
      <Panel title="Attendance records">
        <DataTable columns={[{ key: 'date', label: 'Date' }, { key: 'service', label: 'Service' }, { key: 'count', label: 'Count', render: v => <strong style={{ color: C.navy, fontSize: 15 }}>{v}</strong> }]} rows={attendance} emptyText="No attendance records yet." />
      </Panel>
    </div>
  );
}

function Assignments() {
  const { profile } = useAuth();
  const [assignments, setAssignments] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [form, setForm] = useState({ task: '', assignee: '', priority: 'Normal', due_date: '' });
  const [loading, setLoading] = useState(false);
  useEffect(() => { Promise.all([getAssignments(), getProfiles()]).then(([a, p]) => { setAssignments(a); setProfiles(p); }); }, []);
  const staff = profiles.filter(p => p.role !== ROLES.BISHOP);

  const add = async () => {
    if (!form.task || !form.assignee) return;
    setLoading(true);
    const { data } = await createAssignment({ ...form, created_by: profile.id });
    if (data) setAssignments([data, ...assignments]);
    setForm({ task: '', assignee: '', priority: 'Normal', due_date: '' });
    setLoading(false);
  };
  const complete = async (id) => { const { data } = await updateAssignment(id, { status: 'Completed' }); if (data) setAssignments(assignments.map(a => a.id === id ? data : a)); };
  const remove = async (id) => { await deleteAssignment(id); setAssignments(assignments.filter(a => a.id !== id)); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Panel title="Create Assignment">
        <div className="sicc-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <Input label="Task Description *" value={form.task} onChange={v => setForm({ ...form, task: v })} placeholder="Describe the assignment..." required />
          <Select label="Assign To *" value={form.assignee} onChange={v => setForm({ ...form, assignee: v })} options={staff.map(s => ({ value: s.name, label: s.name }))} required />
          <Select label="Priority" value={form.priority} onChange={v => setForm({ ...form, priority: v })} options={['Normal', 'Urgent', 'High Priority']} />
          <Input label="Due Date" value={form.due_date} onChange={v => setForm({ ...form, due_date: v })} type="date" />
        </div>
        <Btn onClick={add} color={C.navy} disabled={loading || !form.task || !form.assignee}><Pin size={14} /> Create Assignment</Btn>
      </Panel>
      <Panel title="All Assignments">
        <DataTable
          columns={[
            { key: 'task', label: 'Task' },
            { key: 'assignee', label: 'Assigned To' },
            { key: 'priority', label: 'Priority', render: v => <Badge label={v} color={v === 'Urgent' ? C.danger : v === 'High Priority' ? C.gold : C.blue} /> },
            { key: 'due_date', label: 'Due Date', render: v => v || 'N/A' },
            { key: 'status', label: 'Status', render: v => <StatusBadge status={v} /> },
            { key: 'actions', label: '', render: (_, r) => (<div style={{ display: 'flex', gap: 6 }}>{r.status !== 'Completed' && <Btn size="sm" variant="ghost" color={C.success} onClick={() => complete(r.id)}><CheckSquare size={12} /></Btn>}<Btn size="sm" variant="ghost" color={C.danger} onClick={() => remove(r.id)}>Remove</Btn></div>) },
          ]}
          rows={assignments} emptyText="No assignments yet."
        />
      </Panel>
    </div>
  );
}
