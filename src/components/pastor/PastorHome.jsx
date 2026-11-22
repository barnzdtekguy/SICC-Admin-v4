import { useCallback, useState } from 'react';
import { BarChart3, Phone, Plus, QrCode, Users } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { getBrief, getFollowUps, getMembers } from '../../lib/db';
import RoleHome, { useHomeData } from '../shared/RoleHome';
import { Modal } from '../shared/UI';

const shortcuts = [
  { to: '/app/myMembers', label: 'Members', Icon: Users },
  { to: '/app/followup', label: 'Follow-up', Icon: Phone },
  { to: '/app/programmes', label: 'Attendance', Icon: QrCode },
  { to: '/app/reports', label: 'Reports', Icon: BarChart3 },
];

export function membersByArea(members) {
  const counts = new Map();
  for (const { kdf_area: area } of members) {
    const label = area || 'Unassigned';
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts];
}

export default function PastorHome() {
  const { profile } = useAuth();
  const [showBirthdays, setShowBirthdays] = useState(false);
  const profileId = profile.id;
  const load = useCallback(() => ({
    brief: getBrief(),
    members: getMembers({ registeredBy: profileId }),
    followUps: getFollowUps({ pastorId: profileId }),
  }), [profileId]);
  const { data, reload } = useHomeData(load);
  const { brief, members, followUps } = data || {};
  const month = brief?.today?.slice(0, 7);
  const registered = month ? members?.filter(member => member.date_registered?.startsWith(month)).length : null;
  const birthdays = brief?.birthdays;
  const bars = membersByArea(members || [])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, value]) => ({ label, value }));
  const followUpPage = '/app/followup';
  const attentionRows = [
    ...(brief?.overdue || []).map(row => ({ key: `overdue-${row.id}`, title: row.member_name, detail: 'Follow-up overdue', to: followUpPage, Icon: Phone })),
    ...(brief?.needsContact || []).map(row => ({ key: `contact-${row.id}`, title: `${row.first_name} ${row.last_name}`, detail: 'No contact in 14 days', to: followUpPage, Icon: Phone })),
  ];
  return (
    <RoleHome
      hero={{ label: 'People in your care', value: brief?.myMembers ?? members?.length,
        note: registered != null ? `${registered.toLocaleString('en-NG')} registered this month` : null,
        action: { label: 'Register member', to: '/app/register', Icon: Plus } }}
      stats={[
        { label: 'New converts', value: members?.filter(member => member.status === 'New Convert').length },
        { label: 'Follow-up reports', value: followUps?.length },
        { label: 'Completed follow-ups', value: followUps?.filter(report => report.status === 'Completed').length },
        { label: 'Birthdays today', value: birthdays?.length, onClick: birthdays?.length ? () => setShowBirthdays(true) : undefined },
      ]}
      chart={{ title: 'Members by KDF area', bars, unit: 'members', to: '/app/reports', linkLabel: 'My reports',
        empty: members ? 'Area totals appear after you register a member.' : 'Area totals are unavailable.' }}
      attention={{ rows: attentionRows, to: followUpPage, empty: brief ? undefined : 'Follow-up reminders are unavailable.' }}
      shortcuts={shortcuts} loading={!data} error={data?.error} onRetry={reload}>
      {showBirthdays && (
        <Modal title="Birthdays today" onClose={() => setShowBirthdays(false)}>
          <ul className="role-home-birthdays">
            {birthdays.map(member => <li key={member.id}>{member.first_name} {member.last_name}</li>)}
          </ul>
        </Modal>
      )}
    </RoleHome>
  );
}

