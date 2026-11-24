import { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/api';
import { flushQueue, onRedQueueChange, removeRedQueueItem } from '../../lib/offlineQueue';
import { Alert, Badge, Btn, C, Checkbox, ConfirmDialog, Input, Modal, Panel, Select, Textarea } from '../shared/UI';
import { RedLoading, formatRedTimestamp } from './RedShared';

const labels = {
  recorded: 'Recorded', under_training: 'Under training', completed_training: 'Completed training', equipped: 'Equipped', deployed: 'Deployed',
};
const stages = Object.keys(labels);
const stageOptions = stages.map(value => ({ value, label: labels[value] }));
export const redStage = stage => labels[stage] || stage;
const blank = { full_name: '', address: '', phone: '', email: '', consent: false };

export function SoulForm({ profileId, onSaved }) {
  const [fields, setFields] = useState(blank);
  const [id] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const update = field => value => setFields(previous => ({ ...previous, [field]: value }));

  const save = async event => {
    event.preventDefault();
    if (pending) return;
    if (!fields.consent) { setError('Confirm that this person agreed to be followed up.'); return; }
    setPending(true);
    setError('');
    try {
      const result = await apiRequest('/red/souls', { method: 'POST', body: { id, ...fields }, queueable: true, queueOwner: profileId });
      onSaved(result);
    } catch (problem) { setError(problem.message); }
    finally { setPending(false); }
  };
  return (
    <Panel title="Person’s details">
      <form className="red-stack" onSubmit={save}>
        <Input label="Full name" value={fields.full_name} onChange={update('full_name')} required maxLength={240} />
        <Textarea label="Address" value={fields.address} onChange={update('address')} required maxLength={500} rows={3} />
        <div className="red-controls">
          <Input label="Phone (optional)" type="tel" value={fields.phone} onChange={update('phone')} maxLength={40} />
          <Input label="Email (optional)" type="email" value={fields.email} onChange={update('email')} maxLength={254} />
        </div>
        <Checkbox label="This person agreed to be followed up" checked={fields.consent} onChange={update('consent')} />
        {error && <Alert type="error" message={error} />}
        <div className="red-actions"><Btn type="submit" loading={pending}>Save soul</Btn></div>
      </form>
    </Panel>
  );
}

function QueuedSouls({ profileId }) {
  const [items, setItems] = useState([]);
  const [active, setActive] = useState(false);
  const [remove, setRemove] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => onRedQueueChange(profileId, setItems), [profileId]);
  if (!items.length) return null;
  return (
    <Panel title="Saved on this device">
      <div className="red-stack">
        <ul className="red-list">
          {items.map(item => <li key={item.id}>
            <div><strong>{item.body.full_name}</strong><p>{item.failure || 'Waiting to sync'}</p></div>
            {item.failure && <Btn variant="outline" size="sm" onClick={() => setRemove(item.id)}>Remove from this device</Btn>}
          </li>)}
        </ul>
        {error && <Alert type="error" message={error} />}
        {items.some(item => !item.failure) && <div className="red-actions"><Btn variant="outline" loading={active} onClick={async () => {
          setActive(true);
          setError('');
          try {
            const result = await flushQueue(profileId);
            if (!navigator.onLine) setError('Connect to the internet to sync these records.');
            else if (!result.sent && !result.failed) setError('The records are still waiting to sync. Try again later.');
          } finally { setActive(false); }
        }}>Sync now</Btn></div>}
      </div>
      {remove && <ConfirmDialog title="Remove this offline entry?" message="This entry is stored on this device. You can use Add soul to enter corrected details."
        confirmLabel="Remove entry" danger onCancel={() => setRemove(null)} onConfirm={async () => {
          try { await removeRedQueueItem(profileId, remove); } catch { setError('Could not remove this entry. Try again.'); }
          finally { setRemove(null); }
        }} />}
    </Panel>
  );
}

export function SoulDialog({ id, profileId, manage, onClose, onChanged }) {
  const [soul, setSoul] = useState(null);
  const [selectedStage, setSelectedStage] = useState('');
  const [action, setAction] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => {
    let current = true;
    apiRequest(`/red/souls/${id}`).then(data => {
      if (current) { setSoul(data); setSelectedStage(data.stage); }
    }).catch(problem => { if (current) setError(problem.message); });
    return () => { current = false; };
  }, [id]);
  const previous = stages.indexOf(soul?.stage);
  const edit = soul && !soul.invalidated_at && (manage || soul.winner_id === profileId);

  const change = async (operation, stage) => {
    setPending(true);
    setError('');
    try {
      const body = operation === 'invalidate' ? { reason } : { stage, expected_stage: soul.stage, reason };
      await apiRequest(`/red/souls/${id}/${operation}`, { method: 'POST', body });
      onChanged();
      const updated = await apiRequest(`/red/souls/${id}`);
      setSoul(updated);
      setSelectedStage(updated.stage);
      setReason('');
      setAction(null);
    } catch (problem) { setError(problem.message); }
    finally { setPending(false); }
  };

  return (
    <Modal title={soul?.full_name || 'Soul record'} onClose={onClose}>
      <div className="red-stack">
        {error && <Alert type="error" message={error} />}
        {!soul && !error && <RedLoading>Loading soul record…</RedLoading>}
        {soul && (
          <>
            <dl className="red-details">
              <dt>Won by</dt><dd>{soul.winner_name}</dd>
              <dt>Stage</dt><dd>{redStage(soul.stage)}</dd>
              <dt>Address</dt><dd>{soul.address}</dd>
              {soul.phone && <><dt>Phone</dt><dd>{soul.phone}</dd></>}
              {soul.email && <><dt>Email</dt><dd>{soul.email}</dd></>}
              <dt>Consent recorded</dt><dd>{formatRedTimestamp(soul.consent_recorded_at)}</dd>
            </dl>
            {soul.invalidated_at && <Alert type="warning" message={`Flagged invalid. ${soul.invalidation_reason}`} />}
            {edit && !action && (manage ? (
              <div className="red-stack">
                <Select label="Override training stage" value={selectedStage} onChange={setSelectedStage} options={stageOptions} />
                <div className="red-actions">
                  <Btn disabled={selectedStage === soul.stage} onClick={() => setAction({ operation: 'stage', stage: selectedStage })}>Override stage</Btn>
                  <Btn variant="outline" color={C.danger} onClick={() => setAction({ operation: 'invalidate' })}>Flag invalid</Btn>
                </div>
              </div>
            ) : <div className="red-actions">
              {previous < stages.length - 1 && <Btn loading={pending} onClick={() => change('stage', stages[previous + 1])}>Move to {redStage(stages[previous + 1])}</Btn>}
              {previous > 0 && <Btn variant="outline" disabled={pending} onClick={() => setAction({ operation: 'stage', stage: stages[previous - 1] })}>Move back</Btn>}
            </div>)}
            {action && (
              <form className="red-stack" onSubmit={event => { event.preventDefault(); change(action.operation, action.stage); }}>
                <Textarea label="Reason" value={reason} onChange={setReason} required maxLength={500} />
                <div className="red-actions">
                  <Btn type="submit" loading={pending} disabled={reason.trim().length < 8}>{action.operation === 'invalidate' ? 'Confirm invalidation' : 'Confirm stage change'}</Btn>
                  <Btn variant="outline" disabled={pending} onClick={() => { setAction(null); setReason(''); }}>Cancel</Btn>
                </div>
              </form>
            )}
            <h3>Stage history</h3>
            <ol className="red-list">
              {soul.history.map((entry, index) => <li key={index}>
                <div><strong>{redStage(entry.stage)}</strong><p>{entry.actor_name}{entry.reason && ` · ${entry.reason}`}</p></div>
                <small>{formatRedTimestamp(entry.changed_at)}</small>
              </li>)}
            </ol>
          </>
        )}
      </div>
    </Modal>
  );
}

export function SoulList({ items, open, profileId, onChanged, showWinner = false }) {
  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');
  const advance = async soul => {
    setPending(soul.id);
    setError('');
    try {
      await apiRequest(`/red/souls/${soul.id}/stage`, { method: 'POST', body: { stage: stages[stages.indexOf(soul.stage) + 1], expected_stage: soul.stage } });
      onChanged();
    } catch (problem) { setError(problem.message); }
    finally { setPending(null); }
  };
  return (
    <div className="red-stack">
      {error && <Alert type="error" message={error} />}
      {!items.length ? <p>No souls have been recorded here yet.</p> : (
        <ul className="red-list">
          {items.map(soul => {
            const next = stages[stages.indexOf(soul.stage) + 1];
            return <li key={soul.id}>
              <div><strong>{soul.full_name}</strong><p>{soul.invalidated_at ? 'Flagged invalid' : redStage(soul.stage)}{showWinner && ` · ${soul.winner_name}`}</p></div>
              <div className="red-actions">
                {soul.church_member_review && <Badge color={C.warning} label="Membership match needs review" />}
                {next && !soul.invalidated_at && soul.winner_id === profileId && <Btn size="sm" disabled={Boolean(pending)} loading={pending === soul.id}
                  onClick={() => advance(soul)} ariaLabel={`Move ${soul.full_name} to ${redStage(next)}`}>Move to {redStage(next)}</Btn>}
                <Btn size="sm" variant="outline" onClick={() => open(soul.id)} ariaLabel={`View ${soul.full_name}`}>View</Btn>
              </div>
            </li>;
          })}
        </ul>
      )}
    </div>
  );
}

export function CampaignSouls({ scope, profileId, liveRevision }) {
  const [items, setItems] = useState([]);
  const [offset, setOffset] = useState(0);
  const [next, setNext] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const refresh = () => { setOffset(0); setRevision(previous => previous + 1); };
  useEffect(() => {
    let mounted = true;
    setError('');
    apiRequest(`/red/souls?scope=${scope}&offset=${offset}`).then(data => {
      if (mounted) { setItems(data.items); setNext(data.next_offset); }
    }).catch(problem => { if (mounted) setError(problem.message); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [scope, offset, revision, liveRevision]);
  return (
    <>
      {scope === 'own' && <QueuedSouls profileId={profileId} />}
      <Panel title={scope === 'team' ? 'Team souls' : 'My records'}>
        <div className="red-stack">
          {error && <Alert type="error" message={error} />}
          {loading ? <RedLoading>Loading records…</RedLoading> : (
            <>
              <SoulList items={items} open={setDetail} profileId={profileId} onChanged={refresh} showWinner={scope === 'team'} />
              <div className="red-actions">
                {offset > 0 && <Btn variant="outline" onClick={() => { setLoading(true); setOffset(previous => previous - 20); }}>Previous page</Btn>}
                {next !== null && <Btn variant="outline" onClick={() => { setLoading(true); setOffset(next); }}>Next page</Btn>}
                {error && <Btn variant="outline" onClick={refresh}>Refresh records</Btn>}
              </div>
            </>
          )}
        </div>
      </Panel>
      {detail && <SoulDialog id={detail} profileId={profileId} onClose={() => setDetail(null)} onChanged={refresh} />}
    </>
  );
}
