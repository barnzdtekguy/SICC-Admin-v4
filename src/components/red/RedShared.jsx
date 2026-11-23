import { useEffect, useState } from 'react';
import { Alert, Badge, Btn, C, Spinner } from '../shared/UI';

const timestamp = value => Date.parse(value?.includes('T') ? value : `${value?.replace(' ', 'T')}Z`);
const clock = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' });
export const formatRedTimestamp = value => clock.format(timestamp(value));

export function RedLoading({ children = 'Loading Operation R.E.D.…' }) {
  return <div role="status" className="red-loading"><Spinner /> {children}</div>;
}

export function RedHero({ title, children, action }) {
  return (
    <div className="role-home-hero-backdrop">
      <section className="role-home-hero">
        <div><h1 className="display">{title}</h1>{children}</div>
        {action}
      </section>
    </div>
  );
}

export function InviteStatus({ invite }) {
  const [now, setNow] = useState(Date.now);
  const expires = timestamp(invite.expires_at);
  useEffect(() => {
    if (invite.status !== 'Active') return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000 * 15);
    return () => clearInterval(timer);
  }, [invite.status]);
  const status = invite.status === 'Active' && now >= expires ? 'Expired' : invite.status;
  const minutes = Math.max(1, Math.ceil((expires - now) / 60000));
  const remaining = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
  const tone = status === 'Active' ? C.success : status === 'Full' ? C.info : C.textSecondary;
  return (
    <div>
      <Badge label={status} color={tone} />
      <p>{invite.used} of {invite.capacity} used{status === 'Active' && ` · ${remaining} remaining`}</p>
    </div>
  );
}

export function ShareLink({ path, message }) {
  const link = new URL(path, window.location.origin).href;
  const [copyState, setCopyState] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopyState('Link copied.');
    } catch {
      setCopyState('Select the link to copy it.');
    }
  };
  return (
    <div className="red-share">
      <input value={link} readOnly onFocus={event => event.currentTarget.select()} aria-label="Invitation link" />
      <div className="red-actions">
        <Btn variant="outline" onClick={copy}>Copy link</Btn>
        <a className="red-text-link" href={`https://wa.me/?text=${encodeURIComponent(`${message} ${link}`)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
      </div>
      {copyState && <p role="status">{copyState}</p>}
    </div>
  );
}

export function RedProblem({ error, retry }) {
  return <div className="red-stack"><Alert type="error" message={error.message} /><div><Btn variant="outline" onClick={retry}>Try again</Btn></div></div>;
}
