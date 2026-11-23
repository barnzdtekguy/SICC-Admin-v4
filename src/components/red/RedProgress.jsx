import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { Panel } from '../shared/UI';

const monthFormat = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', month: 'long', year: 'numeric' });
const shortMonth = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', month: 'short' });
const calendarDate = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium' });
export const redMonth = value => monthFormat.format(new Date(`${value}T12:00:00Z`));
export const redDate = value => calendarDate.format(new Date(`${value}T12:00:00Z`));

export function PaceLabel({ pace }) {
  if (!pace) return null;
  const arrow = pace.state === 'behind' ? '▼' : pace.state === 'on_pace' ? '▲' : '–';
  return <span className="red-pace" data-pace={pace.state}><span aria-hidden="true">{arrow}</span> {pace.label}</span>;
}

export function PaceChart({ points, pace, month }) {
  return (
    <Panel title={`Your pace in ${redMonth(month)}`}>
      <PaceLabel pace={pace} />
      <div className="red-chart" aria-label="Cumulative souls recorded and expected pace" role="img">
        <ResponsiveContainer width="100%" height={216} minWidth={0}>
          <LineChart data={points} margin={{ top: 12, right: 10, left: 0, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="day" stroke="var(--muted)" tick={{ fontSize: 11 }} minTickGap={18} />
            <YAxis allowDecimals={false} width={34} stroke="var(--muted)" tick={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="expected" stroke="var(--muted)" strokeDasharray="4 4" dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="actual" stroke="var(--accent-chart)" strokeWidth={3} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p><small>Solid line shows souls recorded. Dotted line shows the expected pace by day.</small></p>
    </Panel>
  );
}

export function MonthHistory({ history }) {
  if (!history) return null;
  return (
    <Panel title="Monthly history">
      <div className="red-stack">
        <p>{history.streak ? `${history.streak} ${history.streak === 1 ? 'month' : 'months'} in a row at target` : 'No current streak'}</p>
        {!history.months.length ? <p>Your first campaign month is in progress.</p> : (
          <ul className="red-history">
            {history.months.map(row => (
              <li key={row.month} data-pace={row.met ? 'on_pace' : 'behind'}>
                <span className="red-history-bar" aria-hidden="true" style={{ '--value': `${Math.max(4, Math.min(100, row.total * 100 / row.target))}%` }} />
                <strong>{shortMonth.format(new Date(`${row.month}T12:00:00Z`))}</strong>
                <small>{row.total}/{row.target}</small>
                <small><span aria-hidden="true">{row.met ? '▲' : '▼'}</span> {row.met ? 'Met' : 'Missed'}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

export function TeamTrend({ points, pace }) {
  const max = Math.max(1, ...points);
  return (
    <div className="red-sparkline" data-pace={pace.state} role="img" aria-label={`Cumulative trend from ${points[0] || 0} to ${points.at(-1) || 0} souls`}>
      {points.map((point, index) => <span key={index} style={{ '--value': `${Math.max(5, 100 * point / max)}%` }} />)}
    </div>
  );
}
