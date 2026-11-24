// src/components/admin/AdminDashboard.jsx
import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import RoleHome, { attendanceBars, useHomeData } from '../shared/RoleHome';
import { StatCard, Panel, Badge, DataTable, Btn, Modal, Input, Select, SearchInput, C, Alert, Avatar, InfoRow, StatusBadge, Grid, FilterSelect, EmptyState, ConfirmDialog } from '../shared/UI'
import { useToast } from '../shared/Toast';
import AttendanceHistory from '../shared/AttendanceHistory';
import { getBrief, getMembers, getProfiles, createProfile, updateProfile, resetProfilePassword, resetProfileMfa, unlockProfile, getFollowUps, getAttendance, createAttendance, getLogs, getSMSConfig, saveSMSConfig } from '../../lib/db';
import { DEPARTMENTS, KDF_AREAS, ROLES, ROLE_COLORS, ROLE_LABELS, SERVICE_TYPES } from '../../data/constants';
import { PASSWORD_HINT, validatePassword } from '../../../shared/password-policy.mjs';
import { Users, UserCheck, MapPin, Building2, CheckSquare, TrendingUp, Phone, ClipboardList, BarChart2, Calendar, Activity, Briefcase, MessageSquare, Settings, UserPlus } from 'lucide-react';

import ProgrammeAttendance from '../pastor/ProgrammeAttendance';

export default function AdminDashboard({ activeTab, setActiveTab }) {
  const map = { overview: Overview, users: UserManagement, staff: StaffManagement, departments: DeptMgmt, kdf: KDFMgmt, attendance: Attendance, followups: FollowUps, programmes: ProgrammeAttendance, reports: Reports, settings: Settings_ };
  const Comp = map[activeTab] || Overview;
  return <Comp setActiveTab={setActiveTab} />;
}

const loadHome = () => ({ brief: getBrief(), profiles: getProfiles() });

function Overview() {
  const { data, reload } = useHomeData(loadHome, 30000);
  const { brief, profiles } = data || {};
  const weeklyChange = brief?.newMembersPrev7d == null ? null : brief.newMembers7d - brief.newMembersPrev7d;
  const attention = [
    { title: 'Pending approvals', value: brief?.pendingApprovals, to: '/app/approvals' },
    { title: 'Overdue follow-ups', value: brief?.overdueFollowUps, to: '/app/followups', Icon: Phone },
    { title: 'Unverified attendance', value: brief?.unverifiedAttendance, to: '/app/attendance', Icon: CheckSquare },
  ].filter(row => row.value > 0).map(row => ({ ...row, detail: `${row.value} to review` }));
  const staff = profiles?.filter(profile => [ROLES.PASTOR, ROLES.DEPARTMENT_LEADER, ROLES.KDF_COORDINATOR].includes(profile.role));
  return (
    <RoleHome
      hero={{ label: 'Church Members', value: brief?.churchMembers, to: '/app/members',
        action: { label: 'View members', to: '/app/members', Icon: Users } }}
      stats={[
        { label: 'New members this week', value: brief?.newMembers7d, to: '/app/members', note: weeklyChange ? `${weeklyChange > 0 ? '+' : ''}${weeklyChange} vs last week` : null },
        { label: 'Operation R.E.D.', value: brief?.redSouls, to: '/app/red', note: 'Souls recorded' },
        { label: 'Staff on roster', value: staff?.length, to: '/app/staff' },
        { label: 'Pending approvals', value: brief?.pendingApprovals, to: '/app/approvals' },
        { label: 'Birthdays today', value: brief?.birthdaysToday },
      ]}
      chart={{ title: 'Recent service attendance', bars: attendanceBars(brief?.attendanceTrend), to: '/app/attendance', unit: 'attendees' }}
      attention={{ rows: attention, to: '/app/approvals', empty: brief ? undefined : 'Review items are unavailable.' }}
      shortcuts={[
        { label: 'Members', to: '/app/members', Icon: Users },
        { label: 'Attendance', to: '/app/attendance', Icon: CheckSquare },
        { label: 'Staff', to: '/app/staff', Icon: UserCheck },
        { label: 'Reports', to: '/app/reports', Icon: BarChart2 },
      ]}
      loading={!data} error={data?.error} onRetry={reload}
    />
  );
}



function generatePassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%*?'];
  const all = sets.join('');
  const pick = chars => chars[crypto.getRandomValues(new Uint32Array(1))[0] % chars.length];
  const out = sets.map(pick);
  while (out.length < 16) out.push(pick(all));
  for (let i = out.length - 1; i > 0; i -= 1) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join('');
}

export function UserManagement() {
  const { profile: currentProfile } = useAuth();
  const toast = useToast();
  const isBishop = currentProfile?.role === ROLES.BISHOP;
  const [profiles, setProfiles] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', role: '', department: '', kdfArea: '' });
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [manage, setManage] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [secret, setSecret] = useState(null);
  const load = () => getProfiles().then(setProfiles);
  useEffect(() => { load(); }, []);

  const manageable = r => isBishop || ![ROLES.BISHOP, ROLES.ADMIN].includes(r.role);
  const roleOptions = [
    { value: ROLES.PASTOR, label: 'Pastor' }, { value: ROLES.DEPARTMENT_LEADER, label: 'Department Leader' }, { value: ROLES.KDF_COORDINATOR, label: 'KDF Coordinator' },
    ...(isBishop ? [{ value: ROLES.ADMIN, label: 'Administrator (full access)' }, { value: ROLES.BISHOP, label: 'Bishop (full access)' }] : []),
  ];

  const handleCreate = async () => {
    if (!form.name || !form.role || !form.email || !form.password) { setMsg({ type: 'warning', text: 'Name, email, password and role are all required.' }); return; }
    const problem = validatePassword(form.password);
    if (problem) { setMsg({ type: 'warning', text: problem }); return; }
    setLoading(true);
    const { data, error } = await createProfile({
      name: form.name, email: form.email, phone: form.phone || null, role: form.role,
      department: form.role === ROLES.DEPARTMENT_LEADER ? form.department : null,
      kdf_area: form.role === ROLES.KDF_COORDINATOR ? form.kdfArea : null,
    }, form.password);
    setLoading(false);
    if (error) { setMsg({ type: 'danger', text: error.message }); return; }
    setProfiles(p => [...p, data]);
    setShowModal(false);
    setSecret({ title: `${form.name} was created`, password: form.password, note: 'They will be asked to choose their own password the first time they sign in.' });
    setForm({ name: '', email: '', phone: '', password: '', role: '', department: '', kdfArea: '' });
    setMsg(null);
  };

  const run = async (fn, okText) => {
    const { data, error } = await fn();
    if (error) toast.error(error.message); else { toast.success(okText); load(); }
    return data;
  };

  const actions = r => [
    { label: r.is_active ? 'Deactivate account' : 'Reactivate account', danger: r.is_active, run: () => setConfirm({ title: r.is_active ? `Deactivate ${r.name}?` : `Reactivate ${r.name}?`, message: r.is_active ? 'They are signed out everywhere immediately and cannot sign in. Their history stays attributed to them.' : 'They will be able to sign in again.', danger: r.is_active, confirmLabel: r.is_active ? 'Deactivate' : 'Reactivate', go: () => run(() => updateProfile(r.id, { is_active: !r.is_active }), r.is_active ? 'Account deactivated.' : 'Account reactivated.') }) },
    { label: 'Reset password', run: () => setConfirm({ title: `Reset ${r.name}'s password?`, message: 'A one-time temporary password will be shown to you once. They must replace it at next sign-in and are signed out everywhere now.', confirmLabel: 'Reset password', go: async () => { const d = await run(() => resetProfilePassword(r.id), 'Password reset.'); if (d) setSecret({ title: `Temporary password for ${r.name}`, password: d.temporary_password, note: d.note }); } }) },
    ...(r.mfa_enabled ? [{ label: 'Reset two-step verification', run: () => setConfirm({ title: `Reset two-step verification for ${r.name}?`, message: 'Use this if they lost their phone and recovery codes. They will have to set it up again.', confirmLabel: 'Reset', go: () => run(() => resetProfileMfa(r.id), 'Two-step verification reset.') }) }] : []),
    { label: 'Unlock sign-in', run: () => run(() => unlockProfile(r.id), 'Account unlocked.') },
  ];

  const displayProfiles = profiles.filter(p => isBishop || p.role !== ROLES.BISHOP);
  const lastSeen = v => (v ? new Date(`${v.replace(' ', 'T')}Z`).toLocaleDateString('en-NG', { dateStyle: 'medium' }) : 'Never');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        {msg && <div style={{ flex: 1 }}><Alert type={msg.type} message={msg.text} onDismiss={() => setMsg(null)} /></div>}
        <div style={{ marginLeft: 'auto' }}><Btn onClick={() => setShowModal(true)} color={C.navy}><UserPlus size={15} /> Create New User</Btn></div>
      </div>
      <Panel>
        <DataTable exportName="staff-accounts" caption="Staff accounts"
          columns={[
            { key: 'avatar', label: '', sortable: false, render: (v, r) => <Avatar initials={v} color={ROLE_COLORS[r.role] || C.blue} size={34} /> },
            { key: 'name', label: 'Full Name', render: (v, r) => <div><strong style={{ color: C.textPrimary }}>{v}</strong>{!r.is_active && <div><Badge label="Deactivated" color={C.danger} /></div>}</div> },
            { key: 'role', label: 'Role', render: v => <Badge label={ROLE_LABELS[v] || v} color={ROLE_COLORS[v] || C.blue} /> },
            { key: 'email', label: 'Email', render: v => v || 'N/A' },
            { key: 'department', label: 'Dept / Area', render: (v, r) => v || r.kdf_area || 'N/A' },
            { key: 'mfa_enabled', label: '2-step', render: v => <Badge label={v ? 'On' : 'Off'} color={v ? C.success : C.warning} /> },
            { key: 'last_login_at', label: 'Last sign-in', render: v => lastSeen(v) },
            { key: 'actions', label: '', render: (_, r) => r.id === currentProfile?.id ? <span style={{ fontSize: 12, color: C.textMuted }}>You</span> : manageable(r) ? <Btn size="sm" variant="ghost" color={C.info} onClick={() => setManage(r)}>Manage</Btn> : <span style={{ fontSize: 12, color: C.textMuted }}>Bishop only</span> },
          ]}
          rows={displayProfiles} emptyText="No staff created yet." />
      </Panel>

      {showModal && (
        <Modal title="Create Staff Account" onClose={() => { setShowModal(false); setMsg(null); }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Input label="Full Name" value={form.name} onChange={v => setForm({ ...form, name: v })} placeholder="e.g. Pastor John Adeyemi" required />
            <Input label="Email Address" value={form.email} onChange={v => setForm({ ...form, email: v })} type="email" placeholder="pastor@sicc.org" required />
            <Input label="Phone number" value={form.phone} onChange={v => setForm({ ...form, phone: v })} placeholder="08XXXXXXXXX" />
            <div>
              <Input label="Temporary password" value={form.password} onChange={v => setForm({ ...form, password: v })} type="text" hint={`${PASSWORD_HINT} Share it privately. They'll replace it at first sign-in.`} required />
              <div style={{ marginTop: 6 }}><Btn size="sm" variant="ghost" color={C.info} onClick={() => setForm({ ...form, password: generatePassword() })}>Generate a strong one</Btn></div>
            </div>
            <Select label="Role" value={form.role} onChange={v => setForm({ ...form, role: v, department: '', kdfArea: '' })} options={roleOptions} required hint={isBishop ? undefined : 'Only the Bishop can create Administrator or Bishop accounts.'} />
            {form.role === ROLES.DEPARTMENT_LEADER && <Select label="Assign Department" value={form.department} onChange={v => setForm({ ...form, department: v })} options={DEPARTMENTS.map(d => ({ value: d.name, label: d.name }))} />}
            {form.role === ROLES.KDF_COORDINATOR && <Select label="Assign KDF Area" value={form.kdfArea} onChange={v => setForm({ ...form, kdfArea: v })} options={KDF_AREAS.map(k => ({ value: k.name, label: k.name }))} />}
            {msg && <Alert type={msg.type} message={msg.text} />}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
              <Btn variant="outline" color={C.textSecondary} onClick={() => setShowModal(false)}>Cancel</Btn>
              <Btn onClick={handleCreate} color={C.navy} loading={loading}>Create account</Btn>
            </div>
          </div>
        </Modal>
      )}

      {manage && (
        <Modal title={manage.name} onClose={() => setManage(null)} width={440}>
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 6 }}>{ROLE_LABELS[manage.role]} · {manage.email}</div>
            {actions(manage).map(a => <Btn key={a.label} variant="outline" color={a.danger ? C.danger : C.textPrimary} full onClick={() => { setManage(null); a.run(); }}>{a.label}</Btn>)}
          </div>
        </Modal>
      )}
      {confirm && <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} onConfirm={async () => { const c = confirm; setConfirm(null); await c.go(); }} />}
      {secret && (
        <Modal title={secret.title} onClose={() => setSecret(null)} width={460}>
          <p style={{ fontSize: 13, color: C.textSecondary, marginBottom: 12 }}>{secret.note}</p>
          <code style={{ display: 'block', fontSize: 20, letterSpacing: 1, padding: 14, background: C.inputBg, border: `1px dashed ${C.borderStrong}`, borderRadius: 10, textAlign: 'center', color: C.textPrimary, userSelect: 'all', wordBreak: 'break-all' }}>{secret.password}</code>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
            <Btn variant="outline" color={C.textSecondary} onClick={() => navigator.clipboard?.writeText(secret.password).then(() => toast.info('Copied'))}>Copy</Btn>
            <Btn color={C.navy} onClick={() => setSecret(null)}>I’ve shared it</Btn>
          </div>
          <p style={{ fontSize: 12, color: C.textMuted, marginTop: 10 }}>This is shown only once and is not stored anywhere you can read it later.</p>
        </Modal>
      )}
    </div>
  );
}

function StaffManagement() {
  const [profiles, setProfiles] = useState([]);
  const [logs, setLogs] = useState([]);
  const [members, setMembers] = useState([]);
  useEffect(() => { Promise.all([getProfiles(), getLogs(100), getMembers()]).then(([p, l, m]) => { setProfiles(p); setLogs(l); setMembers(m); }); }, []);
  const staff = profiles.filter(p => p.role !== ROLES.BISHOP);
  return (
    <div className="sicc-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
      {staff.length === 0 && <EmptyState icon={<Users size={32} color={C.textMuted} />} title="No staff yet" description="Create users in User Management." />}
      {staff.map(s => {
        const color = ROLE_COLORS[s.role] || C.blue;
        const staffLogs = logs.filter(l => l.user_id === s.id);
        const regCount = members.filter(m => m.registered_by === s.id).length;
        return (
          <Panel key={s.id} style={{ borderLeft: `3px solid ${color}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <Avatar initials={s.avatar} color={color} size={42} />
              <div><div style={{ fontWeight: 500, fontSize: 14, color: C.textPrimary }}>{s.name}</div><Badge label={ROLE_LABELS[s.role]} color={color} /></div>
            </div>
            <InfoRow icon={<span style={{ fontSize: 12 }}>@</span>} label="Email" value={s.email} />
            <InfoRow icon={<Phone size={13} />} label="Phone" value={s.phone} />
            {s.department && <InfoRow icon={<Building2 size={13} />} label="Department" value={s.department} />}
            {s.kdf_area && <InfoRow icon={<MapPin size={13} />} label="KDF area" value={s.kdf_area} />}
            {s.role === ROLES.PASTOR && <InfoRow icon={<ClipboardList size={13} />} label="Members registered" value={regCount} color={C.gold} />}
            <div style={{ borderTop: `0.5px solid ${C.border}`, paddingTop: 10, marginTop: 8 }}>
              <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 6 }}>Activity log</div>
              {staffLogs.length === 0 ? <div style={{ fontSize: 12, color: C.textMuted }}>No activity yet.</div>
                : staffLogs.slice(0, 3).map((l, i) => <div key={i} style={{ fontSize: 12, color: C.textSecondary, padding: '2px 0' }}>• {l.action}: {l.detail}</div>)}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

function DeptMgmt() {
  const [members, setMembers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  useEffect(() => { Promise.all([getMembers(), getProfiles()]).then(([m, p]) => { setMembers(m); setProfiles(p); }); }, []);
  return (
    <div className="sicc-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12 }}>
      {DEPARTMENTS.map(d => {
        const count = members.filter(m => m.department === d.name).length;
        const leader = profiles.find(p => p.role === ROLES.DEPARTMENT_LEADER && p.department === d.name);
        return (
          <Panel key={d.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><Building2 size={20} strokeWidth={1.75} color="var(--accent-ink)" aria-hidden="true" /><div style={{ fontSize: 14, fontWeight: 500, color: C.textPrimary }}>{d.name}</div></div>
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

function KDFMgmt() {
  const [members, setMembers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [selected, setSelected] = useState(null);
  useEffect(() => { Promise.all([getMembers(), getProfiles()]).then(([m, p]) => { setMembers(m); setProfiles(p); }); }, []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Alert type="info" message={`All ${KDF_AREAS.length} KDF areas loaded from the 2026 official document. Auto-KDF assignment is active.`} />
      <div className="sicc-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 12 }}>
        {KDF_AREAS.map(k => {
          const count = members.filter(m => m.kdf_area === k.name).length;
          const appCoord = profiles.find(p => p.role === ROLES.KDF_COORDINATOR && p.kdf_area === k.name);
          return (
            <div key={k.id} onClick={() => setSelected(k)} style={{ background: C.cardBg, border: `0.5px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', cursor: 'pointer', borderTop: `3px solid ${C.purple}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: C.textPrimary, display: 'flex', alignItems: 'center', gap: 6 }}><MapPin size={13} color={C.purple} />{k.name}</div>
                <Badge label={count} color={C.purple} />
              </div>
              <div style={{ fontSize: 12, color: C.textSecondary }}><strong style={{ color: k.coordinator ? C.navy : C.danger }}>{k.coordinator || 'No Coordinator'}</strong></div>
              {k.assistantCoordinator && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>Asst: {k.assistantCoordinator}</div>}
              {appCoord && <div style={{ fontSize: 11, color: C.success, marginTop: 4 }}>App login: {appCoord.name}</div>}
            </div>
          );
        })}
      </div>
      {selected && (
        <Modal title={`KDF: ${selected.name}`} onClose={() => setSelected(null)}>
          <InfoRow icon={<MapPin size={14} />} label="Area" value={selected.name} />
          <InfoRow icon={<UserCheck size={14} />} label="Coordinator" value={selected.coordinator} color={C.gold} />
          <InfoRow icon={<Phone size={14} />} label="Phone" value={selected.coordinatorPhone} />
          <InfoRow icon={<Users size={14} />} label="Asst. Coordinator" value={selected.assistantCoordinator} />
          <InfoRow icon={<Phone size={14} />} label="Asst. Phone" value={selected.assistantPhone} />
        </Modal>
      )}
    </div>
  );
}

function Attendance() {
  const { profile } = useAuth();
  const [records, setRecords] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), service: 'Sunday Service', count: '' });
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const reload = () => getAttendance().then(setRecords);
  useEffect(() => { reload(); }, []);
  const handleAdd = async () => {
    if (!form.date || !form.count) return;
    setSaving(true);
    const { data, error } = await createAttendance({ ...form, count: Number(form.count) });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(data?.queued ? 'Saved on this phone. It will send when you are back online.' : 'Attendance recorded.');
    if (!data?.queued) setRecords([data, ...records]);
    setShowModal(false); setForm({ date: new Date().toISOString().slice(0, 10), service: 'Sunday Service', count: '' });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <Grid cols="repeat(3, 1fr)" gap={12}>
          <StatCard label="Last Service" value={records[0]?.count ?? 'N/A'} icon={<CheckSquare size={18} />} color={C.blue} sub={records[0]?.service} />
          <StatCard label="Services Logged" value={records.length} icon={<Calendar size={18} />} color={C.gold} />
          <StatCard label="Average" value={records.length ? Math.round(records.reduce((a, b) => a + b.count, 0) / records.length) : 'N/A'} icon={<Activity size={18} />} color={C.success} />
        </Grid>
        <Btn onClick={() => setShowModal(true)} color={C.navy}><CheckSquare size={14} /> Record Attendance</Btn>
      </div>
      <Panel title="Attendance history">
        <AttendanceHistory records={records} reload={reload} showDept />
      </Panel>
      {showModal && (
        <Modal title="Record Attendance" onClose={() => setShowModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Input label="Date" value={form.date} onChange={v => setForm({ ...form, date: v })} type="date" required />
            <Select label="Service type" value={form.service} onChange={v => setForm({ ...form, service: v })} options={SERVICE_TYPES} />
            <Input label="Total Count" value={form.count} onChange={v => setForm({ ...form, count: v })} type="number" placeholder="Total people present" required />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Btn variant="outline" color={C.textSecondary} onClick={() => setShowModal(false)}>Cancel</Btn>
              <Btn onClick={handleAdd} color={C.navy} disabled={!form.count} loading={saving}>Save</Btn>
            </div>
          </div>
        </Modal>
      )}
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
  const filtered = followUps.filter(f => `${f.member_name} ${f.pastor_name} ${f.notes}`.toLowerCase().includes(search.toLowerCase()) && (!filterPastor || f.pastor_name === filterPastor) && (!filterStatus || f.status === filterStatus));
  const byPastor = pastors.map(p => ({ name: p.name, total: followUps.filter(f => f.pastor_id === p.id).length, completed: followUps.filter(f => f.pastor_id === p.id && f.status === 'Completed').length, inProgress: followUps.filter(f => f.pastor_id === p.id && f.status === 'In Progress').length }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Grid cols="repeat(auto-fit, minmax(150px, 1fr))">
        <StatCard label="Total Reports" value={followUps.length} icon={<Phone size={18} />} color={C.blue} />
        <StatCard label="Completed" value={followUps.filter(f => f.status === 'Completed').length} icon={<CheckSquare size={18} />} color={C.success} />
        <StatCard label="In progress" value={followUps.filter(f => f.status === 'In Progress').length} icon={<Activity size={18} />} color={C.warning} />
        <StatCard label="No response" value={followUps.filter(f => f.status === 'No Response').length} icon={<MessageSquare size={18} />} color={C.danger} />
      </Grid>
      {byPastor.length > 0 && <details className="sicc-disclosure"><summary>Pastor accountability</summary><DataTable columns={[{ key: 'name', label: 'Pastor' }, { key: 'total', label: 'Total', render: v => <Badge label={v} color={C.blue} /> }, { key: 'completed', label: 'Completed', render: v => <Badge label={v} color={C.success} /> }, { key: 'inProgress', label: 'In progress', render: v => <Badge label={v} color={C.warning} /> }]} rows={byPastor} emptyText="No pastors yet." /></details>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 200 }}><SearchInput value={search} onChange={setSearch} placeholder="Search member, pastor, notes..." /></div>
        <FilterSelect value={filterPastor} onChange={setFilterPastor} options={pastors.map(p => ({ value: p.name, label: p.name }))} placeholder="All pastors" />
        <FilterSelect value={filterStatus} onChange={setFilterStatus} options={['In Progress', 'Completed', 'No Response'].map(s => ({ value: s, label: s }))} placeholder="All statuses" />
        <Badge label={`${filtered.length}`} color={C.gold} />
      </div>
      <Panel title="All Follow-Up Reports">
        <DataTable columns={[
          { key: 'member_name', label: 'Member', render: v => <strong style={{ color: C.textPrimary }}>{v}</strong> },
          { key: 'pastor_name', label: 'Pastor' },
          { key: 'date', label: 'Date' },
          { key: 'method', label: 'Method', render: v => v ? <Badge label={v} color={C.blue} /> : 'N/A' },
          { key: 'notes', label: 'Notes', render: v => <span style={{ color: C.textSecondary, fontSize: 12, maxWidth: 200, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span> },
          { key: 'status', label: 'Status', render: v => <StatusBadge status={v} /> },
          { key: 'view', label: '', render: (_, r) => <Btn size="sm" variant="ghost" color={C.gold} onClick={() => setSelected(r)}>View</Btn> },
        ]} rows={filtered} emptyText="No reports yet." />
      </Panel>
      {selected && (
        <Modal title="Follow-Up Detail" onClose={() => setSelected(null)}>
          <InfoRow icon={<Users size={14} />} label="Member" value={selected.member_name} color={C.gold} />
          <InfoRow icon={<UserCheck size={14} />} label="Submitted By" value={selected.pastor_name} />
          <InfoRow icon={<Calendar size={14} />} label="Date" value={selected.date} />
          <InfoRow icon={<Phone size={14} />} label="Method" value={selected.method} />
          <InfoRow icon={<Activity size={14} />} label="Status" value={selected.status} />
          <div style={{ marginTop: 14 }}><div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>Notes</div><div style={{ fontSize: 13, background: C.pageBg, borderRadius: 8, padding: 12, lineHeight: 1.7 }}>{selected.notes}</div></div>
          {selected.outcome && <div style={{ marginTop: 12 }}><div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>Outcome</div><div style={{ fontSize: 13, background: C.pageBg, borderRadius: 8, padding: 12, lineHeight: 1.7 }}>{selected.outcome}</div></div>}
        </Modal>
      )}
    </div>
  );
}

function Reports() {
  const [members, setMembers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  useEffect(() => { Promise.all([getMembers(), getProfiles(), getFollowUps()]).then(([m, p, f]) => { setMembers(m); setProfiles(p); setFollowUps(f); }); }, []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Grid cols="repeat(auto-fit, minmax(150px, 1fr))">
        <StatCard label="Total members" value={members.length} icon={<ClipboardList size={18} />} color={C.gold} />
        <StatCard label="New converts" value={members.filter(m => m.status === 'New Convert').length} icon={<TrendingUp size={18} />} color={C.blue} />
        <StatCard label="Active members" value={members.filter(m => m.status === 'Active Member').length} icon={<CheckSquare size={18} />} color={C.success} />
        <StatCard label="Workers" value={members.filter(m => m.status === 'Worker').length} icon={<Briefcase size={18} />} color={C.gold} />
        <StatCard label="Follow-Ups" value={followUps.length} icon={<Phone size={18} />} color={C.purple} />
      </Grid>
      <Panel title="Registrations by Pastor">
        <DataTable columns={[{ key: 'name', label: 'Pastor' }, { key: 'count', label: 'Members registered', render: v => <Badge label={v} color={C.success} /> }, { key: 'converts', label: 'New converts', render: v => <Badge label={v} color={C.gold} /> }]} rows={profiles.filter(p => p.role === ROLES.PASTOR).map(p => ({ name: p.name, count: members.filter(m => m.registered_by === p.id).length, converts: members.filter(m => m.registered_by === p.id && m.status === 'New Convert').length }))} emptyText="No pastors yet." />
      </Panel>
      <details className="sicc-disclosure"><summary>KDF area breakdown</summary>
        <DataTable columns={[{ key: 'name', label: 'Area' }, { key: 'coordinator', label: 'Coordinator' }, { key: 'count', label: 'Members', render: v => <Badge label={v} color={C.purple} /> }]} rows={KDF_AREAS.map(k => ({ ...k, count: members.filter(m => m.kdf_area === k.name).length }))} />
      </details>
    </div>
  );
}

function Settings_() {
  const [config, setConfig] = useState({ api_key: '', sender_id: 'SICC', configured: false, api_key_hint: '' });
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => { getSMSConfig().then(c => setConfig({ ...c, api_key: '' })); }, []);
  const handleSave = async () => {
    setLoading(true);
    const { data, error } = await saveSMSConfig({ api_key: config.api_key, sender_id: config.sender_id });
    if (data) setConfig({ ...data, api_key: '' });
    setMsg(error ? { type: 'danger', text: error.message } : { type: 'success', text: 'SMS settings saved. The key is stored encrypted on the server.' });
    setTimeout(() => setMsg(null), 4000);
    setLoading(false);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 560 }}>
      <Panel title="BulkSMSNigeria Configuration">
        <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 16, lineHeight: 1.6 }}>Configure your BulkSMSNigeria.com account. The API key is saved encrypted and is never shown again or sent to anyone’s browser; messages are sent by the server.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Input label="API Token / Key" type="password" autoComplete="off" value={config.api_key || ''} onChange={v => setConfig({ ...config, api_key: v })} placeholder={config.configured ? `Saved (${config.api_key_hint}). Leave blank to keep it` : 'Your BulkSMSNigeria API token'} hint="Found in BulkSMSNigeria → API Settings" />
          <Input label="Sender ID" value={config.sender_id || ''} onChange={v => setConfig({ ...config, sender_id: v })} placeholder="e.g. SICC or Salem" hint="Max 11 letters or numbers. Must be registered with BulkSMSNigeria." />
          {msg && <Alert type={msg.type} message={msg.text} onDismiss={() => setMsg(null)} />}
          <Btn onClick={handleSave} color={C.navy} loading={loading}><Settings size={14} /> Save Settings</Btn>
        </div>
      </Panel>
      <Panel title="System Information">
        <InfoRow icon={<Building2 size={14} />} label="Church Name" value="Salem International Christian Centre" />
        <InfoRow icon={<ClipboardList size={14} />} label="App Name" value="SICC Admin" />
        <InfoRow icon={<MapPin size={14} />} label="KDF Areas" value={`${KDF_AREAS.length} areas loaded`} color={C.gold} />
        <InfoRow icon={<Building2 size={14} />} label="Departments" value={`${DEPARTMENTS.length} departments`} color={C.gold} />
        <InfoRow icon={<Phone size={14} />} label="SMS Provider" value="BulkSMSNigeria.com" />
        <InfoRow icon={<CheckSquare size={14} />} label="Backend" value="Hostinger Node.js + MySQL" color={C.success} />
      </Panel>
    </div>
  );
}
