import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { useAuth } from './context/AuthContext';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { PlaceholderPage } from './pages/PlaceholderPage';

function ProtectedLayout() {
  const { user, loading, configured } = useAuth();

  if (loading) return <div className="app-loading">Loading MaxDock…</div>;
  if (configured && !user) return <Navigate to="/login" replace />;
  return <AppShell />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="request" element={<PlaceholderPage eyebrow="Booking" title="Book an appointment" description="Load → Vehicle → Time → Contact → Confirm" nextStep="This five-step flow will call the existing capacity-aware and routed Supabase functions. Duration, compatibility, capacity, and after-hours rules remain database-controlled." />} />
        <Route path="appointments" element={<PlaceholderPage eyebrow="Requester" title="My appointments" description="Upcoming, past, cancelled, and all appointments." nextStep="This customer-first screen will use list_my_appointments, with copy, cancel, and rebook actions while keeping internal dock information hidden." />} />
        <Route path="queue" element={<PlaceholderPage eyebrow="Operations" title="Operations queue" description="Today’s movements, status changes, priorities, and wall display." nextStep="The queue will use a shared table component and controlled five-second refresh. Its full-screen display will reuse the same component at a larger type token." />} />
        <Route path="reports" element={<PlaceholderPage eyebrow="Performance" title="Reports" description="Dock utilisation, truck flow, and skid movement." nextStep="Reports will include date ranges, operational KPIs, trend charts, CSV, print, and the advisory AI Operations Brief." />} />
        <Route path="users" element={<PlaceholderPage eyebrow="Administration" title="Users" description="Roles, location access, invitations, status, and usage." nextStep="User administration will use admin_list_users_with_identity and admin_update_user. Navigation and actions will be permission-gated, never role-name hard-coded." />} />
        <Route path="locations" element={<PlaceholderPage eyebrow="Administration" title="Locations & docks" description="Operating hours, dock direction, compatibility, and scheduling rules." nextStep="Each settings section will own one Save and one Reset action, with no global injected save bar." />} />
        <Route path="data" element={<PlaceholderPage eyebrow="Administration" title="Data & imports" description="MIS settings, inventory snapshots, and import history." nextStep="This screen will call the existing administration RPCs and keep credentials referenced by secret name rather than exposing them in the browser." />} />
        <Route path="settings" element={<PlaceholderPage eyebrow="Administration" title="Settings" description="Location-specific scheduling, capacity, and consolidation controls." nextStep="All duration and capacity values will remain per-location and database-authoritative." />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
