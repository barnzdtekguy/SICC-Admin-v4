import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, ChevronRight, CircleAlert } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

const number = new Intl.NumberFormat('en-NG');
const date = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long' });
const dateKey = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Lagos', dateStyle: 'short' });
const localHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: 'numeric', hourCycle: 'h23' });
const icon = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
const metric = (value, suffix = '') => value == null ? '—' : typeof value === 'string' ? value : number.format(value) + suffix;

export function welcomeGreeting(name, now = new Date()) {
  const hour = Number(localHour.format(now));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = name?.trim().replace(/^(Archbishop|Bishop|Pastor|Pst\.?|Rev\.?|Dr\.?)(?:\s+|$)/i, '').split(/\s+/)[0];
  return firstName ? `${greeting}, ${firstName}` : greeting;
}

export function RoleHomeHero({ children, action, labelledBy }) {
  return (
    <div className="role-home-hero-backdrop">
      <section className="role-home-hero" aria-labelledby={labelledBy}>
        <div>{children}</div>
        {action}
      </section>
    </div>
  );
}

export function useHomeData(load) {
  const [data, setData] = useState(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const queries = Object.entries(load());
    Promise.allSettled(queries.map(([, request]) => request)).then(results => {
      if (!active) return;
      const values = results.map((result, index) => [queries[index][0], result.value]);
      setData({ ...Object.fromEntries(values), error: results.some(result => result.status === 'rejected') });
    });
    return () => { active = false; };
  }, [load, revision]);
  const reload = () => { setData(null); setRevision(value => value + 1); };
  return { data, reload };
}

function Action({ to, onClick, className, children }) {
  if (to) return <Link className={className} to={to}>{children}</Link>;
  if (onClick) return <button className={className} type="button" onClick={onClick}>{children}</button>;
  return <div className={className}>{children}</div>;
}

function SectionHeader({ id, title, to, label }) {
  return (
    <div className="role-home-section-header">
      <h2 id={id}>{title}</h2>
      {to && <Link to={to} className="role-home-link">{label} <ArrowRight {...icon} /></Link>}
    </div>
  );
}

function HomeChart({ chart }) {
  const id = useId();
  const bars = (chart.bars || []).filter(bar => bar.value != null).slice(0, 4);
  const max = Math.max(1, ...bars.map(bar => bar.value));
  return (
    <section className="role-home-chart" aria-labelledby={id}>
      <SectionHeader id={id} title={chart.title} to={chart.to} label={chart.linkLabel || 'View report'} />
      {bars.length ? (
        <div className="role-home-chart-bars">
          {bars.map(({ key, label, detail, value }) => (
            <div key={key || label} className="role-home-chart-row">
              <span><span className="role-home-chart-label" title={label}>{label}</span>{detail && <small>{detail}</small>}</span>
              <meter min={0} max={max} value={value} aria-label={[label, detail].filter(Boolean).join(', ')} aria-valuetext={`${metric(value)} ${chart.unit || ''}`.trim()} />
              <strong>{metric(value)}</strong>
            </div>
          ))}
        </div>
      ) : <p className="role-home-empty">{chart.empty || 'No records yet.'}</p>}
    </section>
  );
}

function HomeAttention({ attention }) {
  const id = useId();
  const rows = (attention.rows || []).slice(0, 5);
  return (
    <section className="role-home-attention" aria-labelledby={id}>
      <SectionHeader id={id} title="Needs attention" to={attention.to} label="View all" />
      {rows.length ? (
        <ul>
          {rows.map(({ key, title, detail, Icon = CircleAlert, to, onClick }) => (
            <li key={key || title}>
              <Action to={to} onClick={onClick} className="role-home-attention-row">
                <span className="role-home-row-icon"><Icon {...icon} /></span>
                <span><strong>{title}</strong>{detail && <small>{detail}</small>}</span>
                {(to || onClick) && <ChevronRight {...icon} />}
              </Action>
            </li>
          ))}
        </ul>
      ) : <p className="role-home-empty">{attention.empty || 'You’re all caught up.'}</p>}
    </section>
  );
}

export default function RoleHome({ hero, stats, chart, attention, shortcuts, loading, error, onRetry, children }) {
  const { profile } = useAuth();
  const id = useId();
  const now = new Date();
  const HeroIcon = hero.action.Icon;
  return (
    <div className="role-home" aria-busy={loading}>
      <div className="role-home-greeting">
        <h1 className="display role-home-greeting-title">{welcomeGreeting(profile.name, now)}.</h1>
        <p><CalendarDays {...icon} /><time dateTime={dateKey.format(now)}>{date.format(now)}</time></p>
      </div>
      <RoleHomeHero labelledBy={`${id}-hero`} action={
        <Action className="role-home-primary" to={hero.action.to} onClick={hero.action.onClick}>
          {HeroIcon && <HeroIcon {...icon} />} {hero.action.label}
        </Action>
      }>
        <h2 id={`${id}-hero`}>{hero.label}</h2>
        <p className="display role-home-hero-number">{metric(hero.value)}</p>
        {hero.note && <p className="role-home-hero-note">{hero.note}</p>}
      </RoleHomeHero>
      {error && (
        <div className="role-home-error" role="status">
          Some dashboard data is unavailable.
          <button className="role-home-link" type="button" onClick={onRetry}>Try again</button>
        </div>
      )}
      <section className="role-home-summary" aria-labelledby={`${id}-summary`}>
        <h2 id={`${id}-summary`}>Ministry summary</h2>
        <div className="role-home-stats">
          {stats.slice(0, 4).map(({ label, value, suffix, note, to, onClick }) => (
            <Action key={label} className="role-home-stat" to={to} onClick={onClick}>
              <span>{label}</span>
              <strong className="display">{metric(value, suffix)}</strong>
              {note && <small>{note}</small>}
            </Action>
          ))}
        </div>
      </section>
      <section className="role-home-shortcuts" aria-labelledby={`${id}-shortcuts`}>
        <h2 id={`${id}-shortcuts`}>Quick actions</h2>
        <div>
          {shortcuts.slice(0, 4).map(({ label, Icon, to }) => (
            <Link key={label} to={to}><span><Icon {...icon} size={24} /></span>{label}</Link>
          ))}
        </div>
      </section>
      <div className="role-home-details">
        <HomeChart chart={chart} />
        <HomeAttention attention={attention} />
      </div>
      {children}
    </div>
  );
}

export function attendanceBars(rows, { department = false } = {}) {
  return (rows || []).slice(-4).map((row, index) => ({
    key: `${row.date}-${row.service}-${index}`,
    label: row.service,
    detail: row.date?.slice(5),
    value: department ? (row.dept_count ?? row.count) : row.count,
  }));
}
