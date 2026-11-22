// src/components/shared/UI.jsx
// Shared building blocks. Every export keeps its v3 props, so existing screens keep working;
// new optional props add accessibility, loading states, sorting/paging and CSV export.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle, Info, XCircle, X, ArrowUp, ArrowDown, ChevronDown, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { C } from '../../lib/theme';
import FloatingCard from './FloatingCard';
import '../../styles/shared-ui.css';

export { C };

export function StatCard({ label, value, sub, icon, onClick, loading }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`sicc-stat-card${onClick ? ' is-clickable' : ''}`} onClick={onClick}>
      <div className="sicc-stat-content">
        <small>{label}</small>
        {loading ? <div className="skeleton" style={{ width: 70, height: 30 }} /> : <div className="display">{value ?? '–'}</div>}
        {sub && <small>{sub}</small>}
      </div>
      {icon && <span className="sicc-stat-icon" aria-hidden="true">{icon}</span>}
    </Tag>
  );
}

export function Panel({ children, title, action, style: s }) {
  return (
    <section className="sicc-panel" aria-label={typeof title === 'string' ? title : undefined} style={s}>
      {title && <SectionTitle action={action}>{title}</SectionTitle>}
      {children}
    </section>
  );
}

export function SectionTitle({ children, action }) {
  return (
    <div className="sicc-section-title">
      <h2>{children}</h2>
      {action}
    </div>
  );
}

const statusTone = color => color === C.success ? 'success' : color === C.danger ? 'danger' : color === C.warning ? 'warning' : undefined;

export function Badge({ label, color, bg }) {
  return <span className="sicc-badge" data-tone={statusTone(color) || (color === C.gold ? 'accent' : undefined)} style={bg ? { background: bg } : undefined}>{label}</span>;
}

const statusLabels = new Map([
  ['New Convert', 'New convert'], ['Active Member', 'Active member'], ['Evangelism Contact', 'Evangelism contact'],
  ['In Progress', 'In progress'], ['No Response', 'No response'],
]);

export function StatusBadge({ status }) {
  const map = {
    'Active Member': C.success,
    Worker: C.gold,
    Completed: C.success,
    'In Progress': C.warning,
    'No Response': C.danger,
    Active: C.success,
  };
  return <Badge label={statusLabels.get(status) || status} color={map[status]} />;
}

export function Avatar({ initials, size = 38 }) {
  return <span className="sicc-avatar" style={{ '--avatar-size': `${size}px` }}>{initials}</span>;
}

export function InfoRow({ icon, label, value, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: `0.5px solid ${C.border}` }}>
      <span style={{ color: C.textMuted, marginTop: 1, flexShrink: 0, display: 'flex', alignItems: 'center' }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 2 }}>{label}</div>
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
    <div className="sicc-search">
      <Search size={20} strokeWidth={1.75} aria-hidden="true" />
      <input className="sicc-control" aria-label={placeholder} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function FilterSelect({ value, onChange, options, placeholder = 'Filter...' }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  const selected = String(value ?? '');
  const choices = [{ value: '', label: placeholder }, ...options.map(option => ({
    value: String(option.value ?? option), label: statusLabels.get(option.label ?? option) || (option.label ?? option),
  }))];
  const current = choices.find(option => option.value === selected);
  return (
    <>
      <button ref={trigger} type="button" className="sicc-filter" aria-label={selected ? `${placeholder}: ${current?.label ?? selected}` : placeholder}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>
        <span>{current?.label || placeholder}</span><ChevronDown size={20} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open && (
        <FloatingCard id={id} title={placeholder} triggerRef={trigger} onClose={close} width={296} mobileSheet>
          <div className="floating-card-actions">
            {choices.map(option => (
              <button key={option.value} type="button" aria-pressed={option.value === selected}
                onClick={() => { if (option.value !== selected) onChange(option.value); close(); }}>
                <span>{option.label}</span>{option.value === selected && <CheckCircle size={20} strokeWidth={1.75} aria-hidden="true" />}
              </button>
            ))}
          </div>
        </FloatingCard>
      )}
    </>
  );
}

export function Grid({ children, cols = 'repeat(auto-fit, minmax(200px, 1fr))', gap = 14 }) {
  return <div className="sicc-grid" style={{ display: 'grid', gridTemplateColumns: cols, gap, minWidth: 0 }}>{children}</div>;
}


export function Btn({ children, onClick, color = C.blue, variant = 'solid', size = 'md', disabled, type = 'button', loading, title, ariaLabel, full, style }) {
  return (
    <button type={type} className="sicc-btn" data-variant={variant} data-size={size} data-tone={statusTone(color)} data-full={full || undefined}
      style={style} onClick={onClick} disabled={disabled || loading} title={title} aria-label={ariaLabel} aria-busy={loading || undefined}>
      {loading && <Spinner size={14} color="currentColor" />}{children}
    </button>
  );
}

function Field({ id, label, required, hint, error, children }) {
  return (
    <div className="sicc-field">
      {label && <label htmlFor={id}>{label}{required && <span aria-hidden="true"> *</span>}</label>}
      {children}
      {error ? <small id={`${id}-msg`} role="alert">{error}</small> : hint && <small id={`${id}-msg`}>{hint}</small>}
    </div>
  );
}
export function Input({ label, value, onChange, type = 'text', placeholder, required, hint, error, disabled, autoComplete, inputMode, maxLength, min, max, name, autoFocus, id: idProp }) {
  const auto = useId(); const id = idProp || auto;
  return (
    <Field id={id} label={label} required={required} hint={hint} error={error}>
      <input className="sicc-control" id={id} name={name} type={type} value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} required={required} disabled={disabled}
        autoComplete={autoComplete} inputMode={inputMode} maxLength={maxLength} min={min} max={max} autoFocus={autoFocus} aria-invalid={error ? true : undefined} aria-describedby={error || hint ? `${id}-msg` : undefined} />
    </Field>
  );
}

export function Select({ label, value, onChange, options, required, hint, error, disabled, placeholder = 'Select an option', id: idProp }) {
  const auto = useId(); const id = idProp || auto;
  return (
    <Field id={id} label={label} required={required} hint={hint} error={error}>
      <select className="sicc-control" id={id} value={value ?? ''} onChange={e => onChange(e.target.value)} required={required} disabled={disabled} aria-invalid={error ? true : undefined} aria-describedby={error || hint ? `${id}-msg` : undefined} aria-label={!label ? placeholder : undefined}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{statusLabels.get(o.label ?? o) || (o.label ?? o)}</option>)}
      </select>
    </Field>
  );
}

export function Textarea({ label, value, onChange, placeholder, rows = 4, required, hint, error, maxLength, id: idProp }) {
  const auto = useId(); const id = idProp || auto;
  return (
    <Field id={id} label={label} required={required} hint={hint} error={error}>
      <textarea className="sicc-control" id={id} value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows} required={required} maxLength={maxLength} aria-invalid={error ? true : undefined} aria-describedby={error || hint ? `${id}-msg` : undefined} />
    </Field>
  );
}

export function Checkbox({ label, checked, onChange, hint, error }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="sicc-checkbox">
        <input id={id} type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
      {hint && !error && <div style={{ fontSize: 12, color: C.textMuted, marginLeft: 28, marginTop: 3 }}>{hint}</div>}
      {error && <div role="alert" style={{ fontSize: 12, color: C.danger, marginLeft: 28, marginTop: 3 }}>{error}</div>}
    </div>
  );
}

const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input:not([disabled]),select,[tabindex]:not([tabindex="-1"])';

export function Modal({ title, onClose, children, width = 520, footer, placement }) {
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
      const modals = document.querySelectorAll('.sicc-modal');
      if (document.querySelector('.floating-card-layer') || modals[modals.length - 1] !== node) return;
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current?.(); return; }
      if (e.key !== 'Tab' || !node) return;
      const items = [...node.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
      if (!items.length) return;
      const a = items[0]; const z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.({ preventScroll: true }); };
  }, []);
  return (
    <div className="sicc-modal-overlay" data-placement={placement} onMouseDown={e => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} className="sicc-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ '--dialog-width': typeof width === 'number' ? `${width}px` : width }}>
        <div className="sicc-modal-header">
          <h2 id={titleId}>{title}</h2>
          <button className="floating-card-close" type="button" onClick={onClose} aria-label="Close dialog"><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
        </div>
        <div className="sicc-modal-content">{children}</div>
        {footer && <div className="sicc-modal-footer">{footer}</div>}
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
  const [allColumns, setAllColumns] = useState(false);
  const tableId = useId();
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

  if (loading) return <div className="sicc-table-loading" aria-busy="true">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton" />)}</div>;
  if (!total) return <div className="sicc-table-empty">{emptyText}</div>;
  const actionColumns = columns.filter(column => column.key === 'actions' || !column.label);
  const recordColumns = columns.filter(column => !actionColumns.includes(column));
  const pinnedColumns = [...actionColumns, ...recordColumns.filter(column => column.key === 'status')];
  const defaultColumns = new Set([...pinnedColumns, ...recordColumns.filter(column => !pinnedColumns.includes(column))].slice(0, 6));
  const tableColumns = allColumns ? columns : columns.filter(column => defaultColumns.has(column));
  const sortColumns = recordColumns.filter(column => column.sortable !== false).map(column => ({ value: column.key, label: column.label }));
  const renderCell = (column, row) => column.render ? column.render(row[column.key], row) : row[column.key] ?? '–';
  const openRow = (event, row) => {
    if (!event.target.closest('a, button, input, select, textarea, summary')) onRowClick(row);
  };
  return (
    <div className="sicc-records">
      {(exportName || columns.length > 6 || sortColumns.length > 0) && (
        <div className="sicc-table-tools no-print">
          {sortColumns.length > 0 && <div className="sicc-card-sort">
            <FilterSelect value={sort?.key} onChange={key => setSort(key ? { key, dir: 'asc' } : null)} options={sortColumns} placeholder="Sort records" />
            {sort && <Btn size="sm" variant="outline" ariaLabel={sort.dir === 'asc' ? 'Sort descending' : 'Sort ascending'}
              onClick={() => setSort(current => ({ ...current, dir: current.dir === 'asc' ? 'desc' : 'asc' }))}>
              {sort.dir === 'asc' ? <ArrowUp size={20} aria-hidden="true" /> : <ArrowDown size={20} aria-hidden="true" />}
            </Btn>}
          </div>}
          {columns.length > 6 && <span className="sicc-column-toggle"><button type="button" className="sicc-btn" data-size="sm" data-variant="outline"
            onClick={() => setAllColumns(value => !value)} aria-expanded={allColumns} aria-controls={tableId}>
            {allColumns ? 'Show fewer columns' : 'Show all columns'}
          </button></span>}
          {exportName && <Btn size="sm" variant="ghost" onClick={exportCsv}><Download size={20} aria-hidden="true" /> Export CSV</Btn>}
        </div>
      )}
      <div className="sicc-table-wrap">
        <ul className="sicc-mobile-cards" aria-label={caption || 'Table records'}>
          {visible.map((row, index) => (
            <li key={row.id ?? index} className="sicc-mobile-card" onClick={onRowClick ? event => openRow(event, row) : undefined}>
              <dl>{recordColumns.map(column => <div key={column.key}><dt>{column.label}</dt><dd>{renderCell(column, row)}</dd></div>)}</dl>
              {(actionColumns.length > 0 || onRowClick) && <div className="sicc-card-actions">
                {actionColumns.map(column => <div key={column.key}>{renderCell(column, row)}</div>)}
                {onRowClick && <Btn variant="outline" size="sm" onClick={() => onRowClick(row)}>View record</Btn>}
              </div>}
            </li>
          ))}
        </ul>
        <table id={tableId} className="sicc-table" data-dense={dense || undefined}>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>{tableColumns.map(c => {
              const active = sort?.key === c.key;
              const sortable = c.sortable !== false && c.key !== 'actions' && c.label;
              return (
                <th key={c.key} scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined} style={{ width: c.width }}>
                  {sortable ? <button type="button" onClick={() => toggleSort(c.key)}>{c.label}{active && (sort.dir === 'asc' ? <ArrowUp size={16} aria-hidden="true" /> : <ArrowDown size={16} aria-hidden="true" />)}</button> : c.label}
                </th>
              );
            })}</tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={row.id ?? i} onClick={onRowClick ? event => openRow(event, row) : undefined} tabIndex={onRowClick ? 0 : undefined} role={onRowClick ? 'button' : undefined}
                onKeyDown={onRowClick ? event => {
                  if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    onRowClick(row);
                  }
                } : undefined}>
                {tableColumns.map(column => <td key={column.key}>{renderCell(column, row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageSize > 0 && total > pageSize && (
        <nav className="sicc-table-pages no-print" aria-label="Table pages">
          <span>{page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} of {total}</span>
          <span>
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
      <div className="sicc-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>{[0, 1, 2, 3].map(i => <Skeleton key={i} h={92} style={{ borderRadius: 14 }} />)}</div>
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
