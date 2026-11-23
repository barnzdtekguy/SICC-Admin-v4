import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, Bell, CalendarDays, ChevronLeft, ClipboardCheck, Inbox, MessageSquare, Phone, TrendingUp, Users } from 'lucide-react';
import { getNotifications, markNotificationRead } from '../../lib/db';
import FloatingCard from './FloatingCard';
import { Btn } from './UI';

const sequenceIcons = { attendance: CalendarDays, approval: ClipboardCheck, followup: Phone, message: MessageSquare,
  red_leader_signup: Users, red_member_join: Users, red_report_submitted: ClipboardCheck, red_pace_reminder: TrendingUp };

function notificationTime(value) {
  if (!value) return { label: '', dateTime: undefined };
  const iso = String(value).replace(' ', 'T');
  const time = new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
  const seconds = (Date.now() - time.getTime()) / 1000;
  if (!Number.isFinite(seconds)) return { label: '', dateTime: undefined };
  const label = seconds < 60 ? 'Now' : seconds < 3600 ? `${Math.floor(seconds / 60)}m` :
    seconds < 86400 ? `${Math.floor(seconds / 3600)}h` : `${Math.floor(seconds / 86400)}d`;
  return { label, dateTime: time.toISOString() };
}

function UnreadLabel() {
  return <span className="notification-unread-label"><span className="notification-unread" aria-hidden="true" />Unread</span>;
}

export default function NotificationBell({ onNavigate }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [detail, setDetail] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const trigger = useRef(null);
  const detailHeading = useRef(null);
  const lastOpened = useRef(null);
  const generation = useRef(0);
  const pending = useRef(new Set());
  const dialogId = useId();
  const selectedId = detail?.item.id;

  const load = useCallback(async () => {
    const request = ++generation.current;
    try {
      const result = await getNotifications();
      if (request === generation.current) {
        setData(result);
        setLoadError(false);
      }
    } catch {
      if (request === generation.current) setLoadError(true);
    }
  }, []);

  useEffect(() => {
    load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      generation.current++;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  useEffect(() => {
    const timer = setInterval(load, open ? 15000 : 60000);
    return () => clearInterval(timer);
  }, [load, open]);

  useLayoutEffect(() => {
    if (!open) return;
    if (selectedId) {
      lastOpened.current = selectedId;
      const heading = detailHeading.current;
      heading.closest('.floating-card-content').scrollTop = 0;
      heading.focus({ preventScroll: true });
    } else if (lastOpened.current) {
      const row = document.getElementById(`${dialogId}-notification-${lastOpened.current}`);
      (row || document.getElementById(dialogId)?.querySelector('.floating-card-close'))?.focus();
      lastOpened.current = null;
    }
  }, [dialogId, open, selectedId]);

  const close = useCallback(() => {
    lastOpened.current = null;
    setOpen(false);
    setShowAll(false);
    setDetail(null);
  }, []);

  const markRead = async item => {
    const { id, read_at: readAt } = item;
    if (readAt || pending.current.has(id)) return;
    pending.current.add(id);
    setDetail(current => current?.item.id === id && current.error ? { ...current, error: false } : current);
    try {
      await markNotificationRead(id);
      const read_at = new Date().toISOString();
      generation.current++;
      setDetail(current => current?.item.id === id ? { item: { ...current.item, read_at }, error: false } : current);
      setData(current => {
        if (!current?.items.some(item => item.id === id && !item.read_at)) return current;
        return {
          unread: Math.max(0, current.unread - 1),
          items: current.items.map(item => item.id === id ? { ...item, read_at } : item),
        };
      });
    } catch {
      setDetail(current => current?.item.id === id ? { ...current, error: true } : current);
    } finally {
      pending.current.delete(id);
    }
  };

  const select = item => {
    setDetail({ item, error: false });
    markRead(item);
  };

  const items = data?.items || [];
  const unread = data?.unread || 0;
  const selected = detail && (items.find(item => item.id === selectedId) || detail.item);
  const selectedTime = selected && notificationTime(selected.created_at);

  return (
    <div className="notification-bell">
      <button ref={trigger} type="button" className="notification-trigger" data-tour-target="notifications"
        onClick={open ? close : () => { setOpen(true); load(); }}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-haspopup="dialog"
        aria-expanded={open} aria-controls={open ? dialogId : undefined}>
        <Bell size={20} strokeWidth={1.75} aria-hidden="true" />
        {unread > 0 && <span className="notification-count" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <FloatingCard id={dialogId} title="Notifications" triggerRef={trigger} onClose={close}
          footer={!selected && items.length > 6 && <button type="button" className="notification-see-all" onClick={() => setShowAll(all => !all)}>{showAll ? 'See recent' : 'See all'}</button>}>
          {selected ? (
            <div className="notification-full">
              <div><Btn variant="ghost" onClick={() => setDetail(null)}><ChevronLeft size={16} aria-hidden="true" /> Back to notifications</Btn></div>
              <article aria-labelledby={`${dialogId}-detail`}>
                <div className="notification-full-meta">
                  <time dateTime={selectedTime.dateTime}>{selectedTime.label}</time>
                  <span aria-live="polite">{selected.read_at ? 'Read' : <UnreadLabel />}</span>
                </div>
                <h3 ref={detailHeading} id={`${dialogId}-detail`} tabIndex={-1}>{selected.title}</h3>
                {selected.body && <p className="notification-full-body">{selected.body}</p>}
              </article>
              {detail.error && !selected.read_at && (
                <div className="notification-read-error">
                  <p role="status">Couldn’t mark that notification as read.</p>
                  <Btn variant="outline" onClick={() => markRead(selected)}>Try again</Btn>
                </div>
              )}
              {selected.link && <div><Btn variant="outline" onClick={() => { close(); onNavigate(selected.link); }}>
                Open related page <ArrowRight size={16} aria-hidden="true" />
              </Btn></div>}
            </div>
          ) : (
            <>
              {!data && !loadError && <p className="notification-message" role="status">Loading notifications…</p>}
              {loadError && <div className="notification-message">{data ? 'Couldn’t refresh notifications.' : 'Notifications are unavailable.'} <button type="button" onClick={load}>Try again</button></div>}
              {data && !loadError && items.length === 0 && (
                <div className="notification-message"><Inbox size={24} strokeWidth={1.75} aria-hidden="true" />You’re all caught up.</div>
              )}
              <ul className="notification-list">
                {(showAll ? items : items.slice(0, 6)).map(item => {
                  const Icon = sequenceIcons[item.type] || Bell;
                  const time = notificationTime(item.created_at);
                  return (
                    <li key={item.id}>
                      <button type="button" className="notification-row" id={`${dialogId}-notification-${item.id}`} onClick={() => select(item)}
                        aria-label={item.read_at ? item.title : `${item.title}, unread`}>
                        <span className="notification-icon"><Icon size={20} strokeWidth={1.75} aria-hidden="true" /></span>
                        <span className="notification-copy">
                          <strong>{item.title}</strong>
                          {item.body && <span className="notification-detail">{item.body}</span>}
                        </span>
                        <span className="notification-meta">
                          <time dateTime={time.dateTime}>{time.label}</time>
                          {!item.read_at && <UnreadLabel />}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </FloatingCard>
      )}
    </div>
  );
}
