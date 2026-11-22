import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft, User, Compass, Moon, LogOut } from 'lucide-react';
import { C } from '../../lib/theme';
import { searchEverything } from '../../lib/db';

// Ctrl/Cmd+K: jump to any page, find a member, or run a quick action.
export default function CommandPalette({ open, onClose, pages, onGo, onOpenMember, actions }) {
  const [q, setQ] = useState('');
  const [members, setMembers] = useState([]);
  const [index, setIndex] = useState(0);
  const input = useRef(null);

  useEffect(() => { if (open) { setQ(''); setMembers([]); setIndex(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);
  useEffect(() => {
    if (q.trim().length < 2) { setMembers([]); return undefined; }
    const t = setTimeout(() => searchEverything(q.trim()).then(r => setMembers(r.members || [])).catch(() => setMembers([])), 220);
    return () => clearTimeout(t);
  }, [q]);

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = s => !needle || s.toLowerCase().includes(needle);
    return [
      ...pages.filter(p => match(p.label)).map(p => ({ id: `p-${p.key}`, icon: <Compass size={15} />, label: p.label, hint: 'Go to page', run: () => onGo(p.key) })),
      ...members.map(m => ({ id: `m-${m.id}`, icon: <User size={15} />, label: `${m.first_name} ${m.last_name}`, hint: [m.status, m.kdf_area || m.department].filter(Boolean).join(' · '), run: () => onOpenMember(m.id) })),
      ...actions.filter(a => match(a.label)).map(a => ({ id: `a-${a.label}`, icon: a.icon === 'theme' ? <Moon size={15} /> : <LogOut size={15} />, label: a.label, hint: 'Action', run: a.run })),
    ].slice(0, 12);
  }, [q, members, pages, actions, onGo, onOpenMember]);

  useEffect(() => { setIndex(0); }, [q, members.length]);
  if (!open) return null;
  const choose = item => { onClose(); item?.run(); };
  const onKey = e => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(items[index]); }
  };
  return (
    <div role="presentation" onMouseDown={e => e.target === e.currentTarget && onClose()} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'var(--floating-dim)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '12vh', paddingInline: 16 }}>
      <div role="dialog" aria-modal="true" aria-label="Quick search" onKeyDown={onKey} style={{ width: '100%', maxWidth: 560, background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 16, boxShadow: 'var(--shadow-2)', overflow: 'hidden', animation: 'rise .15s ease-out' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${C.border}` }}>
          <Search size={17} aria-hidden style={{ color: C.textMuted }} />
          <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder="Search pages, members, actions…" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="cmd-list" aria-activedescendant={items[index] ? `cmd-${items[index].id}` : undefined}
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: C.textPrimary, fontSize: 16 }} />
          <kbd style={{ fontSize: 11, color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 6, padding: '2px 6px' }}>Esc</kbd>
        </div>
        <ul id="cmd-list" role="listbox" style={{ listStyle: 'none', maxHeight: 360, overflowY: 'auto', padding: 6 }}>
          {items.length === 0 && <li style={{ padding: 18, color: C.textMuted, fontSize: 14, textAlign: 'center' }}>No matches</li>}
          {items.map((it, i) => (
            <li key={it.id} id={`cmd-${it.id}`} role="option" aria-selected={i === index} onMouseMove={() => setIndex(i)} onClick={() => choose(it)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, cursor: 'pointer', background: i === index ? C.hover : 'transparent', color: C.textPrimary }}>
              <span aria-hidden style={{ color: C.textSecondary, display: 'flex' }}>{it.icon}</span>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{it.label}</span>
              <span style={{ fontSize: 12, color: C.textMuted }}>{it.hint}</span>
              {i === index && <CornerDownLeft size={13} aria-hidden style={{ color: C.textMuted }} />}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
