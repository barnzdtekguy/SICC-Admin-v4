import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Delete } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { Alert, Btn } from '../shared/UI';
import '../../styles/quick-login.css';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

export default function PinUnlock() {
  const { unlockPin } = useAuth();
  const { state } = useLocation();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const indicators = useRef(null);
  const disabled = busy || blocked;

  useEffect(() => { indicators.current?.focus({ preventScroll: true }); }, []);

  function addDigit(digit) {
    if (disabled) return;
    setError('');
    setPin(previous => (previous + digit).slice(0, 4));
  }

  function removeDigit() {
    if (!disabled) setPin(previous => previous.slice(0, -1));
  }

  function handleKey(event) {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (DIGITS.includes(event.key)) { event.preventDefault(); addDigit(event.key); }
    if (event.key === 'Backspace') { event.preventDefault(); removeDigit(); }
    if (event.key === 'Enter' && event.target === indicators.current) void submit(event);
  }

  async function submit(event) {
    event.preventDefault();
    if (pin.length !== 4 || disabled) return;
    setError(''); setBusy(true); setPin('');
    try { await unlockPin(pin); }
    catch (failure) {
      setError(failure.message || 'Unable to unlock. Try again or sign in with your password.');
      if (failure.code === 'quick_login_unavailable') setBlocked(true);
      else indicators.current?.focus({ preventScroll: true });
    } finally { setBusy(false); }
  }

  return (
    <main className="quick-login-page">
      <section className="quick-login-card" aria-labelledby="unlock-title">
        <div className="quick-login-brand">
          <img src="/salem-logo.png" alt="" width="52" height="52" />
          <p>Salem International Christian Centre</p>
        </div>
        <h1 className="display" id="unlock-title">Welcome Back</h1>
        <p className="quick-login-intro">Enter your 4-digit PIN to unlock your dashboard.</p>
        <form className="quick-login-fields" onSubmit={submit} onKeyDown={handleKey}>
          <div ref={indicators} className="quick-pin-indicators" role="group" aria-label="PIN entry" tabIndex={0}>
            {[0, 1, 2, 3].map(position => <span key={position} data-filled={position < pin.length} aria-hidden="true" />)}
            <span className="sr-only" role="status">{pin.length} of 4 digits entered</span>
          </div>
          {error && <Alert type="error" message={error} />}
          <div className="quick-pin-keypad" role="group" aria-label="Numeric keypad">
            {DIGITS.map(digit => (
              <button className={digit === '0' ? 'quick-pin-zero' : undefined} key={digit} type="button" disabled={disabled}
                onClick={() => addDigit(digit)}>{digit}</button>
            ))}
            <button type="button" disabled={disabled} aria-label="Delete last digit" onClick={removeDigit}><Delete size={20} aria-hidden="true" /></button>
          </div>
          <Btn full type="submit" disabled={blocked || pin.length !== 4} loading={busy}>{busy ? 'Unlocking…' : 'Unlock'}</Btn>
        </form>
        <div className="quick-login-links">
          <Link to="/login?password=1&pin=reset" state={state} aria-disabled={busy || undefined} onClick={event => { if (busy) event.preventDefault(); }}>Forgot PIN?</Link>
          <Link to="/login?password=1" state={state} aria-disabled={busy || undefined} onClick={event => { if (busy) event.preventDefault(); }}>Sign in with Password</Link>
        </div>
      </section>
    </main>
  );
}
