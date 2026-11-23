import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { apiRequest } from '../lib/api';
import { flushQueue } from '../lib/offlineQueue';
import { isRedRole } from '../data/constants';

const AuthContext = createContext(null);
const QUIET = ['Please sign in to continue.', 'Your session has expired. Please sign in again.'];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [restrictions, setRestrictions] = useState([]);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [mfaChallenge, setMfaChallenge] = useState(null);
  const authedRef = useRef(false);

  const applySession = useCallback(session => {
    setUser(session.user); setProfile(session.profile); setRestrictions(session.restrictions || []); setSessionInfo(session.session || null);
    authedRef.current = true;
  }, []);
  const clearSession = useCallback(() => { setUser(null); setProfile(null); setRestrictions([]); setSessionInfo(null); setMfaChallenge(null); authedRef.current = false; }, []);

  useEffect(() => {
    let active = true;
    apiRequest('/auth/me')
      .then(session => { if (active) applySession(session); })
      .catch(error => { if (!QUIET.includes(error.message) && error.status !== 401) console.error('Unable to restore the SICC Admin session:', error); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [applySession]);

  // Any API call that comes back 401 (revoked, expired, idle) returns the person to sign-in with a reason.
  useEffect(() => {
    const onUnauthorized = event => { if (authedRef.current) { setNotice(event.detail || 'Your session has ended. Please sign in again.'); clearSession(); } };
    window.addEventListener('sicc:unauthorized', onUnauthorized);
    return () => window.removeEventListener('sicc:unauthorized', onUnauthorized);
  }, [clearSession]);

  // Send any attendance that was saved offline once we are signed in and online.
  useEffect(() => {
    if (!profile || isRedRole(profile.role) || restrictions.length) return undefined;
    flushQueue();
    const onOnline = () => flushQueue();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [profile, restrictions.length]);

  const login = async (identifier, password, _identifierType, rememberMe = false) => {
    try {
      const value = String(identifier || '').trim();
      if (!value) return { success: false, error: 'Please enter your email or username.' };
      const result = await apiRequest('/auth/login', { method: 'POST', body: { identifier: value, password, rememberMe } });
      if (result.mfa_required) { setMfaChallenge(result.challenge); return { success: false, mfaRequired: true }; }
      setNotice(''); applySession(result);
      return { success: true };
    } catch (error) {
      return { success: false, error: error?.message || 'Unable to sign in. Please try again.' };
    }
  };

  const verifyMfa = async code => {
    try {
      const session = await apiRequest('/auth/mfa/verify', { method: 'POST', body: { challenge: mfaChallenge, code } });
      setMfaChallenge(null); setNotice(''); applySession(session);
      return { success: true };
    } catch (error) {
      if (error.status === 401 && /expired/i.test(error.message)) setMfaChallenge(null);
      return { success: false, error: error?.message || 'Unable to verify the code.' };
    }
  };

  const refresh = useCallback(async () => { try { applySession(await apiRequest('/auth/me')); } catch { /* handled by 401 event */ } }, [applySession]);

  const logout = useCallback(async (reason = '') => {
    try { await apiRequest('/auth/logout', { method: 'POST' }); } catch { /* already signed out */ }
    clearSession(); setNotice(reason);
  }, [clearSession]);

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
    user, profile, restrictions, sessionInfo, notice, mfaChallenge, loading,
    isAuthenticated: !!user && !!profile,
    login, verifyMfa, cancelMfa: () => setMfaChallenge(null), logout, refresh, applySession, clearNotice: () => setNotice(''),
  }), [user, profile, restrictions, sessionInfo, notice, mfaChallenge, loading, logout, refresh, applySession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }
