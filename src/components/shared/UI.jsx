// src/components/shared/UI.jsx
// Shared building blocks. Every export keeps its v3 props, so existing screens keep working;
// new optional props add accessibility, loading states, sorting/paging and CSV export.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle, Info, XCircle, X, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { C } from '../../lib/theme';

export { C };

const label12 = { fontSize: 12, fontWeight: 600, color: C.textSecondary, letterSpacing: '0.01em' };

export function StatCard({ label, value, sub, icon, color = C.blue, onClick, loading }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`sicc-stat-card${onClick ? ' is-clickable' : ''}`} onClick={onClick}
      style={{ background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px', cursor: onClick ? 'pointer' : 'default', position: 'relative', overflow: 'hidden', textAlign: 'left', width: '100%', color: 'inherit', font: 'inherit', boxShadow: 'var(--shadow-1)' }}>
      <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginTop: 4, gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: C.textMuted, fontWeight: 600, marginBottom: 6 }}>{label}</div>
          {loading ? <div className="skeleton" style={{ width: 70, height: 30 }} /> : <div className="display" style={{ fontSize: 34, color: C.textPrimary, lineHeight: 1 }}>{value ?? '–'}</div>}
          {sub && <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 6, fontWeight: 500 }}>{sub}</div>}
        </div>
        {icon && <div aria-hidden style={{ width: 40, height: 40, borderRadius: 10, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color }}>{icon}</div>}
      </div>
    </Tag>
  );
}

export function Panel({ children, title, action, style: s }) {
  return (
    <section className="sicc-panel" aria-label={typeof title === 'string' ? title : undefined} style={{ background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 14, padding: '18px 20px', minWidth: 0, boxShadow: 'var(--shadow-1)', ...s }}>
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: C.textPrimary, margin: 0 }}>
            <span aria-hidden style={{ width: 3, height: 15, background: C.gold, borderRadius: 2 }} />{title}
          </h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function SectionTitle({ children, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14 }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: C.textPrimary, margin: 0 }}>
        <span aria-hidden style={{ width: 3, height: 15, background: C.gold, borderRadius: 2 }} />{children}
      </h2>
      {action}
    </div>
  );
}

export function Badge({ label, color = C.blue, bg }) {
  return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, background: bg || `${color}1F`, color, fontSize: 12, fontWeight: 600, border: `1px solid ${color}38`, whiteSpace: 'nowrap' }}>{label}</span>;
}

export function StatusBadge({ status }) {
  const map = {
    'New Convert': { color: C.blue, bg: C.blueLight },
    'Active Member': { color: C.success, bg: C.successBg },
    'Worker': { color: C.gold, bg: '#FDF6E7' },
    'Evangelism Contact': { color: C.danger, bg: C.dangerBg },
    'Completed': { color: C.success, bg: C.successBg },
    'In Progress': { color: C.warning, bg: C.warningBg },
    'No Response': { color: C.danger, bg: C.dangerBg },
    'Active': { color: C.success, bg: C.successBg },
  };
  const s = map[status] || { color: C.textSecondary, bg: C.pageBg };
  return <Badge label={status} color={s.color} bg={s.bg} />;
}

export function Avatar({ initials, color = C.blue, size = 38 }) {
  return <div style={{ width: size, height: size, borderRadius: Math.round(size * 0.26), background: `${color}18`, border: `1px solid ${color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.33, fontWeight: 500, color, flexShrink: 0 }}>{initials}</div>;
}

export function InfoRow({ icon, label, value, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: `0.5px solid ${C.border}` }}>
      <span style={{ color: C.textMuted, marginTop: 1, flexShrink: 0, display: 'flex', alignItems: 'center' }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 13, color: color || C.textPrimary, fontWeight: 500 }}>{value || 'N/A'}</div>
      </div>
    </div>
  );
}

export function ActivityFeed({ items, limit = 10 }) {
  if (!items?.length) return <div style={{ color: C.textMuted, fontSize: 13, padding: '16px 0', textAlign: 'center' }}>No recent activity.</div>;
  return (
    <div>
      {items.slice(0, limit).map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, padding: '9px 0', borderBottom: `0.5px solid ${C.border}` }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: C.gold, marginTop: 5, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: C.textPrimary }}><strong style={{ fontWeight: 500 }}>{item.user_name}</strong><span style={{ color: C.textSecondary }}>: {item.action}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
              <span style={{ fontSize: 12, color: C.textMuted }}>{item.detail}</span>
              <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 12 }}>{new Date(item.created_at).toLocaleString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search...' }) {
  return (
    <div style={{ position: 'relative' }}>
      <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: C.textMuted, display: 'flex' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      </span>
      <input aria-label={placeholder} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{ width: '100%', padding: '9px 12px 9px 34px', background: C.inputBg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.textPrimary, fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
    </div>
  );
}

export function FilterSelect({ value, onChange, options, placeholder = 'Filter...' }) {
  return (
    <select aria-label={placeholder} value={value} onChange={e => onChange(e.target.value)} style={{ padding: '9px 12px', background: C.inputBg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.textPrimary, fontSize: 13, outline: 'none', fontFamily: 'inherit' }}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
    </select>
  );
}

export function Grid({ children, cols = 'repeat(auto-fit, minmax(200px, 1fr))', gap = 14 }) {
  return <div className="sicc-grid" style={{ display: 'grid', gridTemplateColumns: cols, gap, minWidth: 0 }}>{children}</div>;
}


export function Btn({ children, onClick, color = C.blue, variant = 'solid', size = 'md', disabled, type = 'button', loading, title, ariaLabel, full, style }) {
  const pad = size === 'sm' ? '6px 12px' : size === 'lg' ? '13px 28px' : '9px 18px';
  const fs = size === 'sm' ? 12 : size === 'lg' ? 14 : 13;
  const off = disabled || loading;
  const base = { padding: pad, minHeight: size === 'sm' ? 32 : 40, borderRadius: 10, fontSize: fs, fontWeight: 600, opacity: off ? 0.55 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: `1px solid ${color}`, width: full ? '100%' : undefined, ...style };
  const variants = {
    solid: { ...base, background: color, color: color === C.gold ? '#0C1B3A' : '#fff' },
    outline: { ...base, background: 'transparent', color: color === C.gold ? C.goldText : color },
    ghost: { ...base, background: `${color}14`, color: color === C.gold ? C.goldText : color, border: `1px solid ${color}26` },
  };
  return (
    <button type={type} className="sicc-btn" style={variants[variant] || variants.solid} onClick={onClick} disabled={off} title={title} aria-label={ariaLabel} aria-busy={loading || undefined}>
      {loading && <Spinner size={14} color="currentColor" />}{children}
    </button>
  );
}

function Field({ id, label, required, hint, error, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && <label htmlFor={id} style={label12}>{label}{required && <span aria-hidden style={{ color: C.danger, marginLeft: 3 }}>*</span>}</label>}
      {children}
      {error ? <span id={`${id}-msg`} role="alert" style={{ fontSize: 12, color: C.danger }}>{error}</span> : hint && <span id={`${id}-msg`} style={{ fontSize: 12, color: C.textMuted }}>{hint}</span>}
    </div>
  );
}
const controlStyle = (error, extra) => ({ width: '100%', minHeight: 42, padding: '10px 12px', background: C.inputBg, border: `1px solid ${error ? C.danger : C.border}`, borderRadius: 10, color: C.textPrimary, fontSize: 14, outline: 'none', ...extra });

export function Input({ label, value, onChange, type = 'text', placeholder, required, hint, error, disabled, autoComplete, inputMode, maxLength, min, max, name, autoFocus, id: idProp }) {
  const auto = useId(); const id = idProp || auto;
  return (
    <Field id={id} label={label} required={required} hint={hint} error={error}>
      <input id={id} name={name} type={type} value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} required={required} disabled={disabled}
        autoComplete={autoComplete} inputMode={inputMode} maxLength={maxLength} min={min} max={max} autoFocus={autoFocus} aria-invalid={error ? true : undefined} aria-describedby={error || hint ? `${id}-msg` : undefined} style={controlStyle(error)} />
    </Field>
  );
}

export function Select({ label, value, onChange, options, required, hint, error, disabled, placeholder = 'Select an option', id: idProp }) {
  const auto = useId(); const id = idProp || auto;
  return (
    <Field id={id} label={label} required={required} hint={hint} error={error}>
      <select id={id} value={value ?? ''} onChange={e => onChange(e.target.value)} required={required} disabled={disabled} aria-invalid={error ? true : undefined} style={controlStyle(error, { color: value ? C.textPrimary : C.textMuted, cursor: 'pointer' })}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
      </select>
    </Field>
  );
}

export function Textarea({ label, value, onChange, placeholder, rows = 4, required, hint, error, maxLength, id: idProp }) {
  const auto = useId(); const id = idProp || auto;
  return (
    <Field id={id} label={label} required={required} hint={hint} error={error}>
      <textarea id={id} value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows} required={required} maxLength={maxLength} aria-invalid={error ? true : undefined} style={controlStyle(error, { resize: 'vertical', lineHeight: 1.5 })} />
    </Field>
  );
}

export function Checkbox({ label, checked, onChange, hint, error }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: C.textPrimary, cursor: 'pointer', lineHeight: 1.45 }}>
        <input id={id} type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1, accentColor: C.info, flexShrink: 0 }} />
        <span>{label}</span>
      </label>
      {hint && !error && <div style={{ fontSize: 12, color: C.textMuted, marginLeft: 28, marginTop: 3 }}>{hint}</div>}
      {error && <div role="alert" style={{ fontSize: 12, color: C.danger, marginLeft: 28, marginTop: 3 }}>{error}</div>}
    </div>
  );
}

const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input:not([disabled]),select,[tabindex]:not([tabindex="-1"])';

export function Modal({ title, onClose, children, width = 520, footer }) {
  const ref = useRef(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement;
    const node = ref.current;
    const first = node?.querySelector('input,select,textarea') || node?.querySelector(FOCUSABLE);
    first?.focus();
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current?.(); return; }
      if (e.key !== 'Tab' || !node) return;
      const items = [...node.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
      if (!items.length) return;
      const a = items[0]; const z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; previous?.focus?.(); };
  }, []);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(7,14,28,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16, backdropFilter: 'blur(4px)' }} onMouseDown={e => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 16, width: '100%', maxWidth: width, maxHeight: '90vh', overflow: 'auto', boxShadow: 'var(--shadow-2)', animation: 'rise .18s ease-out' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, background: C.cardBg, zIndex: 1 }}>
          <h2 id={titleId} style={{ fontSize: 17, fontWeight: 600, color: C.textPrimary }}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close dialog" style={{ background: 'none', border: 'none', color: C.textMuted, padding: 6, borderRadius: 8, display: 'flex' }}><X size={18} /></button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
        {footer && <div style={{ padding: '12px 20px 18px', display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap', borderTop: `1px solid ${C.border}` }}>{footer}</div>}
      </div>
    </div>
  );
}

// Confirmation with an optional mandatory reason (used for locked records, deletions, erasures).
export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger, requireReason, reasonLabel = 'Reason', minReason = 8, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const blocked = requireReason && reason.trim().length < minReason;
  const go = async () => { setBusy(true); try { await onConfirm(reason.trim()); } finally { setBusy(false); } };
  return (
    <Modal title={title} onClose={onCancel} width={460} footer={<><Btn variant="outline" color={C.textSecondary} onClick={onCancel}>Cancel</Btn><Btn color={danger ? C.danger : C.info} onClick={go} disabled={blocked} loading={busy}>{confirmLabel}</Btn></>}>
      <p style={{ fontSize: 14, color: C.textSecondary, lineHeight: 1.55, marginBottom: requireReason ? 14 : 0 }}>{message}</p>
      {requireReason && <Textarea label={reasonLabel} value={reason} onChange={setReason} rows={3} hint={`At least ${minReason} characters. This is saved in the audit log.`} />}
    </Modal>
  );
}

const csvCell = v => { let s = v === null || v === undefined ? '' : String(v); if (/^[=+\-@]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function DataTable({ columns, rows, emptyText = 'No records found', onRowClick, loading, pageSize = 25, exportName, caption, dense }) {
  const [sort, setSort] = useState(null);
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    if (!sort) return rows || [];
    const col = columns.find(c => c.key === sort.key);
    const val = r => (col?.sortValue ? col.sortValue(r) : r[sort.key]);
    return [...(rows || [])].sort((a, b) => {
      const x = val(a); const y = val(b);
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sort, columns]);
  useEffect(() => { setPage(0); }, [rows?.length, sort]);
  const total = sorted.length;
  const pages = pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const visible = pageSize ? sorted.slice(page * pageSize, (page + 1) * pageSize) : sorted;

  const toggleSort = key => setSort(s => (s?.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' }));
  const exportCsv = () => {
    const cols = columns.filter(c => c.label && c.key !== 'actions');
    const body = sorted.map(r => cols.map(c => csvCell(c.exportValue ? c.exportValue(r) : (typeof r[c.key] === 'object' ? '' : r[c.key]))).join(','));
    const blob = new Blob([`\uFEFF${[cols.map(c => csvCell(c.label)).join(','), ...body].join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${exportName}-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.appendChild(a); a.click(); a.remove();
  };

  if (loading) return <div aria-busy="true" style={{ display: 'grid', gap: 8 }}>{[0, 1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 40 }} />)}</div>;
  if (!total) return <div style={{ textAlign: 'center', padding: '36px 16px', color: C.textMuted, fontSize: 14 }}>{emptyText}</div>;
  const pad = dense ? '8px 12px' : '12px 14px';
  return (
    <div>
      {exportName && <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}><Btn size="sm" variant="ghost" color={C.textSecondary} onClick={exportCsv}><Download size={13} aria-hidden /> Export CSV</Btn></div>}
      <div className="sicc-table-wrap" style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 10 }}>
        <div className="sicc-mobile-cards" aria-label={caption || 'Table records'}>
          {visible.map((row, i) => <div key={row.id ?? i} className="sicc-mobile-card" role={onRowClick ? 'button' : undefined} tabIndex={onRowClick ? 0 : undefined} onClick={onRowClick ? () => onRowClick(row) : undefined} onKeyDown={onRowClick ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(row); } } : undefined}>
            <dl>{columns.filter(c => c.key !== 'actions').map(c => <div key={c.key}><dt>{c.label}</dt><dd>{c.render ? c.render(row[c.key], row) : (row[c.key] ?? '–')}</dd></div>)}</dl>
            {columns.filter(c => c.key === 'actions').map(c => <div key={c.key}>{c.render ? c.render(row[c.key], row) : null}</div>)}
          </div>)}
        </div>
        <table className="sicc-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>{columns.map(c => {
              const active = sort?.key === c.key;
              const sortable = c.sortable !== false && c.key !== 'actions' && c.label;
              return (
                <th key={c.key} scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined} style={{ padding: pad, textAlign: 'left', fontSize: 12, fontWeight: 600, color: C.textSecondary, background: C.inputBg, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap', width: c.width }}>
                  {sortable ? <button type="button" onClick={() => toggleSort(c.key)} style={{ background: 'none', border: 'none', color: 'inherit', font: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0 }}>{c.label}{active && (sort.dir === 'asc' ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />)}</button> : c.label}
                </th>
              );
            })}</tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={row.id ?? i} onClick={onRowClick ? () => onRowClick(row) : undefined} tabIndex={onRowClick ? 0 : undefined} role={onRowClick ? 'button' : undefined}
                onKeyDown={onRowClick ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(row); } } : undefined}
                style={{ cursor: onRowClick ? 'pointer' : 'default', borderBottom: i < visible.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                {columns.map(c => <td key={c.key} style={{ padding: pad, color: C.textPrimary, verticalAlign: 'middle' }}>{c.render ? c.render(row[c.key], row) : (row[c.key] ?? '–')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageSize > 0 && total > pageSize && (
        <nav className="no-print" aria-label="Table pages" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10, fontSize: 12, color: C.textSecondary, flexWrap: 'wrap' }}>
          <span>{page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} of {total}</span>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Btn size="sm" variant="outline" color={C.textSecondary} disabled={page === 0} onClick={() => setPage(p => p - 1)} ariaLabel="Previous page"><ChevronLeft size={14} aria-hidden /></Btn>
            <span>Page {page + 1} of {pages}</span>
            <Btn size="sm" variant="outline" color={C.textSecondary} disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)} ariaLabel="Next page"><ChevronRight size={14} aria-hidden /></Btn>
          </span>
        </nav>
      )}
    </div>
  );
}


export function Alert({ type = 'info', message, onDismiss }) {
  const map = {
    info: { color: C.info, bg: C.infoBg, icon: <Info size={16} /> },
    success: { color: C.success, bg: C.successBg, icon: <CheckCircle size={16} /> },
    warning: { color: C.warning, bg: C.warningBg, icon: <AlertCircle size={16} /> },
    error: { color: C.danger, bg: C.dangerBg, icon: <XCircle size={16} /> },
  };
  map.danger = map.error;
  const s = map[type] || map.info;
  return (
    <div role={type === 'error' || type === 'warning' ? 'alert' : 'status'} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 14px', background: s.bg, border: `1px solid ${s.color}40`, borderRadius: 10, color: s.color, fontSize: 13, lineHeight: 1.45 }}>
      <span aria-hidden style={{ marginTop: 1, flexShrink: 0 }}>{s.icon}</span>
      <span style={{ flex: 1, color: C.textPrimary }}>{message}</span>
      {onDismiss && <button type="button" onClick={onDismiss} aria-label="Dismiss message" style={{ background: 'none', border: 'none', color: s.color, display: 'flex', padding: 2 }}><X size={14} /></button>}
    </div>
  );
}

export function Spinner({ size = 20, color = C.blue }) {
  return <span role="status" aria-label="Loading" style={{ display: 'inline-block', width: size, height: size, border: `2px solid ${color}33`, borderTopColor: color, borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />;
}

export function Skeleton({ w = '100%', h = 16, style }) { return <div className="skeleton" aria-hidden style={{ width: w, height: h, ...style }} />; }

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading page" style={{ display: 'grid', gap: 16 }}>
      <Skeleton w={220} h={28} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>{[0, 1, 2, 3].map(i => <Skeleton key={i} h={92} style={{ borderRadius: 14 }} />)}</div>
      <Skeleton h={260} style={{ borderRadius: 14 }} />
    </div>
  );
}

export function EmptyState({ icon, title, description, action }) {
  return (
    <div style={{ textAlign: 'center', padding: '44px 20px', color: C.textSecondary }}>
      {icon && <div aria-hidden style={{ width: 56, height: 56, borderRadius: 16, background: C.inputBg, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', color: C.textMuted }}>{icon}</div>}
      <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary, marginBottom: 6 }}>{title}</div>
      {description && <div style={{ fontSize: 13, maxWidth: 380, margin: '0 auto', lineHeight: 1.5 }}>{description}</div>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
      <div>
        <h1 className="display" style={{ fontSize: 32, color: C.textPrimary, lineHeight: 1.1 }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 14, color: C.textSecondary, marginTop: 4 }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
