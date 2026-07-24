import {
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Database,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Settings,
  UserRoundCog,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useMaxDock } from '../context/MaxDockContext';
import { Logo } from './Logo';

type NavigationItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
};

type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};

const navigationGroups: NavigationGroup[] = [
  {
    label: 'Operations',
    items: [
      { to: '/', label: 'Dock board', icon: LayoutDashboard, end: true },
      { to: '/queue', label: 'Queue', icon: ClipboardList },
      { to: '/appointments', label: 'My appointments', icon: CalendarDays },
      { to: '/reports', label: 'Reports', icon: BarChart3 },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/users', label: 'Users', icon: UserRoundCog },
      { to: '/locations', label: 'Locations & docks', icon: Building2 },
      { to: '/data', label: 'Data & imports', icon: Database },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

function formatRole(role: string | null | undefined) {
  if (!role) return 'User';
  return role.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function initials(name: string | null | undefined) {
  const value = name?.trim() || 'MaxDock User';
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

export function AppShell() {
  const { profile, signOut } = useAuth();
  const { locations, selectedLocation, setSelectedLocationId, role, error } = useMaxDock();
  const [mobileOpen, setMobileOpen] = useState(false);

  const displayDate = useMemo(
    () => new Intl.DateTimeFormat('en-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()),
    [],
  );

  const closeMobile = () => setMobileOpen(false);

  return (
    <div className="shell">
      <aside className={`rail ${mobileOpen ? 'rail--open' : ''}`}>
        <div className="rail__brand">
          <Logo compact />
          <button className="icon-control rail__close" onClick={closeMobile} aria-label="Close navigation">
            <X size={18} />
          </button>
        </div>

        <nav aria-label="Primary navigation">
          {navigationGroups.map((group) => (
            <div className="rail__group" key={group.label}>
              <div className="rail__label">{group.label}</div>
              {group.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={closeMobile}
                  className={({ isActive }) => `rail__link ${isActive ? 'rail__link--active' : ''}`}
                >
                  <Icon className="rail__icon" aria-hidden="true" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="rail__foot">
          <span>Signed in as</span>
          <strong>{profile?.full_name || 'MaxDock User'}</strong>
          <span>{formatRole(role || profile?.role_code)}</span>
        </div>
      </aside>

      {mobileOpen && <button className="rail-scrim" onClick={closeMobile} aria-label="Close navigation" />}

      <div className="workspace">
        <header className="top">
          <button className="icon-control top__menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu size={19} />
          </button>

          <label className="top__site">
            <MapPin size={15} aria-hidden="true" />
            <select
              className="top__location-select"
              value={selectedLocation?.id ?? ''}
              onChange={(event) => setSelectedLocationId(event.target.value)}
              aria-label="Current location"
            >
              {locations.map((location) => (
                <option value={location.id} key={location.id}>{location.name}</option>
              ))}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </label>

          <span className="top__date data">{displayDate}</span>
          <div className="top__spacer" />
          <div className="top__live"><span className="pulse" />Live · updates every 5s</div>
          <button className="icon-control" aria-label="Notifications"><Bell size={17} /></button>
          <div className="avatar" title={profile?.full_name || 'MaxDock User'}>{initials(profile?.full_name)}</div>
          <button className="icon-control" onClick={() => void signOut()} aria-label="Sign out"><LogOut size={17} /></button>
        </header>

        <main className="page">
          {error && <div className="notice notice--stop global-notice">{error}</div>}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
