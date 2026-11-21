import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { C } from '../../lib/theme';
import { getNotifications, markNotificationsRead } from '../../lib/db';

export default function NotificationBell({ onNavigate, compact = false }) {
  const [data, setData] = useState({ items: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const load = useCallback(() => getNotifications().then(setData).catch(() => {}), []);
  useEffect(() => { load(); const t = setInterval(load, 60000); const v = () => document.visibilityState === 'visible' && load(); document.addEventListener('visibilitychange', v); return () => { clearInterval(t); document.removeEventListener('visibilitychange', v); }; }, [load]);
  useEffect(() => {
    if (!open) return undefined;
    const away = e => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = e => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const toggle = async () => { const next = !open; setOpen(next); if (next && data.unread) { await markNotificationsRead(); setTimeout(load, 1500); } };
  const ago = v => { const s = (Date.now() - Date.parse(`${String(v).replace(' ', 'T')}Z`)) / 1000; return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`; };
  return (
    <div ref={box} className={compact ? 'bishop-bell' : undefined} style={{ position: 'relative' }}>
      <button type="button" onClick={toggle} aria-label={`Notifications${data.unread ? `, ${data.unread} unread` : ''}`} aria-expanded={open} aria-haspopup="true"
        style={{ position: 'relative', width: 40, height: 40, borderRadius: 10, border: `1px solid ${C.border}`, background: C.cardBg, color: C.textSecondary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Bell size={compact ? 21 : 17} aria-hidden />
        {data.unread > 0 && <span aria-hidden style={{ position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: C.danger, color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{data.unread > 9 ? '9+' : data.unread}</span>}
      </button>
      {open && (
        <div role="menu" aria-label="Notifications" style={{ position: 'absolute', right: 0, top: 48, width: 'min(360px, 88vw)', background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: 'var(--shadow-2)', zIndex: 900, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, fontWeight: 600, fontSize: 14, color: C.textPrimary }}>Notifications</div>
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {data.items.length === 0 && <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: C.textMuted }}>You’re all caught up.</div>}
            {data.items.map(n => (
              <button key={n.id} role="menuitem" type="button" onClick={() => { setOpen(false); if (n.link) onNavigate(n.link); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px', background: n.read_at ? 'transparent' : `${C.info}12`, border: 'none', borderBottom: `1px solid ${C.border}`, color: C.textPrimary }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, fontWeight: 600 }}><span>{n.title}</span><span style={{ color: C.textMuted, fontWeight: 400, flexShrink: 0 }}>{ago(n.created_at)}</span></div>
                {n.body && <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>{n.body}</div>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
