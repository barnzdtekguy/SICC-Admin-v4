import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { ROLES, ROLE_LABELS } from '../../data/constants';
import { onQueueChange, flushQueue } from '../../lib/offlineQueue';
import { onInstallAvailable, promptInstall } from '../../lib/pwa';
import NotificationBell from './NotificationBell';
import CommandPalette from './CommandPalette';
import MemberDrawer from './MemberDrawer';
import FloatingCard from './FloatingCard';
import '../../styles/app-shell.css';
import '../../styles/role-home.css';
import {
  LayoutDashboard, TrendingUp, UserCog, ClipboardList, MapPin, Building2, Phone, Radio, BarChart2, Pin, Users, CheckSquare,
  Settings, PlusCircle, LogOut, ChevronLeft, ChevronRight, QrCode, ShieldCheck, ScrollText, Inbox, LineChart,
  Search, Sun, Moon, Download, WifiOff, RefreshCw, Home, MoreHorizontal,
} from 'lucide-react';

const ICON = {
  overview: LayoutDashboard, growth: TrendingUp, staff: UserCog, members: ClipboardList, kdf: MapPin, departments: Building2, followups: Phone,
  communication: Radio, reports: BarChart2, assignments: Pin, users: Users, attendance: CheckSquare, settings: Settings, register: PlusCircle,
  myMembers: Users, followup: Phone, deptMembers: Users, kdfMembers: Users, programmes: QrCode, security: ShieldCheck, audit: ScrollText, approvals: Inbox, insights: LineChart,
};


const GOV = [
  { key: 'approvals', label: 'Approvals', group: 'Governance' },
  { key: 'audit', label: 'Audit trail', group: 'Governance' },
  { key: 'insights', label: 'Analytics & exports', group: 'Governance' },
];
const SECURITY = { key: 'security', label: 'Security & devices', group: 'Account' };

export const NAV = {
  [ROLES.BISHOP]: [
    { key: 'overview', label: 'Overview' }, { key: 'growth', label: 'Church growth' }, { key: 'staff', label: 'Staff monitor' }, { key: 'members', label: 'All members' },
    { key: 'kdf', label: 'KDF areas' }, { key: 'departments', label: 'Departments' }, { key: 'followups', label: 'Follow-up reports' }, { key: 'programmes', label: 'Programme attendance' },
    { key: 'communication', label: 'Communication' }, { key: 'reports', label: 'Reports' }, { key: 'assignments', label: 'Assignments' }, { key: 'users', label: 'User accounts', group: 'Governance' }, ...GOV, SECURITY,
  ],
  [ROLES.ADMIN]: [
    { key: 'overview', label: 'Dashboard' }, { key: 'users', label: 'User management' }, { key: 'staff', label: 'Staff management' }, { key: 'members', label: 'All members' },
    { key: 'departments', label: 'Departments' }, { key: 'kdf', label: 'KDF management' }, { key: 'attendance', label: 'Attendance' }, { key: 'followups', label: 'Follow-up reports' },
    { key: 'programmes', label: 'Programme attendance' }, { key: 'reports', label: 'Reports' }, { key: 'settings', label: 'Settings' }, ...GOV, SECURITY,
  ],
  [ROLES.PASTOR]: [
    { key: 'overview', label: 'My dashboard' }, { key: 'register', label: 'Register member' }, { key: 'myMembers', label: 'My members' }, { key: 'followup', label: 'Follow-up' },
    { key: 'programmes', label: 'Programme attendance' }, { key: 'reports', label: 'My reports' }, { key: 'approvals', label: 'My corrections', group: 'Governance' }, SECURITY,
  ],
  [ROLES.DEPARTMENT_LEADER]: [
    { key: 'overview', label: 'My dashboard' }, { key: 'deptMembers', label: 'Department members' }, { key: 'attendance', label: 'Attendance' },
    { key: 'reports', label: 'Reports' }, { key: 'approvals', label: 'My corrections', group: 'Governance' }, SECURITY,
  ],
  [ROLES.KDF_COORDINATOR]: [
    { key: 'overview', label: 'My dashboard' }, { key: 'kdfMembers', label: 'Area members' }, { key: 'followup', label: 'Follow-up' }, { key: 'reports', label: 'Area reports' }, SECURITY,
  ],
};


const DOCK = {
  [ROLES.PASTOR]: ['myMembers', 'register', 'followup'],
  [ROLES.ADMIN]: ['members', 'attendance', 'reports'],
  [ROLES.BISHOP]: ['members', 'programmes', 'reports'],
  [ROLES.DEPARTMENT_LEADER]: ['deptMembers', 'attendance', 'reports'],
  [ROLES.KDF_COORDINATOR]: ['kdfMembers', 'followup', 'reports'],
};

const icon = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

function Sidebar({ groups, activeTab, collapsed, onToggle, onGo }) {
  return (
    <nav aria-label="Main" className="app-sidebar" data-collapsed={collapsed}>
      <div className="app-sidebar-brand">
        <img src="/salem-logo.png" alt="" width="38" height="38" />
        {!collapsed && <div><div className="display">SICC Admin</div><small>Salem International</small></div>}
      </div>
      <div className="app-sidebar-groups">
        {groups.map(({ group, items }) => (
          <div key={group} className="app-sidebar-group">
            {group !== 'Main' && !collapsed && <p>{group}</p>}
            {items.map(({ key, label }) => {
              const Icon = ICON[key];
              return (
                <button key={key} type="button" onClick={() => onGo(key)} aria-current={activeTab === key ? 'page' : undefined}
                  aria-label={collapsed ? label : undefined} title={collapsed ? label : undefined}>
                  <Icon {...icon} />{!collapsed && <span>{label}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <button type="button" className="app-sidebar-collapse" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        {collapsed ? <ChevronRight {...icon} /> : <><ChevronLeft {...icon} /> Collapse</>}
      </button>
    </nav>
  );
}

export default function Layout({ activeTab, setActiveTab, mobile, children }) {
  const { profile, logout } = useAuth();
  const { effective, setMode } = useTheme();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [memberId, setMemberId] = useState(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [pending, setPending] = useState(0);
  const [canInstall, setCanInstall] = useState(false);
  const main = useRef(null);
  const accountTrigger = useRef(null);
  const moreTrigger = useRef(null);
  const accountId = useId();
  const moreId = useId();

  const role = profile.role;
  const nav = NAV[role] || [];
  const pageName = nav.find(item => item.key === activeTab)?.label || 'Dashboard';
  const dockKeys = ['overview', ...(DOCK[role] || [])];
  const initials = profile.avatar || (profile.name || '?').split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase();
  const roleLabel = ROLE_LABELS[role];
  const dark = effective === 'dark';
  const themeLabel = dark ? 'Switch to light theme' : 'Switch to dark theme';
  const ThemeIcon = dark ? Sun : Moon;

  const close = useCallback(() => setOpen(null), []);
  const toggle = name => setOpen(current => current === name ? null : name);
  const go = useCallback(key => { close(); setActiveTab(key); }, [close, setActiveTab]);
  const showSearch = () => { close(); setPaletteOpen(true); };

  useEffect(() => {
    main.current?.scrollTo?.({ top: 0 });
    document.title = `${pageName} · SICC Admin`;
  }, [activeTab, pageName]);
  useEffect(() => {
    if (!mobile && open === 'more') close();
  }, [mobile, open, close]);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync); };
  }, []);
  useEffect(() => onQueueChange(setPending), []);
  useEffect(() => {
    const showMember = e => setMemberId(e.detail);
    window.addEventListener('sicc:open-member', showMember);
    return () => window.removeEventListener('sicc:open-member', showMember);
  }, []);
  useEffect(() => onInstallAvailable(setCanInstall), []);
  useEffect(() => {
    const key = e => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'k') return;
      if (document.querySelector('.floating-card-layer')) return;
      e.preventDefault();
      setPaletteOpen(value => !value);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const grouped = useMemo(() => {
    const groups = new Map();
    for (const page of nav) {
      const group = page.group || 'Main';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(page);
    }
    return [...groups].map(([group, items]) => ({ group, items }));
  }, [nav]);
  const switchTheme = () => { close(); setMode(dark ? 'light' : 'dark'); };
  const actions = [
    { label: themeLabel, icon: 'theme', run: switchTheme },
    { label: 'Sign out', icon: 'out', run: logout },
  ];

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">Skip to content</a>
      <Sidebar groups={grouped} activeTab={activeTab} collapsed={collapsed} onToggle={() => setCollapsed(value => !value)} onGo={go} />
      <div className="app-workspace">
        <header className="app-main-header">
          <button type="button" className="app-mobile-brand" onClick={() => go('overview')} aria-label="SICC Admin home">
            <img src="/salem-logo.png" alt="" width="40" height="40" />
            <span>{activeTab === 'overview' ? 'SICC Admin' : pageName}</span>
          </button>
          <div className="app-page-title display">{pageName}</div>
          <button type="button" className="app-header-button app-search-btn" onClick={showSearch} aria-label="Search (Ctrl K)">
            <Search {...icon} /><span>Search</span>
          </button>
          <button type="button" className="app-header-button app-theme-btn" onClick={switchTheme} aria-label={themeLabel}>
            <ThemeIcon {...icon} />
          </button>
          <NotificationBell onNavigate={link => { close(); navigate(link); }} />
          <button ref={accountTrigger} type="button" className="app-header-button app-account-btn" onClick={() => toggle('account')}
            aria-haspopup="dialog" aria-expanded={open === 'account'} aria-controls={open === 'account' ? accountId : undefined} aria-label="Account menu">
            <span aria-hidden="true">{initials}</span>
          </button>
          {open === 'account' && (
            <FloatingCard id={accountId} title="Account" triggerRef={accountTrigger} onClose={close} width={320}>
              <div className="floating-card-account"><strong>{profile.name}</strong><small>{[roleLabel, profile.department || profile.kdf_area].filter(Boolean).join(' · ')}</small></div>
              <div className="floating-card-actions">
                <button type="button" onClick={() => go('security')}><ShieldCheck {...icon} /> Security & devices</button>
                <button type="button" onClick={switchTheme}><ThemeIcon {...icon} /> {themeLabel}</button>
                {canInstall && <button type="button" onClick={() => { close(); promptInstall(); }}><Download {...icon} /> Install app on this device</button>}
                <button type="button" onClick={() => { close(); logout(); }}><LogOut {...icon} /> Sign out</button>
              </div>
            </FloatingCard>
          )}
        </header>

        {(!online || pending > 0) && (
          <div role="status" className="app-network-status no-print">
            {online ? <RefreshCw {...icon} /> : <WifiOff {...icon} />}
            <span>{!online ? 'You’re offline. ' : ''}{pending > 0 ? `${pending} attendance ${pending === 1 ? 'entry is' : 'entries are'} saved on this phone and will be sent automatically.` : 'Showing the last loaded data until you reconnect.'}</span>
            {online && pending > 0 && <button type="button" onClick={() => flushQueue()}>Send now</button>}
          </div>
        )}

        <main id="main" ref={main} tabIndex={-1} className="app-main">
          <div className="app-main-content">{children}</div>
        </main>

        {mobile && (
          <nav className="app-dock no-print" aria-label={`${roleLabel} mobile navigation`}>
            {dockKeys.map((key, index) => {
              const page = nav.find(item => item.key === key);
              const center = index === 2;
              const Icon = key === 'overview' ? Home : ICON[key];
              const label = index === 0 ? 'Home' : index === 1 ? 'Members' : page?.label;
              return (
                <button key={key} type="button" className={center ? 'app-dock-center' : undefined}
                  onClick={() => go(key)} aria-current={activeTab === key ? 'page' : undefined}>
                  <Icon {...icon} size={center ? 24 : 20} />
                  <span className={center ? 'sr-only' : undefined}>{label}</span>
                </button>
              );
            })}
            <button ref={moreTrigger} type="button" onClick={() => toggle('more')} aria-haspopup="dialog"
              aria-expanded={open === 'more'} aria-controls={open === 'more' ? moreId : undefined}>
              <MoreHorizontal {...icon} /><span>More</span>
            </button>
          </nav>
        )}
        {mobile && open === 'more' && (
          <FloatingCard id={moreId} title="More pages" triggerRef={moreTrigger} onClose={close} mobileSheet>
            <div className="floating-card-actions">
              <button type="button" onClick={showSearch}><Search {...icon} /><span>Search SICC Admin</span><ChevronRight {...icon} /></button>
              {nav.filter(page => !dockKeys.includes(page.key)).map(({ key, label }) => {
                const Icon = ICON[key];
                return <button key={key} type="button" onClick={() => go(key)} aria-current={activeTab === key ? 'page' : undefined}><Icon {...icon} /><span>{label}</span><ChevronRight {...icon} /></button>;
              })}
              <button type="button" onClick={switchTheme}><ThemeIcon {...icon} /><span>{themeLabel}</span></button>
            </div>
          </FloatingCard>
        )}
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} pages={nav} onGo={go} onOpenMember={setMemberId} actions={actions} />
      {memberId && <MemberDrawer memberId={memberId} onClose={() => setMemberId(null)} />}
    </div>
  );
}
