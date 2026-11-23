// src/App.jsx
import { lazy, Suspense, useEffect, useSyncExternalStore } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ThemeProvider } from './hooks/useTheme';
import { ToastProvider } from './components/shared/Toast';
import ErrorBoundary from './components/shared/ErrorBoundary';
import { ROLES } from './data/constants';
import { C } from './lib/theme';
import { PageSkeleton } from './components/shared/UI';
import Layout, { NAV } from './components/shared/Layout';
const LandingPage = lazy(() => import('./components/LandingPage'));
const LoginPage = lazy(() => import('./components/auth/LoginPage'));
const SecurityGate = lazy(() => import('./components/security/SecurityGate'));
const BishopDashboard = lazy(() => import('./components/bishop/BishopDashboard'));
const AdminDashboard = lazy(() => import('./components/admin/AdminDashboard'));
const PastorDashboard = lazy(() => import('./components/pastor/PastorDashboard'));
const DeptDashboard = lazy(() => import('./components/department/DeptDashboard'));
const KDFDashboard = lazy(() => import('./components/kdf/KDFDashboard'));
const PublicAttendanceCheckIn = lazy(() => import('./components/pastor/ProgrammeAttendance').then(m => ({ default: m.PublicAttendanceCheckIn })));
const SecurityCenter = lazy(() => import('./components/security/SecurityCenter'));
const Approvals = lazy(() => import('./components/governance/Approvals'));
const AuditCenter = lazy(() => import('./components/governance/AuditCenter'));
const Insights = lazy(() => import('./components/governance/Insights'));
const RedAdmin = lazy(() => import('./components/red/RedAdmin'));
const RedTeam = lazy(() => import('./components/red/RedTeam'));
const RedInvite = lazy(() => import('./components/red/RedInvite'));

const EXTRA_SCREENS = { security: SecurityCenter, approvals: Approvals, audit: AuditCenter, insights: Insights, red: RedAdmin };
const PHONE_LAYOUT = '(max-width: 860px)';
const matchesPhoneLayout = () => window.matchMedia?.(PHONE_LAYOUT)?.matches ?? false;
function subscribeToPhoneLayout(onChange) {
  const query = window.matchMedia?.(PHONE_LAYOUT);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

function Splash() {
  return (
    <div role="status" aria-label="Loading SICC Admin" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: C.navy }}>
      <img src="/salem-logo.png" alt="" width="84" height="84" style={{ objectFit: 'contain', marginBottom: 22 }} />
      <div className="display" style={{ fontSize: 26, color: 'var(--nav-ink)', marginBottom: 16 }}>SICC Admin</div>
      <div style={{ width: 180, height: 3, background: 'var(--nav-line)', borderRadius: 2, overflow: 'hidden' }}><div style={{ height: '100%', width: '25%', background: C.gold, borderRadius: 2, animation: 'load 1.5s ease-in-out infinite' }} /></div>
    </div>
  );
}

function Landing() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  if (isAuthenticated) return <Navigate to="/app/overview" replace />;
  return <LandingPage onEnter={() => navigate('/login')} />;
}

function Login() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  if (isAuthenticated) return <Navigate to={location.state?.from || '/app/overview'} replace />;
  return <LoginPage onBack={() => navigate('/')} />;
}

function Dashboard() {
  const { profile, isAuthenticated, restrictions } = useAuth();
  const { tab } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const phoneLayout = useSyncExternalStore(subscribeToPhoneLayout, matchesPhoneLayout, () => false);

  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (restrictions.length) return <SecurityGate />;

  const nav = NAV[profile.role] || [];
  if (!tab || !nav.some(n => n.key === tab)) return <Navigate to="/app/overview" replace />;
  const setActiveTab = key => navigate(`/app/${key}`);
  const Extra = EXTRA_SCREENS[tab];
  const renderDashboard = () => {
    if (Extra) return <Extra setActiveTab={setActiveTab} />;
    switch (profile.role) {
      case ROLES.BISHOP: return <BishopDashboard activeTab={tab} setActiveTab={setActiveTab} />;
      case ROLES.ADMIN: return <AdminDashboard activeTab={tab} setActiveTab={setActiveTab} />;
      case ROLES.PASTOR: return <PastorDashboard activeTab={tab} />;
      case ROLES.DEPARTMENT_LEADER: return <DeptDashboard activeTab={tab} />;
      case ROLES.KDF_COORDINATOR: return <KDFDashboard activeTab={tab} />;
      case ROLES.RED_LEADER:
      case ROLES.RED_MEMBER: return <RedTeam activeTab={tab} setActiveTab={setActiveTab} />;
      default: return <div style={{ padding: 40, textAlign: 'center', color: C.textPrimary }}>Your role is not recognised. Please contact an administrator.</div>;
    }
  };

  return (
    <Layout activeTab={tab} setActiveTab={setActiveTab} mobile={phoneLayout}>
      <ErrorBoundary inline key={tab}>
        <Suspense fallback={<PageSkeleton />}>
          {renderDashboard()}
        </Suspense>
      </ErrorBoundary>
    </Layout>
  );
}

function AppRoutes() {
  const { loading } = useAuth();
  const isPublicCheckIn = new URLSearchParams(window.location.search).get('checkin') === '1';
  useEffect(() => { document.documentElement.lang = 'en'; }, []);
  if (isPublicCheckIn) return <Suspense fallback={<Splash />}><PublicAttendanceCheckIn /></Suspense>;
  if (loading) return <Splash />;
  return (
    <Suspense fallback={<Splash />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/red/invite/:kind" element={<RedInvite />} />
        <Route path="/app" element={<Dashboard />} />
        <Route path="/app/:tab" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <BrowserRouter>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </BrowserRouter>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
