// src/components/department/DeptDashboard.jsx
import { useCallback, useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import RoleHome, { attendanceBars, useHomeData } from '../shared/RoleHome';
import { StatCard, Panel, Badge, DataTable, Btn, Modal, Input, Select, Textarea, SearchInput, C, Alert, Grid, StatusBadge, FilterSelect } from '../shared/UI';
import { getBrief, getMembers, getAttendance, createAttendance, submitReport } from '../../lib/db';
import { useToast } from '../shared/Toast';
import AttendanceHistory from '../shared/AttendanceHistory';
import { DEPARTMENTS, SERVICE_TYPES, MEMBER_STATUSES } from '../../data/constants';
import { Users, CheckSquare, Briefcase, Calendar, Activity } from 'lucide-react';

export default function DeptDashboard({ activeTab }) {
  const map = { overview: Overview, deptMembers: DeptMembers, attendance: DeptAttendance, reports: Reports };
  const Comp = map[activeTab] || Overview;
  return <Comp />;
}

function QuickAttendance({ brief, onSaved, onClose }) {
  const toast = useToast();
  const [service, setService] = useState('');
  const [count, setCount] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async event => {
    event.preventDefault();
    setBusy(true);
    const date = brief?.today || new Date().toISOString().slice(0, 10);
    const { data, error } = await createAttendance({ service, date, count: Number(count) });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(data?.queued ? 'Saved on this phone. It will send when you’re back online.' : `Recorded ${count} for ${service}.`);
    onSaved();
    onClose();
  };
  return (
    <Modal title="Record attendance" onClose={onClose}>
      <form className="role-home-attendance-form" onSubmit={save}>
        <Select label="Service" value={service} onChange={setService} required options={brief?.services?.length ? brief.services : SERVICE_TYPES} />
        <Input label="Attendance count" type="number" value={count} onChange={setCount} inputMode="numeric" min={0} required />
        <Btn type="submit" color={C.gold} loading={busy} disabled={!service || count === ''}>Save attendance</Btn>
      </form>
    </Modal>
  );
}

function Overview() {
  const { profile } = useAuth();
  const department = profile.department;
  const load = useCallback(() => ({ brief: getBrief(), members: getMembers({ department }) }), [department]);
  const { data, reload } = useHomeData(load);
  const [recordOpen, setRecordOpen] = useState(false);
  const { brief, members } = data || {};
  const latest = brief?.recent?.at(-1);
  const openRecord = () => setRecordOpen(true);
  return (
    <RoleHome
      hero={{ label: 'Latest department attendance', value: latest?.dept_count ?? latest?.count,
        note: [department, latest?.service].filter(Boolean).join(' · '),
        action: { label: 'Record attendance', onClick: openRecord, Icon: CheckSquare } }}
      stats={[
        { label: 'Department members', value: brief?.members ?? members?.length, to: '/app/deptMembers' },
        { label: 'Workers', value: members?.filter(member => member.status === 'Worker').length },
        { label: 'Active members', value: members?.filter(member => member.status === 'Active Member').length },
        { label: 'New converts', value: members?.filter(member => member.status === 'New Convert').length },
      ]}
      chart={{ title: 'Recent department attendance', bars: attendanceBars(brief?.recent, { department: true }), to: '/app/attendance', unit: 'attendees' }}
      attention={{ rows: brief?.recordedThisWeek === false ? [
        { title: 'Attendance due', detail: 'This week’s record is still open.', onClick: openRecord, Icon: Calendar },
      ] : [], to: '/app/attendance', empty: brief ? 'Attendance is recorded for this week.' : 'Attendance reminders are unavailable.' }}
      shortcuts={[
        { label: 'Members', to: '/app/deptMembers', Icon: Users },
        { label: 'Attendance', to: '/app/attendance', Icon: CheckSquare },
        { label: 'Reports', to: '/app/reports', Icon: Briefcase },
      ]}
      loading={!data} error={data?.error} onRetry={reload}>
      {recordOpen && <QuickAttendance brief={brief} onSaved={reload} onClose={() => setRecordOpen(false)} />}
    </RoleHome>
  );
}


function DeptMembers() {
  const { profile } = useAuth();
  const myDept = profile?.department;
  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  useEffect(() => { getMembers({ department: myDept }).then(setMembers); }, [myDept]);
  const filtered = members.filter(m =>
    `${m.first_name} ${m.last_name} ${m.phone} ${m.address}`.toLowerCase().includes(search.toLowerCase())
    && (!filter || m.status === filter)
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 200 }}><SearchInput value={search} onChange={setSearch} placeholder={`Search ${myDept} members...`} /></div>
        <FilterSelect value={filter} onChange={setFilter} options={MEMBER_STATUSES.map(s => ({ value: s, label: s }))} placeholder="All statuses" />
        <Badge label={`${filtered.length} members`} color={C.purple} />
      </div>
      <Panel>
        <DataTable onRowClick={r => window.dispatchEvent(new CustomEvent('sicc:open-member', { detail: r.id }))}
          columns={[
            { key: 'name', label: 'Name', render: (_, r) => <strong style={{ color: C.textPrimary }}>{r.first_name} {r.last_name}</strong> },
            { key: 'phone', label: 'Phone' },
            { key: 'address', label: 'Address' },
            { key: 'kdf_area', label: 'KDF area', render: v => <Badge label={v} color={C.purple} /> },
            { key: 'affinity_group', label: 'Affinity', render: v => v ? <Badge label={v} color={C.blue} /> : 'N/A' },
            { key: 'status', label: 'Status', render: v => <StatusBadge status={v} /> },
            { key: 'date_of_birth', label: 'DOB', render: v => v || 'N/A' },
            { key: 'spiritual_status', label: 'Spiritual' },
          ]}
          rows={filtered}
          emptyText="No members found."
        />
      </Panel>
    </div>
  );
}

function DeptAttendance() {
  const { profile } = useAuth();
  const myDept = profile?.department;
  const dept = DEPARTMENTS.find(d => d.name === myDept);
  const deptColor = dept?.color || C.purple;
  const [records, setRecords] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), service: 'Sunday Service', dept_count: '' });
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const reload = () => getAttendance().then(all => setRecords(all.filter(a => a.dept_name === myDept)));
  useEffect(() => { reload(); }, [myDept]);

  const handleAdd = async () => {
    if (!form.date || !form.dept_count) return;
    setLoading(true);
    const { data, error } = await createAttendance({ date: form.date, service: form.service, count: Number(form.dept_count), dept_count: Number(form.dept_count) });
    if (error) { toast.error(error.message); setLoading(false); return; }
    toast.success(data?.queued ? 'Saved on this phone. It will send when you are back online.' : 'Attendance recorded.');
    if (!data?.queued) setRecords([data, ...records]);
    setShowModal(false);
    setForm({ date: new Date().toISOString().slice(0, 10), service: 'Sunday Service', dept_count: '' });
    setLoading(false);
  };

  const avg = records.length ? Math.round(records.reduce((a, b) => a + (b.dept_count || b.count), 0) / records.length) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <Grid cols="repeat(3, 1fr)" gap={12}>
          <StatCard label="Last Service" value={records[0]?.dept_count ?? 'N/A'} icon={<CheckSquare size={18} />} color={deptColor} sub={records[0]?.service} />
          <StatCard label="Sessions Logged" value={records.length} icon={<Calendar size={18} />} color={C.gold} />
          <StatCard label="Average" value={avg || 'N/A'} icon={<Activity size={18} />} color={C.success} />
        </Grid>
        <Btn onClick={() => setShowModal(true)} color={C.navy}><CheckSquare size={14} /> Mark Attendance</Btn>
      </div>
      <Panel title={`${myDept}: Attendance Records`}>
        <AttendanceHistory records={records} reload={reload} accent={deptColor} deptView />
      </Panel>
      {showModal && (
        <Modal title="Mark Department Attendance" onClose={() => setShowModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Input label="Date" value={form.date} onChange={v => setForm({ ...form, date: v })} type="date" required />
            <Select label="Service type" value={form.service} onChange={v => setForm({ ...form, service: v })} options={SERVICE_TYPES} />
            <Input label={`${myDept} Members Present`} value={form.dept_count} onChange={v => setForm({ ...form, dept_count: v })} type="number" placeholder="Number present" required />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Btn variant="outline" color={C.textSecondary} onClick={() => setShowModal(false)}>Cancel</Btn>
              <Btn onClick={handleAdd} color={C.navy} disabled={loading || !form.dept_count}>{loading ? 'Saving...' : 'Save'}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Reports() {
  const { profile } = useAuth();
  const myDept = profile?.department;
  const dept = DEPARTMENTS.find(d => d.name === myDept);
  const deptColor = dept?.color || C.purple;
  const [members, setMembers] = useState([]);
  const [reportText, setReportText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const toast = useToast();
  useEffect(() => { getMembers({ department: myDept }).then(setMembers); }, [myDept]);

  const handleSubmit = async () => {
    if (!reportText.trim()) return;
    const { error: reportError } = await submitReport(reportText);
    if (reportError) { toast.error(reportError.message); return; }
    setSubmitted(true); setReportText('');
    setTimeout(() => setSubmitted(false), 5000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ background: `${deptColor}0D`, border: `1px solid ${deptColor}25`, borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: deptColor, marginBottom: 10 }}>Summary for {myDept} (visible to Bishop and Admin)</div>
        <Grid cols="repeat(4, 1fr)" gap={12}>
          {[{ v: members.length, l: 'Total' }, { v: members.filter(m => m.status === 'Worker').length, l: 'Workers' }, { v: members.filter(m => m.status === 'Active Member').length, l: 'Active' }, { v: members.filter(m => m.status === 'New Convert').length, l: 'New Converts' }].map((s, i) => (
            <div key={i}><div style={{ fontSize: 22, fontWeight: 500, color: C.textPrimary }}>{s.v}</div><div style={{ fontSize: 11, color: C.textMuted }}>{s.l}</div></div>
          ))}
        </Grid>
      </div>
      <Panel title="Submit Department Report">
        <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 14, lineHeight: 1.6 }}>This report will be visible to Bishop Enobong Etteh and Admin.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Textarea value={reportText} onChange={setReportText} placeholder={`Write your ${myDept} report here...\n\nInclude: activities, prayer requests, challenges, member updates...`} rows={6} />
          {submitted && <Alert type="success" message="Report submitted! Bishop and Admin have been notified." />}
          <Btn onClick={handleSubmit} color={C.navy} disabled={!reportText.trim()}>Submit Report</Btn>
        </div>
      </Panel>
    </div>
  );
}
