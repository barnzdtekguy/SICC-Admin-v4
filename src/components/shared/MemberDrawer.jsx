import { useEffect, useState } from 'react';
import { Phone, MapPin, Building2, Cake, History, UserCheck } from 'lucide-react';
import { C } from '../../lib/theme';
import { getMemberTimeline } from '../../lib/db';
import { StatusBadge, Skeleton, Alert, Modal } from './UI';

const fmt = v => (v ? new Date(String(v).replace(' ', 'T') + (String(v).length <= 10 ? '' : 'Z')).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: String(v).length > 10 ? 'short' : undefined }) : '–');

// Slide-in profile with a full activity timeline and a "last updated by" line.
export default function MemberDrawer({ memberId, onClose }) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  useEffect(() => {
    let active = true;
    setState({ loading: true, data: null, error: '' });
    getMemberTimeline(memberId).then(data => active && setState({ loading: false, data, error: '' })).catch(e => active && setState({ loading: false, data: null, error: e.message }));
    return () => { active = false; };
  }, [memberId]);
  const m = state.data?.member;
  const row = (icon, text) => text ? <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14, color: C.textPrimary }}><span aria-hidden style={{ color: C.textMuted, display: 'flex' }}>{icon}</span>{text}</div> : null;
  return (
    <Modal title="Member profile" width={440} placement="side" onClose={onClose}>
        {state.loading && <div style={{ display: 'grid', gap: 12, marginTop: 24 }}><Skeleton w={200} h={30} /><Skeleton h={14} /><Skeleton h={14} w="70%" /><Skeleton h={120} /></div>}
        {state.error && <div style={{ marginTop: 30 }}><Alert type="error" message={state.error} /></div>}
        {m && (
          <>
            <h2 className="display" style={{ fontSize: 30, color: C.textPrimary, marginTop: 8, paddingRight: 30 }}>{m.first_name} {m.last_name}</h2>
            <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>{m.status && <StatusBadge status={m.status} />}{m.spiritual_status && <span style={{ fontSize: 12, color: C.textSecondary }}>{m.spiritual_status}</span>}</div>
            <div style={{ display: 'grid', gap: 10, margin: '18px 0' }}>
              {row(<Phone size={15} />, m.phone)}{row(<MapPin size={15} />, [m.kdf_area, m.address].filter(Boolean).join(' · '))}
              {row(<Building2 size={15} />, m.department)}{row(<Cake size={15} />, m.date_of_birth && `Born ${fmt(String(m.date_of_birth).slice(0, 10))}`)}
              {row(<UserCheck size={15} />, m.registered_by_name && `Registered by ${m.registered_by_name}`)}
            </div>
            {m.notes && <div style={{ background: C.inputBg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, fontSize: 13, color: C.textPrimary, whiteSpace: 'pre-wrap', marginBottom: 18 }}>{m.notes}</div>}
            <h3 style={{ fontSize: 14, display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0 12px', color: C.textPrimary }}><History size={15} aria-hidden /> Activity</h3>
            <ol style={{ listStyle: 'none', borderLeft: `2px solid ${C.border}`, marginLeft: 6, display: 'grid', gap: 14 }}>
              {state.data.events.map((e, i) => (
                <li key={i} style={{ paddingLeft: 14, position: 'relative' }}>
                  <span aria-hidden style={{ position: 'absolute', left: -6, top: 5, width: 10, height: 10, borderRadius: '50%', background: e.type === 'follow_up' ? C.success : e.type === 'change' ? C.gold : C.info }} />
                  <div style={{ fontSize: 13, color: C.textPrimary, fontWeight: 600 }}>{e.text}</div>
                  {e.detail && <div style={{ fontSize: 13, color: C.textSecondary }}>{e.detail}</div>}
                  <div style={{ fontSize: 12, color: C.textMuted }}>{fmt(e.at)}{e.by ? ` · ${e.by}` : ''}</div>
                </li>
              ))}
            </ol>
            {state.data.updated_by && <p style={{ fontSize: 12, color: C.textMuted, marginTop: 20 }}>Last updated by {state.data.updated_by} on {fmt(state.data.updated_at)}</p>}
          </>
        )}
    </Modal>
  );
}
