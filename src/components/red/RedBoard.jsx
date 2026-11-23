import { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/api';
import { DataTable, Panel } from '../shared/UI';
import { PaceLabel, TeamTrend, redMonth } from './RedProgress';
import { RedHero, RedLoading, RedProblem } from './RedShared';

const count = new Intl.NumberFormat('en-NG');
const columns = [
  { key: 'name', label: 'Team' },
  { key: 'current', label: 'This month', render: (value, row) => `${value} of ${row.target}` },
  { key: 'total', label: 'Campaign total' },
  { key: 'pace', label: 'Trend', sortable: false, render: (pace, row) => (
    <div className="red-trend-cell"><PaceLabel pace={pace} /><TeamTrend points={row.trend} pace={pace} /></div>
  ) },
];

export default function RedBoard({ liveRevision }) {
  const [board, setBoard] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    apiRequest('/red/teams-board').then(data => { if (current) setBoard(data); }).catch(problem => { if (current) setError(problem); });
    return () => { current = false; };
  }, [attempt, liveRevision]);
  if (error) return <RedProblem error={error} retry={() => { setError(null); setAttempt(previous => previous + 1); }} />;
  if (!board) return <RedLoading />;
  const percent = Math.floor(board.total * 100 / board.goal);
  return (
    <>
      <RedHero title="Teams Board">
        <div className="display role-home-hero-number">{count.format(board.total)}</div>
        <p>of {count.format(board.goal)} souls recorded across the campaign</p>
        <progress className="red-goal-meter" aria-label="Progress towards the campaign goal" value={Math.min(board.total, board.goal)} max={board.goal} />
        <p>{percent}% of the goal</p>
      </RedHero>
      <Panel title={redMonth(board.month)}>
        <DataTable columns={columns} rows={board.teams} pageSize={10} emptyText="No teams have joined the campaign yet." />
      </Panel>
    </>
  );
}
