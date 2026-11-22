import { useState, useEffect, useMemo } from 'react';
import QRCode from 'qrcode';
import {
  getProgrammes,
  createProgramme,
  getProgrammeRecords,
  savePublicCheckIn,
  getCheckInSession,
  updateProgramme,
} from '../../lib/db';
import { useToast } from '../shared/Toast';
import { StatCard, Panel, Badge, DataTable, Btn, Modal, Input, Select, C, Alert, Grid, Skeleton } from '../shared/UI';
import { Users, CheckSquare, Calendar, Copy, PlusCircle, Smartphone, ClipboardCheck, MapPin, Presentation, Lock } from 'lucide-react';

const TODAY = new Date().toISOString().slice(0, 10);

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function getCheckInBaseUrl() {
  return window.location.origin + window.location.pathname;
}

function ProjectorMode({ name, qrImage, secondsLeft, count, onClose }) {
  useEffect(() => { const k = e => e.key === 'Escape' && onClose(); document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Check-in QR for projector" style={{ position: 'fixed', inset: 0, zIndex: 2500, background: C.qrDark, color: 'var(--nav-ink)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'clamp(10px, 2.5vh, 26px)', padding: 20, textAlign: 'center' }}>
      <button type="button" onClick={onClose} aria-label="Exit projector mode" style={{ position: 'absolute', top: 16, right: 16, background: 'var(--nav-hover)', border: 'none', color: 'var(--nav-ink)', borderRadius: 10, padding: '10px 14px', fontSize: 14 }}>Exit (Esc)</button>
      <div className="display" style={{ fontSize: 'clamp(28px, 6vh, 56px)', lineHeight: 1.1 }}>{name}</div>
      <div style={{ fontSize: 'clamp(16px, 3vh, 26px)', color: C.goldLight }}>Scan with your phone camera to check in</div>
      {qrImage && <img src={qrImage} alt="Check-in QR code" style={{ width: 'min(62vh, 86vw)', height: 'min(62vh, 86vw)', background: C.qrLight, borderRadius: 24, padding: 8 }} />}
      <div style={{ fontSize: 'clamp(14px, 2.4vh, 22px)', color: 'var(--nav-muted)' }}>Code refreshes in <strong className="num">{secondsLeft}s</strong> · <strong className="num">{count}</strong> checked in</div>
    </div>
  );
}

export default function ProgrammeAttendance() {
  const [programmes, setProgrammes] = useState([]);
  const [loadingProgrammes, setLoadingProgrammes] = useState(true);
  const [programmeId, setProgrammeId] = useState('');
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [records, setRecords] = useState([]);
  const [message, setMessage] = useState(null);
  const [showProgrammeModal, setShowProgrammeModal] = useState(false);
  const [newProgramme, setNewProgramme] = useState({ name: '', programme_type: 'custom', start_date: TODAY, end_date: '', total_days: '' });

  const toast = useToast();
  const [session, setSession] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [qrImage, setQrImage] = useState('');
  const [projector, setProjector] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);

  const selectedProgramme = programmes.find(p => p.id === programmeId) || programmes[0];
  const selectedProgrammeId = selectedProgramme?.id;
  const token = session?.programmeId === selectedProgrammeId ? session?.token : null;
  const checkInUrl = useMemo(() => {
    if (!selectedProgrammeId) return '';
    const params = new URLSearchParams({ checkin: '1', programme: selectedProgrammeId, date: selectedDate });
    if (token) params.set('t', token);
    return `${getCheckInBaseUrl()}?${params.toString()}`;
  }, [selectedProgrammeId, selectedDate, token]);

  // The code changes every minute, so a photo of it forwarded to someone outside the room stops working.
  useEffect(() => {
    if (!selectedProgrammeId) return;
    let alive = true; let timer;
    const refresh = async () => {
      try {
        const checkIn = await getCheckInSession(selectedProgrammeId);
        if (!alive) return;
        setSession({ programmeId: selectedProgrammeId, token: checkIn.token });
        setSecondsLeft(checkIn.refresh_in);
        timer = setTimeout(refresh, Math.max(3, checkIn.refresh_in) * 1000 + 400);
      } catch { if (alive) { setSession(null); timer = setTimeout(refresh, 15000); } }
    };
    setSession(null); refresh();
    return () => { alive = false; clearTimeout(timer); };
  }, [selectedProgrammeId]);
  useEffect(() => { const t = setInterval(() => setSecondsLeft(n => Math.max(0, n - 1)), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    setQrImage('');
    if (!token || !checkInUrl) return;
    let current = true;
    QRCode.toDataURL(checkInUrl, { width: 720, margin: 2, errorCorrectionLevel: 'M', color: { dark: C.qrDark, light: C.qrLight } })
      .then(image => { if (current) setQrImage(image); })
      .catch(() => { if (current) setQrImage(''); });
    return () => { current = false; };
  }, [checkInUrl, token]);

  const lockToHere = () => {
    if (!navigator.geolocation) { toast.error('This device cannot share its location.'); return; }
    setLockBusy(true);
    navigator.geolocation.getCurrentPosition(async pos => {
      const { error } = await updateProgramme(selectedProgramme.id, { geo_lat: pos.coords.latitude, geo_lng: pos.coords.longitude, geo_radius_m: 300 });
      setLockBusy(false);
      if (error) { toast.error(error.message); return; }
      setProgrammes(list => list.map(p => (p.id === selectedProgramme.id ? { ...p, geo_lat: pos.coords.latitude, geo_lng: pos.coords.longitude, geo_radius_m: 300 } : p)));
      toast.success('Check-in is now limited to within 300 m of where you are standing.');
    }, () => { setLockBusy(false); toast.error('Location was blocked. Allow location access and try again.'); }, { enableHighAccuracy: true, timeout: 15000 });
  };
  const removeLock = async () => {
    const { error } = await updateProgramme(selectedProgramme.id, { geo_lat: null, geo_lng: null });
    if (error) { toast.error(error.message); return; }
    setProgrammes(list => list.map(p => (p.id === selectedProgramme.id ? { ...p, geo_lat: null, geo_lng: null, geo_radius_m: null } : p)));
    toast.info('Venue lock removed.');
  };
  const venueLat = selectedProgramme?.geo_lat;
  const venueLocked = venueLat !== null && venueLat !== undefined && venueLat !== '';

  useEffect(() => {
    let current = true;
    getProgrammes()
      .then(data => { if (current) setProgrammes(data); })
      .catch(error => { if (current) setMessage({ type: 'danger', text: error.message }); })
      .finally(() => { if (current) setLoadingProgrammes(false); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    setRecords([]);
    if (!selectedProgrammeId) return;
    let current = true;
    getProgrammeRecords({ programmeId: selectedProgrammeId, date: selectedDate })
      .then(data => { if (current) setRecords(data); })
      .catch(error => { if (current) setMessage({ type: 'danger', text: error.message }); });
    return () => { current = false; };
  }, [selectedProgrammeId, selectedDate]);

  const copyLink = async () => {
    await navigator.clipboard?.writeText(checkInUrl);
    setMessage({ type: 'success', text: 'Check-in link copied.' });
  };

  const handleCreateProgramme = async () => {
    if (!newProgramme.name) {
      setMessage({ type: 'warning', text: 'Programme name is required.' });
      return;
    }
    const payload = {
      id: `custom-${slugify(newProgramme.name)}-${Date.now()}`,
      name: newProgramme.name,
      programme_type: newProgramme.programme_type || 'custom',
      start_date: newProgramme.start_date || null,
      end_date: newProgramme.end_date || null,
      total_days: newProgramme.total_days ? Number(newProgramme.total_days) : null,
      is_active: true,
    };
    const { data, error } = await createProgramme(payload);
    if (error) {
      setMessage({ type: 'danger', text: error.message });
      return;
    }
    setProgrammes(list => [data, ...list]);
    setProgrammeId(data.id);
    setShowProgrammeModal(false);
    setNewProgramme({ name: '', programme_type: 'custom', start_date: TODAY, end_date: '', total_days: '' });
    setMessage({ type: 'success', text: 'Programme created.' });
  };

  const presentCount = records.filter(r => r.status === 'Present').length;
  const uniquePhones = new Set(records.map(r => normalizePhone(r.phone)).filter(Boolean)).size;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {message && <Alert type={message.type} message={message.text} onDismiss={() => setMessage(null)} />}
      {projector && selectedProgramme && <ProjectorMode name={selectedProgramme.name} qrImage={qrImage} secondsLeft={secondsLeft} count={presentCount} onClose={() => setProjector(false)} />}

      {loadingProgrammes && <Skeleton w="100%" h={180} />}
      {!loadingProgrammes && !selectedProgramme && (
        <Panel title="No active programmes">
          <Btn onClick={() => setShowProgrammeModal(true)}><PlusCircle size={14} /> Create Programme</Btn>
        </Panel>
      )}
      {selectedProgramme && <Grid cols="minmax(280px, 380px) 1fr" gap={16}>
        <Panel title="Daily QR Code">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Select
              label="Programme"
              value={selectedProgramme.id}
              onChange={setProgrammeId}
              options={programmes.map(p => ({ value: p.id, label: p.name }))}
            />
            <Input label="Attendance Date" type="date" value={selectedDate} onChange={setSelectedDate} />

            {selectedDate !== TODAY && <Alert type="warning" message="Self check-in only works for today's date. Set the date to today." />}
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, background: C.pageBg, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              {qrImage
                ? <img src={qrImage} alt="Attendance QR code. It refreshes every minute." style={{ width: '100%', maxWidth: 280, aspectRatio: '1 / 1', objectFit: 'contain', background: C.qrLight, borderRadius: 8 }} />
                : <Skeleton w={260} h={260} />}
              <div style={{ fontSize: 12, color: C.textSecondary }} aria-live="off">New code in <strong className="num">{secondsLeft}s</strong>. Show it on a screen in the room.</div>
            </div>
            <Btn color={C.gold} onClick={() => setProjector(true)} disabled={!qrImage}><Presentation size={14} /> Projector mode</Btn>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Btn onClick={copyLink} color={C.navy} disabled={!token}><Copy size={14} /> Copy Link</Btn>
              <Btn variant="outline" color={C.gold} disabled={!token} onClick={() => window.open(checkInUrl, '_blank', 'noopener,noreferrer')}><Smartphone size={14} /> Open Form</Btn>
              <Btn variant="ghost" color={C.success} onClick={() => setShowProgrammeModal(true)}><PlusCircle size={14} /> Custom</Btn>
            </div>

            <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: C.textPrimary }}><MapPin size={15} aria-hidden /> Venue lock {venueLocked ? <Badge label={`On · ${selectedProgramme.geo_radius_m || 300} m`} color={C.success} /> : <Badge label="Off" color={C.warning} />}</div>
              <div style={{ fontSize: 12, color: C.textSecondary, lineHeight: 1.5 }}>{venueLocked ? 'People can only check in when their phone is at the venue.' : 'Stand in the venue and lock check-in to this location so nobody can check in from home.'}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Btn size="sm" variant="outline" color={C.info} onClick={lockToHere} loading={lockBusy}><Lock size={13} /> {venueLocked ? 'Re-lock to my location' : 'Lock to my location'}</Btn>
                {venueLocked && <Btn size="sm" variant="ghost" color={C.danger} onClick={removeLock}>Remove lock</Btn>}
              </div>
            </div>
          </div>
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Grid cols="repeat(3, 1fr)" gap={10}>
            <StatCard label="Programme" value={selectedProgramme.name.split(' ')[0]} icon={<Calendar size={16} />} color={C.gold} />
            <StatCard label="Present Today" value={presentCount} icon={<ClipboardCheck size={16} />} color={C.success} />
            <StatCard label="Unique Phones" value={uniquePhones} icon={<Users size={16} />} color={C.blue} />
          </Grid>

          <Panel title={`${selectedProgramme.name} - ${selectedDate}`}>
            <DataTable
              columns={[
                { key: 'attendee_name', label: 'Name', render: v => <strong style={{ color: C.textPrimary }}>{v}</strong> },
                { key: 'phone', label: 'Phone' },
                { key: 'salem_family', label: 'Salem Family', render: v => v || '-' },
                { key: 'department', label: 'Department', render: v => v || '-' },
                { key: 'church_position', label: 'Position', render: v => <Badge label={v || 'Member'} color={C.purple} /> },
                { key: 'marked_at', label: 'Time', render: v => v ? new Date(v).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }) : '-' },
              ]}
              rows={records}
              emptyText="No QR check-ins for this date yet."
            />
          </Panel>
        </div>
      </Grid>}

      {showProgrammeModal && (
        <Modal title="Create Custom Programme" onClose={() => setShowProgrammeModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Input label="Programme Name *" value={newProgramme.name} onChange={v => setNewProgramme({ ...newProgramme, name: v })} placeholder="e.g. Leaders Retreat" required />
            <Select label="Programme Type" value={newProgramme.programme_type} onChange={v => setNewProgramme({ ...newProgramme, programme_type: v })} options={[
              { value: 'service', label: 'Service' },
              { value: 'custom', label: 'Custom Programme' },
              { value: 'department', label: 'Department Programme' },
            ]} />
            <div className="sicc-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: 10 }}>
              <Input label="Start Date" type="date" value={newProgramme.start_date} onChange={v => setNewProgramme({ ...newProgramme, start_date: v })} />
              <Input label="End Date" type="date" value={newProgramme.end_date} onChange={v => setNewProgramme({ ...newProgramme, end_date: v })} />
              <Input label="Days" type="number" value={newProgramme.total_days} onChange={v => setNewProgramme({ ...newProgramme, total_days: v })} />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Btn variant="outline" color={C.textSecondary} onClick={() => setShowProgrammeModal(false)}>Cancel</Btn>
              <Btn onClick={handleCreateProgramme} color={C.navy}>Create Programme</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function PublicAttendanceCheckIn() {
  const params = new URLSearchParams(window.location.search);
  const programmeId = params.get('programme');
  const token = params.get('t') || '';
  const [programme, setProgramme] = useState(null);
  const [loadingProgramme, setLoadingProgramme] = useState(Boolean(programmeId));
  const [lookup, setLookup] = useState({ name: '', phone: '' });
  const [details, setDetails] = useState({ date_of_birth: '' });
  const [checked, setChecked] = useState(false);
  const [stage, setStage] = useState('lookup');
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    if (!programmeId) return;
    let current = true;
    getProgrammes(true)
      .then(data => { if (current) setProgramme(data.find(p => p.id === programmeId) || null); })
      .catch(error => { if (current) setAlert({ type: 'danger', text: error.message }); })
      .finally(() => { if (current) setLoadingProgramme(false); });
    return () => { current = false; };
  }, [programmeId]);

  const handleLookup = e => {
    e.preventDefault();
    if (!lookup.name.trim() || !lookup.phone.trim()) {
      setAlert({ type: 'warning', text: 'Enter your registered full name and phone number to continue.' });
      return;
    }
    setAlert(null);
    setStage('confirm');
  };

  const submit = async e => {
    e.preventDefault();
    if (!programme) return;
    if (!checked) {
      setAlert({ type: 'warning', text: 'Tick the attendance confirmation box before submitting.' });
      return;
    }
    if (!details.date_of_birth) {
      setAlert({ type: 'warning', text: 'Date of Birth is required.' });
      return;
    }
    if (!lookup.name.trim() || !lookup.phone.trim()) {
      setAlert({ type: 'warning', text: 'Enter your full name and phone number.' });
      return;
    }
    setLoading(true);
    const checkIn = {
      programme_id: programme.id,
      attendance_date: TODAY,
      attendee_name: lookup.name.trim(),
      phone: lookup.phone,
      date_of_birth: details.date_of_birth,
      token,
    };
    if (programme.geo_required) {
      try {
        const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }));
        Object.assign(checkIn, { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
      } catch {
        setAlert({ type: 'warning', text: 'This programme checks that you are at the venue. Please allow location access in your browser, then try again.' });
        setLoading(false);
        return;
      }
    }
    const result = await savePublicCheckIn(checkIn);
    if (result.error) {
      const code = result.error.code;
      setAlert({ type: code === 'duplicate' ? 'info' : 'danger', text: code === 'token_expired' ? 'This check-in code has expired. Please scan the code on the screen again.' : result.error.message });
      setLoading(false);
      return;
    }
    setStage('done');
    setLoading(false);
  };

  return (
    <div style={{ minHeight: '100vh', background: C.pageBg, padding: '24px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 520 }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <img src="/salem-logo.png" alt="Salem" style={{ width: 64, height: 64, objectFit: 'contain', marginBottom: 10 }} />
          {programme && <div style={{ fontSize: 21, fontWeight: 700, color: C.navy }}>{programme.name}</div>}
          <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 4 }}>Attendance Check-in</div>
        </div>

        <Panel>
          {alert && <div style={{ marginBottom: 14 }}><Alert type={alert.type} message={alert.text} onDismiss={() => setAlert(null)} /></div>}
          {loadingProgramme && <p role="status">Loading programme…</p>}
          {!loadingProgramme && !programme && <p>This programme is unavailable. Scan the current check-in code.</p>}

          {programme && stage === 'lookup' && (
            <form onSubmit={handleLookup} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Input label="Full Name" value={lookup.name} onChange={v => setLookup({ ...lookup, name: v })} placeholder="Enter your name" />
              <Input label="Phone number" value={lookup.phone} onChange={v => setLookup({ ...lookup, phone: v })} placeholder="08XXXXXXXXX" />
              <Btn type="submit" color={C.navy} size="lg">Continue</Btn>
            </form>
          )}

          {programme && stage === 'confirm' && (
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ background: C.infoBg, border: `1px solid ${C.info}25`, borderRadius: 10, padding: 12, fontSize: 13, color: C.textSecondary }}>
                Check-in is available to registered attendees. Enter your details as they appear in your church record.
              </div>

              <Input label="Attendance Date" type="date" value={TODAY} disabled hint="Check-in is only for today." />
              {programme.geo_required && <div style={{ fontSize: 12, color: C.textSecondary }}>Your phone will ask to share your location to confirm you are at the venue. It is used once and not stored.</div>}
              <Input label="Date of Birth *" type="date" value={details.date_of_birth} onChange={v => setDetails({ ...details, date_of_birth: v })} required />

              <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 12, border: `1px solid ${C.border}`, borderRadius: 10, background: C.inputBg, cursor: 'pointer' }}>
                <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} style={{ marginTop: 2 }} />
                <span style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.45 }}>I confirm that I attended {programme.name} on {TODAY}.</span>
              </label>

              <div style={{ display: 'flex', gap: 10 }}>
                <Btn type="submit" color={C.success} size="lg" disabled={loading}>{loading ? 'Submitting...' : 'Submit Attendance'}</Btn>
                <Btn variant="outline" color={C.textSecondary} onClick={() => { setStage('lookup'); setChecked(false); }}>Back</Btn>
              </div>
            </form>
          )}

          {stage === 'done' && (
            <div style={{ textAlign: 'center', padding: '20px 6px' }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, margin: '0 auto 12px', background: C.successBg, color: C.success, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckSquare size={26} />
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary, marginBottom: 6 }}>Attendance recorded</div>
              <div style={{ fontSize: 13, color: C.textSecondary }}>Thank you. Your check-in for {TODAY} has been saved.</div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
