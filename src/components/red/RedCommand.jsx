import { useEffect, useState } from 'react';
import { apiRequest, downloadFile } from '../../lib/api';
import { Alert, Badge, Btn, C, ConfirmDialog, DataTable, Input, Panel, Select, StatCard } from '../shared/UI';
import { PaceLabel, redDate, redMonth } from './RedProgress';
import { SoulDialog, SoulList, redStage } from './RedSouls';
import { RedHero, RedLoading, RedProblem } from './RedShared';

const number = new Intl.NumberFormat('en-NG');
const statuses = [
  { value: 'all', label: 'All teams' }, { value: 'pending', label: 'Not yet submitted' }, { value: 'submitted', label: 'Submitted' },
  { value: 'late', label: 'Submitted late' }, { value: 'missing', label: 'Missing' }, { value: 'not_due', label: 'Not due' },
  { value: 'deactivated', label: 'Deactivated' },
];

function ReportStatus({ report }) {
  const color = report.status === 'submitted' ? C.success : report.status === 'missing' ? C.danger : report.status === 'late' ? C.warning : C.textSecondary;
  return <><Badge color={color} label={report.label} />{report.review_members > 0 && <p>{report.review_members} flagged for membership review</p>}</>;
}

const columns = [
  { key: 'name', label: 'Team', render: (name, row) => <div><strong>{name}</strong><p>{row.joined} of {row.seat_limit} joined{row.deactivated_at ? ' · Deactivated' : ''}</p></div> },
  { key: 'current', label: 'This month', render: (total, row) => `${total} of ${row.target}` },
  { key: 'total', label: 'Campaign total' },
  { key: 'pace', label: 'Pace', sortable: false, render: pace => <PaceLabel pace={pace} /> },
  { key: 'report', label: 'Report', sortable: false, render: report => <ReportStatus report={report} /> },
];

function StageFunnel({ stages }) {
  const largest = Math.max(1, ...stages.map(stage => stage.total));
  return (
    <Panel title="Training stages">
      <div className="role-home-chart-bars" aria-label="Valid souls by current training stage">
        {stages.map(stage => (
          <div className="role-home-chart-row" key={stage.stage}>
            <span>{redStage(stage.stage)}</span>
            <meter aria-label={redStage(stage.stage)} min="0" max={largest} value={stage.total} />
            <strong>{stage.total}</strong>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export default function RedCommand({ settings, navigation, onOpenTeam }) {
  const [command, setCommand] = useState(null);
  const [month, setMonth] = useState('');
  const [status, setStatus] = useState('all');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const reload = () => { setError(null); setAttempt(previous => previous + 1); };

  useEffect(() => {
    let active = true;
    const search = month ? `?month=${encodeURIComponent(month)}` : '';
    const load = () => apiRequest(`/red/admin/command${search}`).then(data => { if (active) { setCommand(data); setError(null); } })
      .catch(problem => { if (active) setError(problem); });
    load();
    const timer = setInterval(() => { if (navigator.onLine && document.visibilityState === 'visible') load(); }, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [month, attempt]);

  const exportCsv = async () => {
    setExporting(true);
    setExportError('');
    try { await downloadFile(`/red/admin/reports.csv?month=${command.report_month}`, 'operation-red-reports.csv'); }
    catch (problem) { setExportError(problem.message); }
    finally { setExporting(false); }
  };
  const filtered = command?.teams.filter(team => {
    const statusMatch = status === 'all' || (status === 'deactivated' ? Boolean(team.deactivated_at) : team.report.status === status);
    return statusMatch && team.name.toLowerCase().includes(filter.trim().toLowerCase());
  });

  return (
    <>
      <RedHero title="Operation R.E.D.">
        <p className="role-home-hero-note">Project 3000 by Love Revolution</p>
        {command && (
          <>
            <div className="display role-home-hero-number">{number.format(command.total)}</div>
            <p>of {number.format(command.goal)} souls recorded</p>
            <progress className="red-goal-meter" aria-label="Campaign goal progress" value={Math.min(command.total, command.goal)} max={command.goal} />
          </>
        )}
        <p>Campaign ends {redDate(settings.campaign_end)} · Final report opens {redDate(settings.final_report_opens)}</p>
      </RedHero>
      {navigation}
      {error && <RedProblem error={error} retry={reload} />}
      {!command && !error && <RedLoading>Loading live campaign progress…</RedLoading>}
      {command && (
        <>
          <div className="red-stats">
            <StatCard label="Expected by today" value={number.format(command.expected)} />
            <StatCard label="Still needed" value={number.format(command.remaining)} />
            {command.daily_needed !== null && <StatCard label="Souls needed per day" value={number.format(command.daily_needed)} sub={`${command.days_left} campaign days left`} />}
            <StatCard label="Reports needing attention" value={command.attention.length} />
          </div>
          <div className="red-overview">
            <StageFunnel stages={command.stages} />
            <Panel title="Report attention">
              {command.attention.length ? (
                <ul className="red-list">
                  {command.attention.slice(0, 5).map(report => (
                    <li key={`${report.team_id}:${report.month}`}>
                      <div><strong>{report.team_name}</strong><p>{redMonth(report.month)}</p></div>
                      <div className="red-actions"><ReportStatus report={report} /><Btn variant="outline" size="sm" onClick={() => onOpenTeam(report.team_id)}>View team</Btn></div>
                    </li>
                  ))}
                </ul>
              ) : <p>No late or missing reports.</p>}
            </Panel>
          </div>
          <Panel title="Live teams">
            <div className="red-stack">
              <div className="red-controls">
                <Input label="Find a team" value={filter} onChange={setFilter} />
                <Select label="Report month" value={command.report_month} onChange={value => value && setMonth(value)}
                  options={command.report_windows.map(period => ({ value: period.month, label: period.final ? `Final report · ${redMonth(period.month)}` : redMonth(period.month) }))} />
                <Select label="Report status" value={status} onChange={value => setStatus(value || 'all')} options={statuses} />
              </div>
              <div className="red-actions">
                <Btn variant="outline" onClick={reload}>Refresh teams</Btn>
                <Btn variant="outline" loading={exporting} onClick={exportCsv}>Export reports CSV</Btn>
              </div>
              {exportError && <Alert type="error" message={exportError} />}
              <DataTable columns={columns} rows={filtered} pageSize={12} onRowClick={team => onOpenTeam(team.id)} emptyText="No teams match these filters." />
            </div>
          </Panel>
        </>
      )}
    </>
  );
}

export function CommandTeam({ id, onBack }) {
  const [team, setTeam] = useState(null);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState('');
  const [detail, setDetail] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const reload = () => { setError(null); setAttempt(previous => previous + 1); };
  useEffect(() => {
    let active = true;
    apiRequest(`/red/admin/teams/${encodeURIComponent(id)}?offset=${offset}`).then(data => { if (active) setTeam(data); })
      .catch(problem => { if (active) setError(problem); });
    return () => { active = false; };
  }, [id, offset, attempt]);

  const deactivate = async () => {
    setPending(true);
    setConfirm(false);
    setActionError('');
    try { await apiRequest(`/red/admin/teams/${id}/deactivate`, { method: 'POST' }); reload(); }
    catch (problem) { setActionError(problem.message); }
    finally { setPending(false); }
  };

  return (
    <>
      <div className="red-actions"><Btn variant="outline" onClick={onBack}>Back to live teams</Btn></div>
      {error && <RedProblem error={error} retry={reload} />}
      {!team && !error && <RedLoading>Loading team…</RedLoading>}
      {team && (
        <>
          <RedHero title={team.name}
            action={!team.deactivated_at && <Btn variant="outline" color={C.danger} loading={pending} onClick={() => setConfirm(true)}>Deactivate team</Btn>}>
            <p>{team.members.length} of {team.seat_limit} joined · {team.deactivated_at ? 'Deactivated' : 'Active'}</p>
          </RedHero>
          {actionError && <Alert type="error" message={actionError} />}
          <div className="red-overview">
            <Panel title="Team roster">
              <ul className="red-list">
                {team.members.map(member => <li key={member.id}><strong>{member.name}</strong><span>{member.total} of {team.target} this month</span></li>)}
              </ul>
            </Panel>
            <Panel title="Report history">
              <ul className="red-list">
                {team.report_statuses.map(report => (
                  <li key={report.month}>
                    <div><strong>{report.final ? 'Final report' : redMonth(report.month)}</strong><p>Due {redDate(report.closes)}</p></div>
                    <div><ReportStatus report={report} />{report.submitted_on && <p>{report.total} souls submitted</p>}</div>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
          <Panel title="Team souls">
            <div className="red-stack">
              <SoulList items={team.souls} open={setDetail} showWinner onChanged={reload} />
              <div className="red-actions">
                {offset > 0 && <Btn variant="outline" onClick={() => setOffset(previous => previous - 20)}>Previous page</Btn>}
                {team.next_offset !== null && <Btn variant="outline" onClick={() => setOffset(team.next_offset)}>Next page</Btn>}
              </div>
            </div>
          </Panel>
        </>
      )}
      {detail && <SoulDialog id={detail} manage onClose={() => setDetail(null)} onChanged={reload} />}
      {confirm && <ConfirmDialog title="Deactivate this team?" message={`${team.name} and their team members will be signed out, and their join link will stop working.`}
        confirmLabel="Deactivate team" danger onConfirm={deactivate} onCancel={() => setConfirm(false)} />}
    </>
  );
}
