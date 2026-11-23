import { useEffect, useState } from 'react';
import { Plus, Users } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import { ROLE_LABELS, ROLES } from '../../data/constants';
import { Btn, Panel, StatCard } from '../shared/UI';
import { useToast } from '../shared/Toast';
import { CampaignSouls, SoulForm } from './RedSouls';
import { MonthHistory, PaceChart, PaceLabel } from './RedProgress';
import RedBoard from './RedBoard';
import RedReports from './RedReports';
import { RedHero, RedLoading, RedProblem } from './RedShared';
import '../../styles/red.css';

function Progress({ profile, teamPage, setActiveTab, liveRevision }) {
  const leader = profile.role === ROLES.RED_LEADER;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    Promise.all([apiRequest('/red/team'), apiRequest('/red/dashboard')]).then(([team, progress]) => {
      if (current) { setData({ team, progress }); setError(null); }
    }).catch(problem => { if (current) setError(problem); });
    return () => { current = false; };
  }, [revision, liveRevision]);
  if (error && !data) return <RedProblem error={error} retry={() => { setError(null); setRevision(previous => previous + 1); }} />;
  if (!data) return <RedLoading />;
  const { team, progress } = data;
  const teamCount = `${team.joined} of ${team.seat_limit} joined`;
  return (
    <>
      <RedHero title={teamPage ? 'My team' : 'Operation R.E.D.'}
        action={leader && teamPage ? (
          <button type="button" className="role-home-primary" onClick={() => setActiveTab('red-join')}>Open join link</button>
        ) : !teamPage && progress.can_add && (
          <button type="button" className="role-home-primary" onClick={() => setActiveTab('red-add')}><Plus size={17} aria-hidden /> Add soul</button>
        )}>
        <p className="role-home-hero-note">Team led by {team.leader_name} · {teamCount}</p>
        {!teamPage && <><div className="display role-home-hero-number">{progress.current}/{progress.target}</div><p>Personal monthly target</p></>}
        {teamPage && leader && <div className="display role-home-hero-number">{progress.team_total}/{progress.team_target}</div>}
        {teamPage && leader && <p>Team monthly target</p>}
      </RedHero>
      {!teamPage && (
        <>
          <PaceChart points={progress.trend} pace={progress.pace} month={progress.month} />
          <MonthHistory history={progress.history} />
          <Panel title="Your records">
            <div className="red-actions"><Btn variant="outline" onClick={() => setActiveTab('red-souls')}>View my souls</Btn></div>
          </Panel>
        </>
      )}
      {!teamPage && !leader && <StatCard label="Team size" value={teamCount} icon={<Users size={18} aria-hidden />} onClick={() => setActiveTab('red-team')} />}
      {leader && (
        <>
          <Panel title="Team roster">
            <ul className="red-list">
              {progress.roster.map(member => (
                <li key={member.id}><div><strong>{member.name}</strong><p>{ROLE_LABELS[member.role]}</p></div>
                  <div><strong>{member.total} / {progress.target}</strong><br /><PaceLabel pace={member.pace} /></div>
                </li>
              ))}
            </ul>
            {!teamPage && <div className="red-actions"><Btn variant="outline" onClick={() => setActiveTab('red-team')}>View team</Btn></div>}
          </Panel>
          {teamPage && <RedReports liveRevision={liveRevision} onSubmitted={() => setRevision(previous => previous + 1)} />}
          {teamPage && <CampaignSouls scope="team" profileId={profile.id} liveRevision={liveRevision} />}
        </>
      )}
    </>
  );
}

export default function RedCampaign({ activeTab, setActiveTab }) {
  const { profile } = useAuth();
  const toast = useToast();
  const [liveRevision, setLiveRevision] = useState(0);
  useEffect(() => {
    if (activeTab === 'red-add') return undefined;
    const refresh = () => setLiveRevision(previous => previous + 1);
    const onQueueSent = event => { if (event.detail === profile.id) refresh(); };
    const stream = window.EventSource ? new EventSource('/api/red/team/updates') : null;
    stream?.addEventListener('refresh', refresh);
    const timer = setInterval(() => {
      if (navigator.onLine && document.visibilityState === 'visible') refresh();
    }, 30000);
    window.addEventListener('sicc:red-queue-sent', onQueueSent);
    window.addEventListener('online', refresh);
    return () => {
      stream?.close();
      clearInterval(timer);
      window.removeEventListener('sicc:red-queue-sent', onQueueSent);
      window.removeEventListener('online', refresh);
    };
  }, [activeTab, profile.id]);
  return (
    <div className="red-page">
      {activeTab === 'red-board' ? <RedBoard liveRevision={liveRevision} /> : activeTab === 'red-add' ? (
        <>
          <h1 className="display">Add soul</h1>
          <SoulForm profileId={profile.id} onSaved={result => {
            toast.success(result.queued ? 'Saved on this device. It will sync when you reconnect.' : 'Soul recorded.');
            setActiveTab('red-souls');
          }} />
        </>
      ) : activeTab === 'red-souls' ? (
        <>
          <RedHero title="My souls" action={<button type="button" className="role-home-primary" onClick={() => setActiveTab('red-add')}>Add soul</button>} />
          <CampaignSouls scope="own" profileId={profile.id} liveRevision={liveRevision} />
        </>
      ) : <Progress profile={profile} teamPage={activeTab === 'red-team'} setActiveTab={setActiveTab} liveRevision={liveRevision} />}
    </div>
  );
}
