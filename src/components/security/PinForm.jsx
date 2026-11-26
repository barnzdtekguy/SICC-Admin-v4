import { useState } from 'react';
import { apiRequest } from '../../lib/api';
import { canTrustBrowser, trustBrowser } from '../../lib/quickLogin';
import { Alert, Btn, Checkbox, Input } from '../shared/UI';
import { useToast } from '../shared/Toast';
import '../../styles/quick-login.css';

const fourDigits = /^\d{4}$/;
const digitsOnly = value => value.replace(/[^0-9]/g, '').slice(0, 4);

export default function PinForm({ action, onSaved, onCancel, onExpired }) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    if (!fourDigits.test(pin) || !fourDigits.test(confirmPin)) { setError('Enter a four-digit PIN in both fields.'); return; }
    if (pin !== confirmPin) { setError('Your PINs do not match. Please try again.'); return; }
    setError(''); setBusy(true); setPin(''); setConfirmPin('');
    try {
      const session = await apiRequest('/auth/quick-login/pin', { method: 'POST', body: { action, pin, confirmPin } });
      if (trust) {
        try { await trustBrowser(); }
        catch { toast.error('Your PIN was saved. You can try trusting this device again in Security & Quick Login.'); }
      }
      onSaved(session);
    } catch (failure) {
      setError(failure.message);
      if (failure.code === 'full_auth_required') onExpired?.();
    } finally { setBusy(false); }
  }

  return (
    <form className="quick-login-fields" onSubmit={save}>
      <Input label={action === 'setup' ? '4-digit PIN' : 'New 4-digit PIN'} type="password" value={pin} onChange={value => setPin(digitsOnly(value))}
        inputMode="numeric" maxLength={4} autoComplete="off" disabled={busy} required />
      <Input label="Confirm PIN" type="password" value={confirmPin} onChange={value => setConfirmPin(digitsOnly(value))}
        inputMode="numeric" maxLength={4} autoComplete="off" disabled={busy} required />
      {canTrustBrowser() && <Checkbox label="Trust this device for Quick Login" checked={trust} onChange={setTrust} disabled={busy} hint="Choose this only on a device you control." />}
      {error && <Alert type="error" message={error} />}
      <div className="quick-login-actions">
        <Btn type="submit" loading={busy} full={!onCancel}>{action === 'setup' ? 'Continue' : 'Save new PIN'}</Btn>
        {onCancel && <Btn onClick={onCancel} variant="outline" disabled={busy}>Cancel</Btn>}
      </div>
    </form>
  );
}
