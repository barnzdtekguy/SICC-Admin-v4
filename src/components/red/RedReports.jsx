import { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/api';
import { Alert, Btn, Modal, Panel } from '../shared/UI';
import { PaceLabel, redDate, redMonth } from './RedProgress';
import { RedLoading, RedProblem } from './RedShared';

export default function RedReports({ onSubmitted, liveRevision }) {
  const [reports, setReports] = useState(null);
  const [review, setReview] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [reviewError, setReviewError] = useState('');
  const reload = () => { setError(null); setAttempt(previous => previous + 1); };

  useEffect(() => {
    let active = true;
    apiRequest('/red/reports').then(data => { if (active) setReports(data); }).catch(problem => { if (active) setError(problem); });
    return () => { active = false; };
  }, [attempt, liveRevision]);

  const open = async month => {
    setBusy(true);
    setError(null);
    setReviewError('');
    try {
      const data = await apiRequest(`/red/reports/${month}`);
      if (data.submitted) {
        setNotice('This report was already submitted.');
        reload();
      } else setReview(data);
    } catch (problem) { setError(problem); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    setBusy(true);
    setReviewError('');
    try {
      const result = await apiRequest(`/red/reports/${review.window.month}`, { method: 'POST', body: { revision: review.revision } });
      setReview(null);
      setNotice(`Report submitted. ${result.created_members} new membership records and ${result.linked_members} existing member links.`);
      reload();
      onSubmitted?.();
    } catch (problem) {
      setReviewError(problem.message);
      if (problem.code === 'red_report_changed') {
        try {
          const updated = await apiRequest(`/red/reports/${review.window.month}`);
          if (updated.submitted) { setReview(null); reload(); }
          else setReview(updated);
        } catch { setReview(null); reload(); }
      }
    } finally { setBusy(false); }
  };

  return (
    <Panel title="Team reports">
      <div className="red-stack">
        {notice && <Alert type="success" message={notice} />}
        {error && <RedProblem error={error} retry={reload} />}
        {!reports && !error && <RedLoading>Loading reports…</RedLoading>}
        {reports && (
          <>
            {reports.available.length ? (
              <ul className="red-list">
                {reports.available.map(window => (
                  <li key={window.month}>
                    <div><strong>{window.final ? 'Final report' : redMonth(window.month)}</strong><p>Closes {redDate(window.closes)} in Lagos</p></div>
                    <Btn loading={busy && !review} onClick={() => open(window.month)}>Submit report</Btn>
                  </li>
                ))}
              </ul>
            ) : <p>There is no reporting window open for your team.</p>}
            {reports.submitted.length > 0 && (
              <>
                <h3>Submitted reports</h3>
                <ul className="red-list">
                  {reports.submitted.map(report => (
                    <li key={report.id}><div><strong>{redMonth(report.month)}</strong><p>Submitted {redDate(report.submitted_on)}</p></div>
                      <strong>{report.summary.total} souls</strong></li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
      {review && (
        <Modal title={review.window.final ? 'Review final report' : `Review ${redMonth(review.window.month)} report`} onClose={() => { if (!busy) setReview(null); }}>
          <div className="red-stack">
            <p>Submitting is permanent and adds the valid soul records to church membership.
              {!review.window.final && ' New soul entries will count toward the next month.'}</p>
            <ul className="red-list">
              {review.summary.members.map(member => (
                <li key={member.id}><strong>{member.name}</strong>
                  <div><strong>{member.total} / {member.target}</strong><br /><PaceLabel pace={{ state: member.met ? 'on_pace' : 'behind', label: member.met ? 'Target met' : 'Target missed' }} /></div>
                </li>
              ))}
            </ul>
            <strong>{review.summary.total} souls in this report · Team target {review.summary.target}</strong>
            {reviewError && <Alert type="error" message={reviewError} />}
            <div className="red-actions">
              <Btn loading={busy} onClick={submit}>Confirm submission</Btn>
              <Btn disabled={busy} variant="outline" onClick={() => setReview(null)}>Cancel</Btn>
            </div>
          </div>
        </Modal>
      )}
    </Panel>
  );
}
