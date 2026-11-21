import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { applyTheme, getStoredMode, storeMode } from '../lib/theme';

const ThemeContext = createContext({ mode: 'light', effective: 'light', setMode: () => {} });

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(getStoredMode);
  const [effective, setEffective] = useState(() => applyTheme(getStoredMode()));

  const setMode = useCallback(next => { storeMode(next); setModeState(next); setEffective(applyTheme(next)); }, []);

  useEffect(() => {
    if (mode !== 'system') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setEffective(applyTheme('system'));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  const value = useMemo(() => ({ mode, effective, setMode }), [mode, effective, setMode]);
  // Re-mount the tree when the palette changes so every inline style picks up the new tokens.
  return <ThemeContext.Provider value={value}><div key={effective} style={{ display: 'contents' }}>{children}</div></ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
