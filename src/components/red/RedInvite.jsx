import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Alert, Btn, Input, Panel, Spinner } from '../shared/UI';
import { useAuth } from '../../hooks/useAuth';
import { apiRequest } from '../../lib/api';
import { PASSWORD_HINT, validatePassword } from '../../../shared/password-policy.mjs';
import '../../styles/red.css';

const messages = {
  leader: 'This invitation is unavailable. Ask the church for a new link.',
  member: 'This team link is unavailable. Ask the team leader for a current link.',
};
const blank = { name: '', phone: '', email: '', password: '' };

export default function RedInvite() {
  const { kind } = useParams();
  const { hash } = useLocation();
  return <Invitation key={kind + hash} kind={kind} token={hash.slice(1)} />;
}

function Invitation({ kind, token }) {
  const leader = kind === 'leader';
  const validKind = leader || kind === 'member';
  const endpoint = `/public/red/${leader ? 'leader' : 'team'}-invites`;
  const navigate = useNavigate();
  const { applySession, clearNotice } = useAuth();
  const [invite, setInvite] = useState(null);
  const [stage, setStage] = useState('loading');
  const [fields, setFields] = useState(blank);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    document.title = 'Operation R.E.D. · SICC Admin';
    if (!validKind || !/^[\w-]{43}$/.test(token)) {
      setStage('unavailable');
      return undefined;
    }
    let mounted = true;
    apiRequest(`${endpoint}/inspect`, { method: 'POST', body: { token } })
      .then(data => { if (mounted) { setInvite(data); setStage('invited'); } })
      .catch(problem => {
        if (!mounted) return;
        setError(problem);
        setStage(problem.code === 'red_invite_unavailable' ? 'unavailable' : 'problem');
      });
    return () => { mounted = false; };
  }, [attempt, endpoint, token, validKind]);

  const respond = async action => {
    if (action === 'accept') {
      const problem = validatePassword(fields.password);
      if (problem) { setError({ message: problem }); return; }
    }
    setError(null);
    setPending(true);
    try {
      const body = action === 'accept' ? { ...fields, token } : { token };
      const data = await apiRequest(`${endpoint}/${action}`, { method: 'POST', body });
      if (action === 'decline') {
        setStage('declined');
        return;
      }
      applySession(data);
      clearNotice();
      navigate('/app/overview', { replace: true });
    } catch (problem) {
      setError(problem);
      if (problem.code === 'red_invite_unavailable') setStage('unavailable');
    } finally {
      setPending(false);
    }
  };

  const update = key => value => setFields(previous => ({ ...previous, [key]: value }));

  return (
    <main className="red-public">
      <div className="red-public-card">
        <Panel>
          <div className="red-invite-brand">
            <img src="/salem-logo.png" alt="Salem International Christian Centre" width="55" height="55" />
            <strong>Operation R.E.D.</strong>
          </div>
          {stage === 'loading' && <div className="red-loading" role="status"><Spinner /> Loading invitation…</div>}
          {stage === 'unavailable' && <p role="alert">{messages[kind] || messages.leader}</p>}
          {stage === 'declined' && <p role="status">Thank you. We’ve recorded your response.</p>}
          {stage === 'problem' && (
            <div className="red-stack">
              <Alert type="error" message={error.message} />
              <Btn onClick={() => { setStage('loading'); setAttempt(previous => previous + 1); }}>Try again</Btn>
            </div>
          )}
          {invite && (stage === 'invited' || stage === 'signup') && (
            <div className="red-stack">
              <h1 className="display">
                {stage === 'signup' ? 'Create your account' : leader ? 'You have been invited to lead a team in Operation R.E.D.' : `Join ${invite.leader_name}’s team`}
              </h1>
              {!leader && <p>{invite.joined} of {invite.seat_limit} joined</p>}
              {error && <Alert type="error" message={error.message} />}
              {error?.code === 'red_account_unavailable' && <Link className="red-text-link" to="/login">Sign in to an existing account</Link>}
              {stage === 'invited' ? (
                <div className="red-actions">
                  <Btn disabled={pending} onClick={() => setStage('signup')}>Accept</Btn>
                  {leader && <Btn variant="outline" loading={pending} onClick={() => respond('decline')}>Decline</Btn>}
                </div>
              ) : (
                <form className="red-stack" onSubmit={event => { event.preventDefault(); respond('accept'); }}>
                  <Input label="Full name" value={fields.name} onChange={update('name')} maxLength={160} required autoComplete="name" disabled={pending} />
                  <Input label="Phone number" value={fields.phone} onChange={update('phone')} type="tel" inputMode="tel" maxLength={40} required
                    autoComplete="tel" hint="Use this number to sign in. Include the country code for numbers outside Nigeria." disabled={pending} />
                  <Input label="Email (optional)" value={fields.email} onChange={update('email')} type="email" maxLength={254} autoComplete="email" disabled={pending} />
                  <Input label="Password" value={fields.password} onChange={update('password')} type="password" required
                    autoComplete="new-password" hint={PASSWORD_HINT} disabled={pending} />
                  <Btn type="submit" loading={pending} full>Create account and sign in</Btn>
                </form>
              )}
            </div>
          )}
        </Panel>
      </div>
    </main>
  );
}
