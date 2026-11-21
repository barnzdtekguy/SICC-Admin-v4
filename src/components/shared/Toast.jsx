import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';
import { C } from '../../lib/theme';

const ToastContext = createContext({ push: () => {}, success: () => {}, error: () => {}, info: () => {} });

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const id = useRef(0);
  const dismiss = useCallback(key => setItems(list => list.filter(t => t.key !== key)), []);
  const push = useCallback((type, message, { duration = 5000, action } = {}) => {
    const key = ++id.current;
    setItems(list => [...list.slice(-3), { key, type, message, action }]);
    if (duration) setTimeout(() => dismiss(key), duration);
    return key;
  }, [dismiss]);
  const api = useMemo(() => ({ push, success: (m, o) => push('success', m, o), error: (m, o) => push('error', m, { duration: 8000, ...o }), info: (m, o) => push('info', m, o), dismiss }), [push, dismiss]);
  const icon = { success: <CheckCircle size={18} />, error: <XCircle size={18} />, info: <Info size={18} /> };
  const color = { success: C.success, error: C.danger, info: C.info };
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" role="region" aria-label="Notifications" aria-live="polite" style={{ position: 'fixed', bottom: 20, right: 20, left: 20, zIndex: 3000, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10, pointerEvents: 'none' }}>
        {items.map(t => (
          <div key={t.key} role={t.type === 'error' ? 'alert' : 'status'} style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 10, maxWidth: 420, width: 'fit-content', background: C.cardBg, color: C.textPrimary, border: `1px solid ${C.border}`, borderLeft: `4px solid ${color[t.type]}`, borderRadius: 12, padding: '12px 14px', boxShadow: 'var(--shadow-2)', fontSize: 14, animation: 'toast-in .2s ease-out' }}>
            <span aria-hidden style={{ color: color[t.type], display: 'flex' }}>{icon[t.type]}</span>
            <span style={{ flex: 1 }}>{t.message}</span>
            {t.action && <button type="button" onClick={() => { t.action.onClick(); dismiss(t.key); }} style={{ background: 'none', border: 'none', color: C.info, fontWeight: 600, fontSize: 13, padding: '4px 6px' }}>{t.action.label}</button>}
            <button type="button" onClick={() => dismiss(t.key)} aria-label="Dismiss" style={{ background: 'none', border: 'none', color: C.textMuted, display: 'flex', padding: 2 }}><X size={14} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);
