import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest } from '../../lib/api';
import { Alert, Btn, C, ConfirmDialog, Input, Panel, Select } from '../shared/UI';
import { InviteStatus, RedHero, RedLoading, RedProblem, ShareLink, formatRedTimestamp } from './RedShared';
import RedCommand, { CommandTeam } from './RedCommand';
import '../../styles/red.css';

const capacities = [1, 5, 10, 25, 50].map(value => ({ value: String(value), label: String(value) }));
const fields = [
  ['goal', 'Campaign goal', 1, 1000000], ['monthly_target', 'Monthly target per person', 1, 1000], ['team_size', 'Team size, including leader', 2, 50],
  ['campaign_start', 'Campaign start'], ['campaign_end', 'Campaign end'], ['final_report_opens', 'Final report opens'],
  ['report_open_day', 'Monthly report opening day', 1, 28], ['report_close_day', 'Closing day of the next month', 1, 28],
  ['leader_expiry_hours', 'Leader invitation lifetime in hours', 1, 720], ['member_expiry_days', 'Team join link lifetime in days', 1, 30],
];
const calendarDate = new Intl.DateTimeFormat('en-NG', { dateStyle: 'long', timeZone: 'Africa/Lagos' });
const dateLabel = value => calendarDate.format(new Date(`${value}T00:00:00+01:00`));

function SettingsForm({ settings, onSaved }) {
  const [draft, setDraft] = useState(settings);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState(null);
  const update = key => value => setDraft(previous => ({ ...previous, [key]: value }));
  const submit = async event => {
    event.preventDefault();
    setPending(true);
    setResult(null);
    try {
      const body = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, typeof settings[key] === 'number' ? Number(value) : value]));
      const saved = await apiRequest('/red/settings', { method: 'PATCH', body });
      setDraft(saved);
      onSaved(saved);
      setResult({ type: 'success', message: 'Campaign settings saved.' });
    } catch (error) { setResult({ type: 'error', message: error.message }); }
    finally { setPending(false); }
  };
  return (
    <Panel title="Campaign settings">
      <form className="red-stack" onSubmit={submit}>
        <div className="red-controls">
          {fields.map(([key, label, min, max]) => <Input key={key} label={label} type={min ? 'number' : 'date'} min={min} max={max} value={draft[key]} onChange={update(key)} required disabled={pending} />)}
          <Select label="Default leader link capacity" value={String(draft.leader_link_capacity)} onChange={update('leader_link_capacity')} options={capacities} required disabled={pending} />
        </div>
        {result && <Alert {...result} />}
        <div className="red-actions"><Btn type="submit" loading={pending}>Save campaign settings</Btn></div>
      </form>
    </Panel>
  );
}

function LeaderInvitations({ defaultCapacity, initialId }) {
  const [capacityOverride, setCapacity] = useState(null);
  const capacity = capacityOverride ?? String(defaultCapacity);
  const [invites, setInvites] = useState(null);
  const [detail, setDetail] = useState(null);
  const [fresh, setFresh] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => setInvites(await apiRequest('/red/leader-invites'));
  useEffect(() => {
    let mounted = true;
    apiRequest('/red/leader-invites').then(data => { if (mounted) setInvites(data); }).catch(problem => { if (mounted) setError(problem); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    if (!initialId) return undefined;
    let mounted = true;
    apiRequest(`/red/leader-invites/${encodeURIComponent(initialId)}`).then(data => { if (mounted) setDetail(data); })
      .catch(problem => { if (mounted) setError(problem); });
    return () => { mounted = false; };
  }, [initialId]);

  const act = async (action, id) => {
    setError(null);
    setPending(true);
    setConfirm(null);
    try {
      if (action === 'refresh') {
        await load();
        if (detail) setDetail(await apiRequest(`/red/leader-invites/${detail.id}`));
      } else if (action === 'detail') {
        setDetail(await apiRequest(`/red/leader-invites/${id}`));
      } else {
        const url = id ? `/red/leader-invites/${id}/${action}` : '/red/leader-invites';
        const result = await apiRequest(url, { method: 'POST', body: id ? {} : { capacity: Number(capacity) } });
        if (result.path) setFresh(result);
        else if (fresh?.id === id) setFresh(null);
        if (detail?.id === id) setDetail(null);
        await load();
      }
    } catch (problem) { setError(problem); }
    finally { setPending(false); }
  };

  const shown = invites?.slice(0, 5);
  const [all, setAll] = useState(false);
  return (
    <Panel title="Leader invitations">
      <div className="red-stack">
        <form className="red-controls" onSubmit={event => { event.preventDefault(); act('create'); }}>
          <Select label="Number of leaders who can sign up" value={capacity} onChange={setCapacity} options={capacities} disabled={pending} required />
          <div className="red-actions"><Btn type="submit" loading={pending}>Generate leader invitation link</Btn></div>
        </form>
        {error && <Alert type="error" message={error.message} />}
        {fresh && (
          <>
            <p>Copy this link before leaving this page.</p>
            <ShareLink key={fresh.id} path={fresh.path} message="You’re invited to lead a team in Operation R.E.D." />
          </>
        )}
        {invites === null && !error && <RedLoading>Loading invitations…</RedLoading>}
        {invites?.length === 0 && <p>No leader invitations have been created.</p>}
        {invites?.length > 0 && (
          <ul className="red-list">
            {(all ? invites : shown).map(invite => (
              <li key={invite.id}>
                <div>
                  <strong>Created {formatRedTimestamp(invite.created_at)}</strong>
                  <InviteStatus invite={invite} />
                  <p>{invite.declines} declined</p>
                </div>
                <div className="red-actions">
                  <Btn size="sm" variant="outline" disabled={pending} onClick={() => act('detail', invite.id)}>View responses</Btn>
                  {invite.status === 'Active' && <Btn size="sm" variant="outline" color={C.danger} disabled={pending} onClick={() => setConfirm({ action: 'revoke', id: invite.id })}>Revoke</Btn>}
                  <Btn size="sm" variant="outline" disabled={pending} onClick={() => setConfirm({ action: 'regenerate', id: invite.id })}>Regenerate</Btn>
                </div>
              </li>
            ))}
          </ul>
        )}
        {detail && (
          <Panel title="Invitation responses">
            <div className="red-stack">
              <InviteStatus invite={detail} />
              <p>{detail.declines} declined. Times are shown in Lagos time.</p>
              {detail.joined.length > 0 ? (
                <ul className="red-list">{detail.joined.map(person => <li key={person.profile_id}><strong>{person.name}</strong><small>{formatRedTimestamp(person.responded_at)}</small></li>)}</ul>
              ) : <p>There are no sign-ups from this link yet.</p>}
              <div className="red-actions"><Btn variant="outline" onClick={() => setDetail(null)}>Close responses</Btn></div>
            </div>
          </Panel>
        )}
        <div className="red-actions">
          {invites?.length > 5 && <Btn variant="outline" onClick={() => setAll(previous => !previous)}>{all ? 'Show latest five' : `Show all ${invites.length} links`}</Btn>}
          <Btn variant="outline" disabled={pending} onClick={() => act('refresh')}>Refresh invitations</Btn>
        </div>
      </div>
      {confirm && <ConfirmDialog title={confirm.action === 'revoke' ? 'Revoke leader invitation?' : 'Replace leader invitation?'}
        message="The current link will stop accepting sign-ups. Teams already created will keep their access."
        confirmLabel={confirm.action === 'revoke' ? 'Revoke link' : 'Replace link'} onConfirm={() => act(confirm.action, confirm.id)} onCancel={() => setConfirm(null)} />}
    </Panel>
  );
}

export default function RedAdmin() {
  const [search, setSearch] = useSearchParams();
  const invite = search.get('invite');
  const team = search.get('team');
  const mode = invite ? 'invitations' : search.get('view') || 'live';
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let mounted = true;
    apiRequest('/red/settings').then(data => { if (mounted) setSettings(data); }).catch(problem => { if (mounted) setError(problem); });
    return () => { mounted = false; };
  }, [attempt]);
  if (error) return <RedProblem error={error} retry={() => { setError(null); setAttempt(previous => previous + 1); }} />;
  if (!settings) return <RedLoading />;
  const openTeam = id => setSearch({ team: id });
  const selectMode = view => setSearch(view === 'live' ? {} : { view });
  const navigation = (
    <nav className="red-actions" aria-label="Operation R.E.D. management">
      {[['live', 'Live teams'], ['invitations', 'Leader invitations'], ['settings', 'Campaign settings']].map(([view, label]) => (
        <Btn key={view} variant={mode === view ? 'solid' : 'outline'} onClick={() => selectMode(view)}>{label}</Btn>
      ))}
    </nav>
  );
  return (
    <div className="red-page">
      {team ? <CommandTeam key={team} id={team} onBack={() => selectMode('live')} /> : mode === 'invitations' || mode === 'settings' ? (
        <>
          <RedHero title="Operation R.E.D.">
            <p>Campaign start {dateLabel(settings.campaign_start)} · Final report opens {dateLabel(settings.final_report_opens)}</p>
          </RedHero>
          {navigation}
          {mode === 'invitations' ? <LeaderInvitations defaultCapacity={settings.leader_link_capacity} initialId={invite} /> : <SettingsForm settings={settings} onSaved={setSettings} />}
        </>
      ) : <RedCommand settings={settings} navigation={navigation} onOpenTeam={openTeam} />}
    </div>
  );
}
