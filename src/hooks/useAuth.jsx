import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { apiRequest } from '../lib/api';
import { flushQueue } from '../lib/offlineQueue';
import { isRedRole } from '../data/constants';
import { detectQuickLogin, unlockWithPin, verifyQuickMfa } from '../lib/quickLogin';

const AuthContext = createContext(null);
const QUIET = ['Please sign in to continue.', 'Your session has expired. Please sign in again.'];
const tourKey = id => `sicc:welcome-tour:v1:${id}`;

function tourSeenHere(id) {
  try { return localStorage.getItem(tourKey(id)) === 'seen'; }
  catch { return false; }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [restrictions, setRestrictions] = useState([]);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [mfaChallenge, setMfaChallenge] = useState(null);
  const [quickLogin, setQuickLogin] = useState(null);
  const [quickAvailable, setQuickAvailable] = useState(false);
  const [tourPending, setTourPending] = useState(false);
  const [dismissedTourFor, setDismissedTourFor] = useState(null);
  const authedRef = useRef(false);
  const profileId = profile?.id;
  const tourSeen = profileId && (dismissedTourFor === profileId || tourSeenHere(profileId));
  const showWelcomeTour = Boolean(profileId && tourPending && !tourSeen);

  const applySession = useCallback(session => {
    setUser(session.user); setProfile(session.profile); setRestrictions(session.restrictions || []); setSessionInfo(session.session || null);
    setTourPending(session.welcome_tour_pending === true);
    setQuickLogin(session.quick_login || null);
    authedRef.current = true;
  }, []);
  const clearSession = useCallback(() => { setUser(null); setProfile(null); setRestrictions([]); setSessionInfo(null); setMfaChallenge(null); setQuickLogin(null); setTourPending(false); authedRef.current = false; }, []);
  const checkQuickLogin = useCallback(async () => setQuickAvailable(await detectQuickLogin()), []);
  const dismissWelcomeTour = useCallback(() => {
    if (!profileId) return;
    try { localStorage.setItem(tourKey(profileId), 'seen'); } catch { /* browser storage is unavailable */ }
    setDismissedTourFor(profileId);
  }, [profileId]);

  // Save a dismissal to the account, including one made while the device was offline.
  useEffect(() => {
    if (!tourPending || !tourSeen || restrictions.length) return undefined;
    let active = true;
    let saving = false;
    const save = async () => {
      if (saving) return;
      saving = true;
      try {
        await apiRequest('/auth/welcome-tour', { method: 'POST', body: { account_id: profileId } });
        if (active) setTourPending(false);
      } catch { /* retry on reconnect or the next sign-in */ }
      finally { saving = false; }
    };
    save();
    window.addEventListener('online', save);
    return () => { active = false; window.removeEventListener('online', save); };
  }, [profileId, restrictions.length, tourPending, tourSeen]);

  useEffect(() => {
    let active = true;
    apiRequest('/auth/me')
      .then(session => { if (active) applySession(session); })
      .catch(async error => {
        if (error.status === 401) {
          const available = await detectQuickLogin();
          if (active) setQuickAvailable(available);
        } else if (!QUIET.includes(error.message)) console.error('Unable to restore the SICC Admin session:', error);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [applySession]);

  // Any API call that comes back 401 (revoked, expired, idle) returns the person to sign-in with a reason.
  useEffect(() => {
    const onUnauthorized = event => {
      if (!authedRef.current) return;
      setNotice(event.detail || 'Your session has ended. Please sign in again.');
      clearSession();
      checkQuickLogin();
    };
    window.addEventListener('sicc:unauthorized', onUnauthorized);
    return () => window.removeEventListener('sicc:unauthorized', onUnauthorized);
  }, [clearSession, checkQuickLogin]);

  // Send any attendance that was saved offline once we are signed in and online.
  useEffect(() => {
    if (!profile || restrictions.length) return undefined;
    const onOnline = () => flushQueue(isRedRole(profile.role) ? profile.id : null);
    onOnline();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [profile, restrictions.length]);

  const login = async (identifier, password, _identifierType, rememberMe = false) => {
    try {
      const value = String(identifier || '').trim();
      if (!value) return { success: false, error: 'Please enter your email or username.' };
      const result = await apiRequest('/auth/login', { method: 'POST', body: { identifier: value, password, rememberMe } });
      if (result.mfa_required) { setMfaChallenge({ token: result.challenge, quick: false }); return { success: false, mfaRequired: true }; }
      setNotice(''); applySession(result);
      return { success: true };
    } catch (error) {
      return { success: false, error: error?.message || 'Unable to sign in. Please try again.' };
    }
  };

  const unlockPin = async pin => {
    const result = await unlockWithPin(pin);
    setNotice('');
    if (result.mfa_required) setMfaChallenge({ token: result.challenge, quick: true });
    else applySession(result);
  };

  const verifyMfa = async code => {
    try {
      const session = mfaChallenge.quick
        ? await verifyQuickMfa(mfaChallenge.token, code)
        : await apiRequest('/auth/mfa/verify', { method: 'POST', body: { challenge: mfaChallenge.token, code } });
      setMfaChallenge(null); setNotice(''); applySession(session);
      return { success: true };
    } catch (error) {
      if (error.code === 'quick_login_unavailable') {
        setQuickAvailable(false); setNotice(error.message); setMfaChallenge(null);
      } else if (error.status === 401 && /expired/i.test(error.message)) setMfaChallenge(null);
      return { success: false, error: error?.message || 'Unable to verify the code.' };
    }
  };

  const refresh = useCallback(async () => { try { applySession(await apiRequest('/auth/me')); } catch { /* handled by 401 event */ } }, [applySession]);

  const logout = useCallback(async (reason = '') => {
    try { await apiRequest('/auth/logout', { method: 'POST' }); } catch { /* already signed out */ }
    clearSession(); setNotice(reason);
    checkQuickLogin();
  }, [clearSession, checkQuickLogin]);

  // Idle sign-out on the device (the server enforces it too).
  useEffect(() => {
    if (!profile || !sessionInfo || sessionInfo.remember) return undefined;
    const limit = (sessionInfo.idle_minutes || 120) * 60000;
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const events = ['pointerdown', 'keydown', 'scroll', 'visibilitychange'];
    events.forEach(e => window.addEventListener(e, bump, { passive: true }));
    const timer = setInterval(() => { if (Date.now() - last > limit) logout('You were signed out after a period of inactivity.'); }, 30000);
    return () => { events.forEach(e => window.removeEventListener(e, bump)); clearInterval(timer); };
  }, [profile, sessionInfo, logout]);

  const value = useMemo(() => ({
    user, profile, restrictions, sessionInfo, notice, mfaChallenge, loading, quickLogin, quickAvailable,
    showWelcomeTour, dismissWelcomeTour,
    isAuthenticated: !!user && !!profile,
    login, unlockPin, verifyMfa, cancelMfa: () => setMfaChallenge(null), logout, refresh, applySession, clearNotice: () => setNotice(''),
  }), [user, profile, restrictions, sessionInfo, notice, mfaChallenge, loading, logout, refresh, applySession, showWelcomeTour, dismissWelcomeTour, quickLogin, quickAvailable]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }
