// src/components/shared/Layout.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { ROLES, ROLE_LABELS, ROLE_COLORS } from '../../data/constants';
import { C } from '../../lib/theme';
import { onQueueChange, flushQueue } from '../../lib/offlineQueue';
import { onInstallAvailable, promptInstall } from '../../lib/pwa';
import NotificationBell from './NotificationBell';
import CommandPalette from './CommandPalette';
import MemberDrawer from './MemberDrawer';
import {
  LayoutDashboard, TrendingUp, UserCog, ClipboardList, MapPin, Building2, Phone, Radio, BarChart2, Pin, Users, CheckSquare,
  Settings, PlusCircle, LogOut, ChevronLeft, ChevronRight, QrCode, Menu, X, ShieldCheck, ScrollText, Inbox, LineChart, Search, Sun, Moon, Download, WifiOff, RefreshCw, Home, BookOpen, MoreHorizontal,
} from 'lucide-react';

const ICON = {
  overview: LayoutDashboard, growth: TrendingUp, staff: UserCog, members: ClipboardList, kdf: MapPin, departments: Building2, followups: Phone,
  communication: Radio, reports: BarChart2, assignments: Pin, users: Users, attendance: CheckSquare, settings: Settings, register: PlusCircle,
  myMembers: ClipboardList, followup: Phone, deptMembers: Users, kdfMembers: Users, programmes: QrCode, security: ShieldCheck, audit: ScrollText, approvals: Inbox, insights: LineChart,
};

const GOV = [
  { key: 'approvals', label: 'Approvals', group: 'Governance' },
  { key: 'audit', label: 'Audit Trail', group: 'Governance' },
  { key: 'insights', label: 'Analytics & Exports', group: 'Governance' },
];
const SECURITY = { key: 'security', label: 'Security & Devices', group: 'Account' };

export const NAV = {
  [ROLES.BISHOP]: [
    { key: 'overview', label: 'Overview' }, { key: 'growth', label: 'Church Growth' }, { key: 'staff', label: 'Staff Monitor' }, { key: 'members', label: 'All Members' },
    { key: 'kdf', label: 'KDF Areas' }, { key: 'departments', label: 'Departments' }, { key: 'followups', label: 'Follow-Up Reports' }, { key: 'programmes', label: 'Programme Attendance' },
    { key: 'communication', label: 'Communication' }, { key: 'reports', label: 'Reports' }, { key: 'assignments', label: 'Assignments' }, { key: 'users', label: 'User Accounts', group: 'Governance' }, ...GOV, SECURITY,
  ],
  [ROLES.ADMIN]: [
    { key: 'overview', label: 'Dashboard' }, { key: 'users', label: 'User Management' }, { key: 'staff', label: 'Staff Management' }, { key: 'members', label: 'All Members' },
    { key: 'departments', label: 'Departments' }, { key: 'kdf', label: 'KDF Management' }, { key: 'attendance', label: 'Attendance' }, { key: 'followups', label: 'Follow-Up Reports' },
    { key: 'programmes', label: 'Programme Attendance' }, { key: 'reports', label: 'Reports' }, { key: 'settings', label: 'Settings' }, ...GOV, SECURITY,
  ],
  [ROLES.PASTOR]: [
    { key: 'overview', label: 'My Dashboard' }, { key: 'register', label: 'Register Member' }, { key: 'myMembers', label: 'My Members' }, { key: 'followup', label: 'Follow-Up' },
    { key: 'programmes', label: 'Programme Attendance' }, { key: 'reports', label: 'My Reports' }, { key: 'approvals', label: 'My Corrections', group: 'Governance' }, SECURITY,
  ],
  [ROLES.DEPARTMENT_LEADER]: [
    { key: 'overview', label: 'My Dashboard' }, { key: 'deptMembers', label: 'Dept Members' }, { key: 'attendance', label: 'Attendance' },
    { key: 'reports', label: 'Reports' }, { key: 'approvals', label: 'My Corrections', group: 'Governance' }, SECURITY,
  ],
  [ROLES.KDF_COORDINATOR]: [
    { key: 'overview', label: 'My Dashboard' }, { key: 'kdfMembers', label: 'Area Members' }, { key: 'followup', label: 'Follow-Up' }, { key: 'reports', label: 'Area Reports' }, SECURITY,
  ],
};

export default function Layout({ activeTab, setActiveTab, children }) {
  const { profile, logout } = useAuth();
  const { effective, setMode } = useTheme();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pastorMoreOpen, setPastorMoreOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [memberId, setMemberId] = useState(null);
  const [userMenu, setUserMenu] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [pending, setPending] = useState(0);
  const [canInstall, setCanInstall] = useState(false);
  const mainRef = useRef(null);
  const menuRef = useRef(null);
  const moreRef = useRef(null);
  const moreTriggerRef = useRef(null);

  const nav = NAV[profile?.role] || [];
  const roleColor = ROLE_COLORS[profile?.role] || C.gold;
  const pageName = nav.find(n => n.key === activeTab)?.label || 'Dashboard';
  const pastorMobile = profile?.role === ROLES.PASTOR;

  const go = useCallback(key => { setActiveTab(key); setMobileOpen(false); setPastorMoreOpen(false); setUserMenu(false); }, [setActiveTab]);

  // Move focus to the page and reset scroll on navigation (screen-reader and keyboard friendly).
  useEffect(() => { mainRef.current?.scrollTo?.({ top: 0 }); document.title = `${pageName} · SICC Admin`; }, [activeTab, pageName]);
  useEffect(() => { const on = () => setOnline(true); const off = () => setOnline(false); window.addEventListener('online', on); window.addEventListener('offline', off); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); }; }, []);
  useEffect(() => onQueueChange(setPending), []);
  useEffect(() => { const open = e => setMemberId(e.detail); window.addEventListener('sicc:open-member', open); return () => window.removeEventListener('sicc:open-member', open); }, []);
  useEffect(() => { if (!pastorMobile) return undefined; const onGo = e => go(e.detail); window.addEventListener('sicc:pastor-go', onGo); return () => window.removeEventListener('sicc:pastor-go', onGo); }, [pastorMobile, go]);
  useEffect(() => onInstallAvailable(setCanInstall), []);
  useEffect(() => {
    const key = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(o => !o); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (!userMenu) return undefined;
    const away = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setUserMenu(false); };
    const esc = e => e.key === 'Escape' && setUserMenu(false);
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [userMenu]);

  const grouped = useMemo(() => {
    const out = []; let last = null;
    nav.forEach(item => { const g = item.group || 'Main'; if (g !== last) { out.push({ group: g, items: [] }); last = g; } out[out.length - 1].items.push(item); });
    return out;
  }, [nav]);

  const actions = useMemo(() => [
    { label: effective === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', icon: 'theme', run: () => setMode(effective === 'dark' ? 'light' : 'dark') },
    { label: 'Sign out', icon: 'out', run: () => logout() },
  ], [effective, setMode, logout]);

  useEffect(() => {
    if (!pastorMoreOpen) return undefined;
    const sheet = moreRef.current;
    sheet?.querySelector('button')?.focus();
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); setPastorMoreOpen(false); return; }
      if (e.key !== 'Tab' || !sheet) return;
      const buttons = [...sheet.querySelectorAll('button:not([disabled])')];
      if (!buttons.length) return;
      if (e.shiftKey && document.activeElement === buttons[0]) { e.preventDefault(); buttons[buttons.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === buttons[buttons.length - 1]) { e.preventDefault(); buttons[0].focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); moreTriggerRef.current?.focus(); };
  }, [pastorMoreOpen]);
  const sidebarWidth = collapsed ? 72 : 252;
  const initials = profile?.avatar || (profile?.name || '?').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();

  const renderSidebar = mobile => (
    <nav aria-label="Main" className="app-sidebar" style={{ width: mobile ? 280 : sidebarWidth, flexShrink: 0, background: C.sidebarBg, color: '#fff', display: 'flex', flexDirection: 'column', height: '100%', transition: 'width .2s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: collapsed && !mobile ? '18px 0' : '18px 18px', justifyContent: collapsed && !mobile ? 'center' : 'flex-start', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <img src="/salem-logo.png" alt="" width="38" height="38" style={{ objectFit: 'contain', flexShrink: 0 }} />
        {(!collapsed || mobile) && <div><div className="display" style={{ fontSize: 20, lineHeight: 1 }}>SICC Admin</div><div style={{ fontSize: 11, color: 'rgba(255,255,255,.62)', marginTop: 3 }}>Salem International</div></div>}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px' }}>
        {grouped.map(section => (
          <div key={section.group} style={{ marginBottom: 6 }}>
            {section.group !== 'Main' && (!collapsed || mobile) && <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.55)', padding: '12px 10px 6px' }}>{section.group}</div>}
            {section.group !== 'Main' && collapsed && !mobile && <div aria-hidden style={{ height: 1, background: 'rgba(255,255,255,.1)', margin: '8px 6px' }} />}
            {section.items.map(item => {
              const Icon = ICON[item.key] || LayoutDashboard; const active = activeTab === item.key;
              return (
                <button key={item.key} type="button" onClick={() => go(item.key)} aria-current={active ? 'page' : undefined} title={collapsed && !mobile ? item.label : undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 42, padding: collapsed && !mobile ? '0' : '0 12px', justifyContent: collapsed && !mobile ? 'center' : 'flex-start', marginBottom: 2, borderRadius: 10, border: 'none', background: active ? 'rgba(201,168,76,.16)' : 'transparent', color: active ? C.gold : 'rgba(255,255,255,.86)', fontSize: 14, fontWeight: active ? 600 : 500, boxShadow: active ? 'inset 3px 0 0 #C9A84C' : 'none', textAlign: 'left' }}>
                  <Icon size={17} aria-hidden style={{ flexShrink: 0 }} />{(!collapsed || mobile) && <span>{item.label}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {!mobile && (
        <button type="button" onClick={() => setCollapsed(c => !c)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} style={{ margin: 10, minHeight: 38, borderRadius: 10, border: '1px solid rgba(255,255,255,.12)', background: 'transparent', color: 'rgba(255,255,255,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 13 }}>
          {collapsed ? <ChevronRight size={16} aria-hidden /> : <><ChevronLeft size={16} aria-hidden /> Collapse</>}
        </button>
      )}
    </nav>
  );

  const iconBtn = { width: 40, height: 40, borderRadius: 10, border: `1px solid ${C.border}`, background: C.cardBg, color: C.textSecondary, display: 'flex', alignItems: 'center', justifyContent: 'center' };

  return (
    <div className={pastorMobile ? 'pastor-shell' : undefined} style={{ display: 'flex', height: '100vh', background: C.pageBg, color: C.textPrimary }}>
      <a href="#main" className="skip-link">Skip to content</a>
      <div className="app-desktop-sidebar" style={{ display: 'contents' }}>{renderSidebar(false)}</div>
      {mobileOpen && (
        <div className="app-mobile-scrim" style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex' }}>
          {renderSidebar(true)}<div onClick={() => setMobileOpen(false)} style={{ flex: 1, background: 'rgba(7,14,28,.6)' }} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header className="app-main-header" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', background: C.headerBg, borderBottom: `1px solid ${C.border}`, minHeight: 64 }}>
          {pastorMobile && <div className="pastor-mobile-brand" aria-label="SICC Admin"><img src="/salem-logo.png" alt=""/><span>SICC</span></div>}
          <button type="button" className="app-menu-btn" onClick={() => setMobileOpen(o => !o)} aria-label={mobileOpen ? 'Close menu' : 'Open menu'} aria-expanded={mobileOpen} style={iconBtn}>{mobileOpen ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}</button>
          <div className="app-page-title" style={{ flex: 1, minWidth: 0 }}><div className="display" style={{ fontSize: 26, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pageName}</div></div>
          <button type="button" className="app-search-btn" onClick={() => setPaletteOpen(true)} aria-label="Search (Ctrl K)" style={{ ...iconBtn, width: 'auto', padding: '0 12px', gap: 8, color: C.textMuted, fontSize: 13 }}>
            <Search size={16} aria-hidden /><span className="app-search-label">Search</span><kbd className="app-search-label" style={{ fontSize: 11, border: `1px solid ${C.border}`, borderRadius: 6, padding: '1px 6px' }}>Ctrl K</kbd>
          </button>
          <button type="button" className="app-theme-btn" onClick={() => setMode(effective === 'dark' ? 'light' : 'dark')} aria-label={effective === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} style={iconBtn}>{effective === 'dark' ? <Sun size={17} aria-hidden /> : <Moon size={17} aria-hidden />}</button>
          <div className="pastor-notification"><NotificationBell onNavigate={link => navigate(link)} /></div>
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button type="button" onClick={() => setUserMenu(o => !o)} aria-haspopup="menu" aria-expanded={userMenu} aria-label="Account menu" style={{ display: 'flex', alignItems: 'center', gap: 10, border: 'none', background: 'transparent', padding: 2, color: C.textPrimary }}>
              <span aria-hidden style={{ width: 40, height: 40, borderRadius: 12, background: `${roleColor}22`, border: `1px solid ${roleColor}55`, color: roleColor === C.gold ? C.goldText : roleColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>{initials}</span>
            </button>
            {userMenu && (
              <div role="menu" style={{ position: 'absolute', right: 0, top: 50, width: 260, background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: 'var(--shadow-2)', zIndex: 900, overflow: 'hidden' }}>
                <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{profile?.name}</div>
                  <div style={{ fontSize: 12, color: C.textSecondary }}>{ROLE_LABELS[profile?.role]}{profile?.department ? ` · ${profile.department}` : profile?.kdf_area ? ` · ${profile.kdf_area}` : ''}</div>
                </div>
                {[{ label: 'Security & devices', icon: ShieldCheck, run: () => go('security') },
                  ...(canInstall ? [{ label: 'Install app on this device', icon: Download, run: () => { setUserMenu(false); promptInstall(); } }] : []),
                  { label: 'Sign out', icon: LogOut, run: () => logout(), danger: true }].map(m => (
                  <button key={m.label} role="menuitem" type="button" onClick={m.run} style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '12px 16px', border: 'none', background: 'transparent', color: m.danger ? C.danger : C.textPrimary, fontSize: 14, textAlign: 'left' }}>
                    <m.icon size={16} aria-hidden />{m.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>

        {(!online || pending > 0) && (
          <div role="status" className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 20px', background: online ? C.infoBg : C.warningBg, color: C.textPrimary, fontSize: 13, borderBottom: `1px solid ${C.border}` }}>
            {online ? <RefreshCw size={15} aria-hidden /> : <WifiOff size={15} aria-hidden />}
            <span style={{ flex: 1 }}>{!online ? 'You’re offline. ' : ''}{pending > 0 ? `${pending} attendance ${pending === 1 ? 'entry is' : 'entries are'} saved on this phone and will be sent automatically.` : 'Showing the last loaded data until you reconnect.'}</span>
            {online && pending > 0 && <button type="button" onClick={() => flushQueue()} style={{ background: 'none', border: 'none', color: C.info, fontWeight: 600 }}>Send now</button>}
          </div>
        )}

        <main id="main" ref={mainRef} tabIndex={-1} className="app-main" style={{ flex: 1, overflowY: 'auto', padding: 'clamp(14px, 3vw, 28px)', outline: 'none' }}>
          <div className="app-main-content" style={{ maxWidth: 1320, margin: '0 auto' }}>{children}</div>
        </main>
        {pastorMobile && <>
          <nav className="pastor-bottom-nav no-print" aria-label="Pastor mobile navigation">
            <button type="button" className={activeTab === 'overview' ? 'is-active' : ''} onClick={() => go('overview')} aria-current={activeTab === 'overview' ? 'page' : undefined}><Home size={22} aria-hidden/><span>Home</span></button>
            <button type="button" className={activeTab === 'myMembers' ? 'is-active' : ''} onClick={() => go('myMembers')} aria-current={activeTab === 'myMembers' ? 'page' : undefined}><Users size={22} aria-hidden/><span>Members</span></button>
            <button type="button" className="pastor-centre-action" onClick={() => go('register')} aria-label="Register member"><PlusCircle size={31} aria-hidden/></button>
            <button type="button" className={activeTab === 'followup' ? 'is-active' : ''} onClick={() => go('followup')} aria-current={activeTab === 'followup' ? 'page' : undefined}><Phone size={22} aria-hidden/><span>Follow-Up</span></button>
            <button type="button" ref={moreTriggerRef} onClick={() => setPastorMoreOpen(true)} aria-expanded={pastorMoreOpen} aria-haspopup="dialog"><MoreHorizontal size={22} aria-hidden/><span>More</span></button>
          </nav>
          {pastorMoreOpen && <div className="pastor-more-overlay no-print" onMouseDown={e => { if (e.target === e.currentTarget) setPastorMoreOpen(false); }}>
            <section ref={moreRef} className="pastor-more-sheet" role="dialog" aria-modal="true" aria-label="More Pastor pages">
              <div className="pastor-more-heading"><strong>More options</strong><button type="button" onClick={() => setPastorMoreOpen(false)} aria-label="Close more options"><X size={21}/></button></div>
              {nav.filter(n => !['overview', 'myMembers', 'register', 'followup'].includes(n.key)).map(item => { const Icon = ICON[item.key] || BookOpen; return <button type="button" key={item.key} onClick={() => go(item.key)}><Icon size={20} aria-hidden/><span>{item.label}</span><ChevronRight size={18} aria-hidden/></button>; })}
              <button type="button" onClick={() => { setPastorMoreOpen(false); setMode(effective === 'dark' ? 'light' : 'dark'); }}><Sun size={20} aria-hidden/><span>Switch to {effective === 'dark' ? 'light' : 'dark'} theme</span><ChevronRight size={18} aria-hidden/></button>
            </section>
          </div>}
        </>}
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} pages={nav} onGo={go} onOpenMember={setMemberId} actions={actions} />
      {memberId && <MemberDrawer memberId={memberId} onClose={() => setMemberId(null)} />}
    </div>
  );
}
