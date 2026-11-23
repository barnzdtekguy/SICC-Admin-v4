import { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import { ROLE_LABELS, ROLES } from '../../data/constants';
import { Alert, Btn, C, ConfirmDialog, Panel } from '../shared/UI';
import { InviteStatus, RedHero, RedLoading, RedProblem, ShareLink, formatRedTimestamp } from './RedShared';
import '../../styles/red.css';

export default function RedTeam({ activeTab, setActiveTab }) {
  const { profile } = useAuth();
  const leader = profile.role === ROLES.RED_LEADER;
  const linkPage = activeTab === 'red-join';
  const [team, setTeam] = useState(null);
  const [link, setLink] = useState(null);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [nextTeam, nextLink] = await Promise.all([apiRequest('/red/team'), linkPage ? apiRequest('/red/team/join-link') : null]);
        if (mounted) { setTeam(nextTeam); setLink(nextLink); }
      } catch (problem) { if (mounted) setError(problem); }
    };
    load();
    return () => { mounted = false; };
  }, [attempt, linkPage]);

  const regenerate = async () => {
    setConfirm(false);
    setActionError(null);
    setPending(true);
    try { setLink(await apiRequest('/red/team/join-link', { method: 'POST' })); }
    catch (problem) { setActionError(problem); }
    finally { setPending(false); }
  };

  if (error) return <RedProblem error={error} retry={() => { setError(null); setAttempt(previous => previous + 1); }} />;
  if (!team) return <RedLoading />;
  const count = `${team.joined} of ${team.seat_limit} joined`;
  const full = team.joined >= team.seat_limit;
  return (
    <div className="red-page">
      <RedHero title={linkPage ? 'Team join link' : activeTab === 'red-team' ? 'My team' : 'Operation R.E.D.'}
        action={leader && !linkPage && <button type="button" className="role-home-primary" onClick={() => setActiveTab('red-join')}>Open join link</button>}>
        <p className="role-home-hero-note">Team led by {team.leader_name}</p>
        <div className="display role-home-hero-number">{team.joined}/{team.seat_limit}</div>
        <p>{count}</p>
      </RedHero>
      {linkPage ? (
        <Panel title="Invite team members">
          <div className="red-stack">
            {link && <InviteStatus invite={link} />}
            {full ? <p>Your team is full.</p> : (
              <>
                {link?.path && <ShareLink key={link.id} path={link.path} message={`Join ${team.leader_name}’s team in Operation R.E.D.`} />}
                <div className="red-actions"><Btn variant="outline" loading={pending} onClick={() => link?.path ? setConfirm(true) : regenerate()}>{link ? 'Regenerate join link' : 'Generate join link'}</Btn></div>
              </>
            )}
            {actionError && <Alert type="error" message={actionError.message} />}
          </div>
        </Panel>
      ) : leader ? (
        <Panel title="Team roster">
          <ul className="red-list">
            {team.members?.map(member => (
              <li key={member.id}><div><strong>{member.name}</strong><p>{ROLE_LABELS[member.role]}</p></div><small>Joined {formatRedTimestamp(member.joined_at)}</small></li>
            ))}
          </ul>
        </Panel>
      ) : activeTab === 'overview' && (
        <Panel title="My team"><Btn variant="outline" onClick={() => setActiveTab('red-team')}>View team</Btn></Panel>
      )}
      {confirm && <ConfirmDialog title="Replace the join link?" message="The current link will stop working as soon as you create a replacement."
        confirmLabel="Replace link" onConfirm={regenerate} onCancel={() => setConfirm(false)} danger={false} />}
      {actionError?.status === 409 && <p style={{ color: C.textSecondary }}>Refresh to see your current team size.</p>}
    </div>
  );
}
