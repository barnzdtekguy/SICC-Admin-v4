import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { apiRequest } from '../../lib/api';
import { canTrustBrowser, forgetBrowserKey, trustBrowser } from '../../lib/quickLogin';
import { Alert, Badge, Btn, Panel, Skeleton } from '../shared/UI';
import PinForm from './PinForm';

const utc = value => new Date(`${value.replace(' ', 'T')}Z`);
const briefDate = value => utc(value).toLocaleDateString('en-NG', { dateStyle: 'medium' });

function deviceName(userAgent = '') {
  const agent = userAgent || '';
  const system = [/Android/, /iPhone|iPad/, /Windows/, /Macintosh/, /Linux/];
  return ['Android browser', 'iPhone or iPad', 'Windows browser', 'Mac browser', 'Linux browser'][system.findIndex(pattern => pattern.test(agent))] || 'Browser';
}

export default function QuickLoginSettings() {
  const { quickLogin, applySession, logout } = useAuth();
  const navigate = useNavigate();
  const { search } = useLocation();
  const intent = new URLSearchParams(search).get('pin');
  const [editing, setEditing] = useState(intent === 'reset' || intent === 'change' ? intent : null);
  const [devices, setDevices] = useState(null);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const setUp = quickLogin?.pin_configured === true;
  const recent = quickLogin?.recent_full_auth === true && !expired;
  const current = devices?.find(device => device.current);
  const currentTrusted = current && !current.suspended_at && utc(current.expires_at) > new Date();

  const load = useCallback(async () => {
    try { setDevices(await apiRequest('/auth/quick-login/devices')); }
    catch (failure) { setError(failure.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function signInAgain(action) {
    setBusy(true);
    await logout();
    navigate(`/login?password=1&pin=${action}`, { replace: true });
  }

  function finishEdit() {
    setEditing(null);
    if (intent) navigate('/app/security', { replace: true });
  }

  async function enable() {
    if (!recent) { await signInAgain('trust'); return; }
    setBusy(true); setError(''); setNotice('');
    try { await trustBrowser(); setNotice('Quick Login is enabled on this device.'); await load(); }
    catch (failure) {
      setError(failure.message);
      if (failure.code === 'full_auth_required') setExpired(true);
    } finally { setBusy(false); }
  }

  async function remove(device) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiRequest(`/auth/quick-login/devices/${encodeURIComponent(device.id)}`, { method: 'DELETE' });
      if (device.current) await forgetBrowserKey().catch(() => {});
      if (result.signed_out) { await logout('Quick Login was disabled for this device.'); return; }
      setNotice('The trusted device was removed.');
      await load();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  return (
    <Panel title="Security & Quick Login" action={<Badge label={setUp ? 'PIN set up' : 'PIN required'} />}>
      <div className="quick-login-settings">
        <p>Use a 4-digit PIN to sign in on a trusted device. Two-step verification still applies to accounts that use it.</p>
        {error && <Alert type="error" message={error} />}
        {notice && <p role="status">{notice}</p>}
        {setUp && !editing && <div className="quick-login-actions">
          <Btn variant="outline" disabled={busy} onClick={() => setEditing('change')}>Change PIN</Btn>
          <Btn variant="outline" disabled={busy} onClick={() => setEditing('reset')}>Reset PIN</Btn>
        </div>}
        {setUp && editing && (recent ? (
          <div className="quick-login-settings">
            <h3>{editing === 'reset' ? 'Reset your PIN' : 'Change your PIN'}</h3>
            <p>Your trusted devices will need to be enrolled again.</p>
            <PinForm key={editing} action={editing} onExpired={() => setExpired(true)} onCancel={finishEdit} onSaved={session => {
              applySession(session); setError(''); setNotice('Your new PIN was saved.'); finishEdit(); load();
            }} />
          </div>
        ) : <div className="quick-login-settings">
          <p>Sign in with your password and complete any required verification to continue.</p>
          <div className="quick-login-actions">
            <Btn onClick={() => signInAgain(editing)} loading={busy}>Sign in again</Btn>
            <Btn onClick={finishEdit} disabled={busy} variant="outline">Cancel</Btn>
          </div>
        </div>)}
        {!setUp && <Btn onClick={() => signInAgain('setup')} loading={busy}>Sign in again to set up your PIN</Btn>}
        {setUp && <div className="quick-login-settings">
          <h3>Trusted devices</h3>
          {devices === null && !error && <Skeleton h={52} />}
          {devices?.length === 0 && <p>No trusted devices yet.</p>}
          {devices?.length > 0 && <ul className="quick-login-device-list">
            {devices.map(device => (
              <li key={device.id}>
                <div><strong>{deviceName(device.user_agent)} {device.current && <Badge label="This device" />}</strong>
                  <small>{device.suspended_at ? 'Suspended' : utc(device.expires_at) < new Date() ? 'Expired' : `Expires ${briefDate(device.expires_at)}`}</small></div>
                <Btn variant="outline" disabled={busy} onClick={() => remove(device)}>{device.current ? 'Disable Quick Login on this device' : 'Remove device'}</Btn>
              </li>
            ))}
          </ul>}
          {canTrustBrowser() && devices !== null && !currentTrusted && <div>
            <Btn variant="outline" onClick={enable} loading={busy}>Trust this device</Btn>
          </div>}
        </div>}
      </div>
    </Panel>
  );
}
