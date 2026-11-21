import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ShieldCheck, KeyRound, Smartphone, MonitorSmartphone, Bell, Copy, Download, Printer, CheckCircle2, LogOut, Sun, Moon, Laptop } from 'lucide-react';
import { C } from '../../lib/theme';
import { apiRequest } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { useToast } from '../shared/Toast';
import { Panel, Btn, Input, Alert, Badge, Checkbox, PageHeader, Skeleton } from '../shared/UI';
import { enablePush, disablePush, pushEnabled, pushSupported, canInstall, promptInstall, isStandalone } from '../../lib/pwa';

const RULES = [
  { ok: p => p.length >= 12, text: 'At least 12 characters (longer is better; a few random words works well)' },
  { ok: p => [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(p)).length >= 3 || p.length >= 16, text: 'Mix of upper/lower case, numbers or symbols (or 16+ characters)' },
  { ok: p => !/(password|church|salem|sicc|jesus|qwerty|123456|abcde)/i.test(p), text: 'No common words or sequences' },
];

export function PasswordForm({ onDone, forced }) {
  const toast = useToast();
  const [current, setCurrent] = useState(''); const [next, setNext] = useState(''); const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const mismatch = again && next !== again;
  const submit = async e => {
    e.preventDefault(); setError('');
    if (next !== again) { setError('The new passwords do not match.'); return; }
    setBusy(true);
    try { await apiRequest('/auth/password', { method: 'POST', body: { current_password: current, new_password: next } }); toast.success('Password changed. Other devices were signed out.'); setCurrent(''); setNext(''); setAgain(''); onDone?.(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 14, maxWidth: 440 }}>
      {error && <Alert type="error" message={error} />}
      <Input label={forced ? 'Temporary password' : 'Current password'} type="password" value={current} onChange={setCurrent} autoComplete="current-password" required />
      <Input label="New password" type="password" value={next} onChange={setNext} autoComplete="new-password" required />
      <ul style={{ listStyle: 'none', display: 'grid', gap: 4, fontSize: 12 }} aria-label="Password requirements">
        {RULES.map(r => { const ok = next && r.ok(next); return <li key={r.text} style={{ color: ok ? C.success : C.textMuted, display: 'flex', gap: 6 }}><CheckCircle2 size={14} aria-hidden style={{ flexShrink: 0, marginTop: 1, opacity: ok ? 1 : .45 }} />{r.text}</li>; })}
      </ul>
      <Input label="Confirm new password" type="password" value={again} onChange={setAgain} autoComplete="new-password" error={mismatch ? 'Passwords do not match' : ''} required />
      <div><Btn type="submit" color={C.info} loading={busy} disabled={!current || !next || mismatch}>Change password</Btn></div>
    </form>
  );
}

export function MfaSetup({ onDone }) {
  const { refresh } = useAuth();
  const toast = useToast();
  const [stage, setStage] = useState('intro'); // intro | scan | codes
  const [setup, setSetup] = useState(null); const [qr, setQr] = useState('');
  const [code, setCode] = useState(''); const [codes, setCodes] = useState([]);
  const [saved, setSaved] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');

  const begin = async () => {
    setBusy(true); setError('');
    try { const data = await apiRequest('/auth/mfa/setup', { method: 'POST', body: {} }); setSetup(data); setQr(await QRCode.toDataURL(data.otpauth_url, { margin: 1, width: 200, color: { dark: '#0C1B3A', light: '#FFFFFF' } })); setStage('scan'); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const enable = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { const data = await apiRequest('/auth/mfa/enable', { method: 'POST', body: { code } }); setCodes(data.recovery_codes); setStage('codes'); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const finish = async () => { await refresh(); toast.success('Two-step verification is on.'); onDone?.(); };
  const text = codes.join('\n');
  const download = () => { const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([`SICC Admin recovery codes\nKeep these somewhere safe. Each code works once.\n\n${text}\n`], { type: 'text/plain' })), download: 'sicc-recovery-codes.txt' }); a.click(); };

  if (stage === 'intro') return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 520 }}>
      {error && <Alert type="error" message={error} />}
      <p style={{ fontSize: 14, color: C.textSecondary, lineHeight: 1.6 }}>Even if someone learns your password, they cannot sign in without the 6-digit code from your phone. You’ll need an authenticator app such as Google Authenticator, Microsoft Authenticator or Authy.</p>
      <div><Btn color={C.info} onClick={begin} loading={busy}><Smartphone size={15} aria-hidden /> Set up two-step verification</Btn></div>
    </div>
  );
  if (stage === 'scan') return (
    <form onSubmit={enable} style={{ display: 'grid', gap: 14, maxWidth: 520 }}>
      {error && <Alert type="error" message={error} />}
      <ol style={{ paddingLeft: 20, fontSize: 14, color: C.textPrimary, lineHeight: 1.7 }}>
        <li>Open your authenticator app and choose <strong>Add account</strong> / <strong>Scan QR code</strong>.</li>
        <li>Scan this code (or type the key below it).</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <img src={qr} width="200" height="200" alt="QR code for your authenticator app" style={{ borderRadius: 12, border: `1px solid ${C.border}`, background: '#fff' }} />
        <div><div style={{ fontSize: 12, color: C.textMuted, marginBottom: 4 }}>Can’t scan? Enter this key:</div><code style={{ fontSize: 15, letterSpacing: 1.5, wordBreak: 'break-all', color: C.textPrimary }}>{setup.secret.match(/.{1,4}/g).join(' ')}</code></div>
      </div>
      <Input label="6-digit code" value={code} onChange={setCode} inputMode="numeric" autoComplete="one-time-code" maxLength={7} required />
      <div><Btn type="submit" color={C.success} loading={busy} disabled={code.replace(/\s/g, '').length !== 6}>Verify and turn on</Btn></div>
    </form>
  );
  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 520 }}>
      <Alert type="warning" message="Save these recovery codes now. They are shown only once. If you lose your phone, each code lets you sign in one time." />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: 16, border: `1px dashed ${C.borderStrong}`, borderRadius: 12, background: C.inputBg }}>
        {codes.map(c => <code key={c} style={{ fontSize: 15, letterSpacing: 1, color: C.textPrimary }}>{c}</code>)}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Btn size="sm" variant="outline" color={C.textSecondary} onClick={() => navigator.clipboard?.writeText(text).then(() => toast.info('Copied'))}><Copy size={13} aria-hidden /> Copy</Btn>
        <Btn size="sm" variant="outline" color={C.textSecondary} onClick={download}><Download size={13} aria-hidden /> Download</Btn>
        <Btn size="sm" variant="outline" color={C.textSecondary} onClick={() => window.print()}><Printer size={13} aria-hidden /> Print</Btn>
      </div>
      <Checkbox label="I have saved my recovery codes somewhere safe." checked={saved} onChange={setSaved} />
      <div><Btn color={C.success} disabled={!saved} onClick={finish}>Done</Btn></div>
    </div>
  );
}

function DisableMfa({ onDone }) {
  const toast = useToast();
  const [open, setOpen] = useState(false); const [password, setPassword] = useState(''); const [code, setCode] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async e => { e.preventDefault(); setBusy(true); setError(''); try { await apiRequest('/auth/mfa/disable', { method: 'POST', body: { password, code } }); toast.success('Two-step verification turned off.'); onDone(); } catch (err) { setError(err.message); } finally { setBusy(false); } };
  if (!open) return <Btn variant="outline" color={C.danger} size="sm" onClick={() => setOpen(true)}>Turn off…</Btn>;
  return <form onSubmit={submit} style={{ display: 'grid', gap: 10, maxWidth: 320, marginTop: 8 }}>{error && <Alert type="error" message={error} />}<Input label="Password" type="password" value={password} onChange={setPassword} required /><Input label="Authenticator code" value={code} onChange={setCode} inputMode="numeric" required /><div style={{ display: 'flex', gap: 8 }}><Btn type="submit" color={C.danger} loading={busy}>Turn off</Btn><Btn variant="outline" color={C.textSecondary} onClick={() => setOpen(false)}>Cancel</Btn></div></form>;
}

function Devices() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const load = useCallback(() => apiRequest('/auth/sessions').then(setRows).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  const label = ua => { const s = String(ua || ''); const os = /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iPhone/iPad' : /Windows/.test(s) ? 'Windows' : /Mac OS/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : 'Unknown device'; const br = /Edg\//.test(s) ? 'Edge' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'Browser'; return `${br} on ${os}`; };
  const when = v => new Date(`${String(v).replace(' ', 'T')}Z`).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
  if (!rows) return <Skeleton h={80} />;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map(r => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', border: `1px solid ${C.border}`, borderRadius: 12, flexWrap: 'wrap' }}>
          <MonitorSmartphone size={20} aria-hidden style={{ color: C.textMuted }} />
          <div style={{ flex: 1, minWidth: 180 }}><div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>{label(r.user_agent)} {r.current && <Badge label="This device" color={C.success} />}</div><div style={{ fontSize: 12, color: C.textMuted }}>{r.ip || 'Unknown location'} · last active {when(r.last_seen_at)}</div></div>
          {!r.current && <Btn size="sm" variant="outline" color={C.danger} onClick={async () => { await apiRequest(`/auth/sessions/${r.id}`, { method: 'DELETE' }); toast.success('Device signed out.'); load(); }}>Sign out</Btn>}
        </div>
      ))}
      {rows.length > 1 && <div><Btn variant="outline" color={C.danger} onClick={async () => { await apiRequest('/auth/sessions/revoke-others', { method: 'POST', body: {} }); toast.success('All other devices were signed out.'); load(); }}><LogOut size={14} aria-hidden /> Sign out all other devices</Btn></div>}
    </div>
  );
}

function PushToggle() {
  const toast = useToast();
  const [on, setOn] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { pushEnabled().then(setOn).catch(() => {}); }, []);
  if (!pushSupported()) return <p style={{ fontSize: 13, color: C.textMuted }}>This browser doesn’t support push notifications. On iPhone, add the app to your Home Screen first.</p>;
  const toggle = async () => { setBusy(true); try { if (on) { await disablePush(); setOn(false); } else { await enablePush(); setOn(true); toast.success('Notifications enabled on this device.'); } } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  return <Btn variant={on ? 'outline' : 'solid'} color={C.info} loading={busy} onClick={toggle}><Bell size={14} aria-hidden /> {on ? 'Turn off notifications on this device' : 'Turn on notifications on this device'}</Btn>;
}

export default function SecurityCenter() {
  const { profile, refresh } = useAuth();
  const { mode, setMode } = useTheme();
  const [installable, setInstallable] = useState(canInstall());
  useEffect(() => { const t = setInterval(() => setInstallable(canInstall()), 1500); return () => clearInterval(t); }, []);
  const themes = [{ k: 'light', l: 'Light', i: Sun }, { k: 'dark', l: 'Dark (beta)', i: Moon }, { k: 'system', l: 'Match device', i: Laptop }];
  const required = ['bishop', 'admin'].includes(profile?.role);
  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 860 }}>
      <PageHeader title="Security & devices" subtitle="Protect your account and manage where you are signed in." />
      <Panel title="Password"><PasswordForm /></Panel>
      <Panel title="Two-step verification" action={profile?.mfa_enabled ? <Badge label="On" color={C.success} /> : <Badge label="Off" color={C.warning} />}>
        {profile?.mfa_enabled
          ? <div><p style={{ fontSize: 14, color: C.textSecondary, marginBottom: 10 }}>You’ll be asked for a code from your authenticator app each time you sign in.</p>{required ? <p style={{ fontSize: 13, color: C.textMuted }}>Required for your role, so it can’t be turned off. If you lose your phone, use a recovery code or ask the Bishop to reset it.</p> : <DisableMfa onDone={refresh} />}</div>
          : <MfaSetup onDone={refresh} />}
      </Panel>
      <Panel title="Where you’re signed in"><Devices /></Panel>
      <Panel title="Notifications & app">
        <div style={{ display: 'grid', gap: 12 }}>
          <div><PushToggle /></div>
          {installable && !isStandalone() && <div><Btn variant="outline" color={C.info} onClick={promptInstall}><Download size={14} aria-hidden /> Install SICC Admin on this device</Btn></div>}
        </div>
      </Panel>
      <Panel title="Appearance">
        <div role="radiogroup" aria-label="Theme" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {themes.map(t => (
            <button key={t.k} type="button" role="radio" aria-checked={mode === t.k} onClick={() => setMode(t.k)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 12, border: `2px solid ${mode === t.k ? C.info : C.border}`, background: C.cardBg, color: C.textPrimary, fontSize: 14, fontWeight: 600 }}><t.i size={16} aria-hidden />{t.l}</button>
          ))}
        </div>
      </Panel>
      <div style={{ fontSize: 12, color: C.textMuted, display: 'flex', gap: 6, alignItems: 'center' }}><ShieldCheck size={14} aria-hidden /><KeyRound size={14} aria-hidden /> Last sign-in: {profile?.last_login_at ? new Date(`${profile.last_login_at.replace(' ', 'T')}Z`).toLocaleString('en-NG') : 'this is your first sign-in'}</div>
    </div>
  );
}
