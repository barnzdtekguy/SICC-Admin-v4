import { ShieldAlert } from 'lucide-react';
import { C } from '../../lib/theme';
import { useAuth } from '../../hooks/useAuth';
import { PasswordForm, MfaSetup } from './SecurityCenter';
import { Btn } from '../shared/UI';
import PinForm from './PinForm';

// Shown instead of the app until a temporary password is replaced and mandatory two-step verification is on.
export default function SecurityGate() {
  const { restrictions, refresh, logout, profile, applySession } = useAuth();
  const prerequisites = restrictions.filter(restriction => restriction !== 'pin_setup');
  const step = prerequisites.includes('password_change') ? 'password' : 'mfa';
  if (!prerequisites.length) return (
    <main className="quick-login-page">
      <section className="quick-login-card" aria-labelledby="pin-setup-title">
        <div className="quick-login-brand"><img src="/salem-logo.png" alt="" width="52" height="52" /></div>
        <h1 className="display" id="pin-setup-title">Secure Your Account</h1>
        <p className="quick-login-intro">Create a 4-digit PIN for faster access to your SICC Admin dashboard.</p>
        <PinForm action="setup" onSaved={applySession} />
        <div className="quick-login-links"><Btn variant="ghost" onClick={() => logout()}>Sign out</Btn></div>
      </section>
    </main>
  );
  return (
    <div style={{ minHeight: '100vh', background: C.navy, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <main style={{ width: '100%', maxWidth: 560, background: C.cardBg, borderRadius: 20, padding: 'clamp(22px, 4vw, 36px)', boxShadow: 'var(--shadow-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <span aria-hidden style={{ width: 44, height: 44, borderRadius: 12, background: C.warningBg, color: C.warning, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ShieldAlert size={22} /></span>
          <div><div style={{ fontSize: 12, color: C.textMuted, fontWeight: 600 }}>Step {step === 'password' ? 1 : prerequisites.length > 1 ? 2 : 1} of {prerequisites.length}</div><h1 className="display" style={{ fontSize: 30, color: C.textPrimary, lineHeight: 1.1 }}>{step === 'password' ? 'Choose a new password' : 'Secure your account'}</h1></div>
        </div>
        <p style={{ fontSize: 14, color: C.textSecondary, margin: '10px 0 22px', lineHeight: 1.55 }}>
          {step === 'password' ? `Welcome${profile?.name ? `, ${profile.name.split(' ')[0]}` : ''}. Your current password is temporary. Replace it with one only you know.` : 'Your role manages sensitive church data, so two-step verification is required before you continue.'}
        </p>
        {step === 'password' ? <PasswordForm forced onDone={refresh} /> : <MfaSetup onDone={refresh} />}
        <div style={{ marginTop: 22, paddingTop: 14, borderTop: `1px solid ${C.border}` }}><Btn variant="outline" color={C.textSecondary} size="sm" onClick={() => logout()}>Sign out</Btn></div>
      </main>
    </div>
  );
}
