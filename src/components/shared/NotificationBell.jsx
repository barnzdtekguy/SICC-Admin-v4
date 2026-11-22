import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Bell, CalendarDays, ClipboardCheck, Inbox, MessageSquare, Phone } from 'lucide-react';
import { getNotifications, markNotificationRead } from '../../lib/db';
import FloatingCard from './FloatingCard';

const sequenceIcons = { attendance: CalendarDays, approval: ClipboardCheck, followup: Phone, message: MessageSquare };

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

export default function NotificationBell({ onNavigate }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [readError, setReadError] = useState(false);
  const trigger = useRef(null);
  const generation = useRef(0);
  const pending = useRef(new Set());
  const dialogId = useId();

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
    const timer = setInterval(load, 60000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      generation.current++;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const close = useCallback(() => {
    setOpen(false);
    setShowAll(false);
    setExpanded(null);
  }, []);

  const select = async notification => {
    const { id, link, read_at: readAt } = notification;
    setReadError(false);
    if (link) {
      close();
      onNavigate(link);
    } else {
      setExpanded(current => current === id ? null : id);
    }
    if (readAt || pending.current.has(id)) return;
    pending.current.add(id);
    try {
      await markNotificationRead(id);
      generation.current++;
      setData(current => {
        if (!current?.items.some(item => item.id === id && !item.read_at)) return current;
        return {
          unread: Math.max(0, current.unread - 1),
          items: current.items.map(item => item.id === id ? { ...item, read_at: new Date().toISOString() } : item),
        };
      });
    } catch {
      setReadError(true);
    } finally {
      pending.current.delete(id);
    }
  };

  const items = data?.items || [];
  const unread = data?.unread || 0;

  return (
    <div className="notification-bell">
      <button ref={trigger} type="button" className="notification-trigger"
        onClick={open ? close : () => { setOpen(true); if (loadError) load(); }}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-haspopup="dialog"
        aria-expanded={open} aria-controls={open ? dialogId : undefined}>
        <Bell size={20} strokeWidth={1.75} aria-hidden="true" />
        {unread > 0 && <span className="notification-count" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <FloatingCard id={dialogId} title="Notifications" triggerRef={trigger} onClose={close}
          footer={items.length > 6 && <button type="button" className="notification-see-all" onClick={() => setShowAll(all => !all)}>{showAll ? 'See recent' : 'See all'}</button>}>
          {readError && <p className="notification-message" role="status">Couldn’t mark that notification as read. Try again.</p>}
          {!data && !loadError && <p className="notification-message" role="status">Loading notifications…</p>}
          {loadError && <div className="notification-message">Notifications are unavailable. <button type="button" onClick={load}>Try again</button></div>}
          {data && !loadError && items.length === 0 && (
            <div className="notification-message"><Inbox size={24} strokeWidth={1.75} aria-hidden="true" />You’re all caught up.</div>
          )}
          <ul className="notification-list">
            {(showAll ? items : items.slice(0, 6)).map(item => {
              const Icon = sequenceIcons[item.type] || Bell;
              const time = notificationTime(item.created_at);
              return (
                <li key={item.id}>
                  <button type="button" className="notification-row" onClick={() => select(item)}
                    aria-expanded={!item.link && item.body ? expanded === item.id : undefined}>
                    <span className="notification-icon"><Icon size={20} strokeWidth={1.75} aria-hidden="true" /></span>
                    <span className="notification-copy">
                      <strong>{item.title}</strong>
                      {item.body && <span className="notification-detail">{item.body}</span>}
                    </span>
                    <span className="notification-meta">
                      <time dateTime={time.dateTime}>{time.label}</time>
                      {!item.read_at && <><span className="notification-unread" aria-hidden="true" /><span className="sr-only">Unread</span></>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </FloatingCard>
      )}
    </div>
  );
}
