import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Library,
  PlusCircle,
  LogOut,
  SlidersHorizontal,
  UserCircle,
  ChevronDown,
  Bell,
  Star,
} from 'lucide-react';
import type { Profile } from '@app/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import PageLoader from '../../components/ui/PageLoader';
import Footer from '../../components/Footer';
import VerifyEmailBanner from '../../components/VerifyEmailBanner';

// Primary nav = the two everyday actions. Settings is onboarding-first but
// rarely revisited, so it lives in the user dropdown (see below), not here.
const NAV_ITEMS = [
  { to: '/app/library', label: 'Library', icon: Library },
  { to: '/app/to-read', label: 'To read', icon: Star },
  { to: '/app/add', label: 'Add content', icon: PlusCircle },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // One-shot onboarding gate. We verify once on mount. After the first profile
  // save, SettingsPage navigates away; while the profile is still unconfigured
  // we re-verify on route changes and hold the gate in "checking" during that
  // fetch, so we never redirect on a stale notConfigured value (the bug: going
  // to the library right after the first save bounced back to settings because
  // the async /profile fetch had not resolved yet). Once configured, we stop
  // re-fetching on every navigation — no per-route loader, no extra call.
  const [checking, setChecking] = useState(true);
  const [notConfigured, setNotConfigured] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  // Close the user dropdown on an outside click or Escape.
  useEffect(() => {
    if (!userMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [userMenuOpen]);

  // While onboarding is still pending we re-verify on each route change and
  // block with the loader until the fetch resolves (prevents the stale-state
  // bounce). Once configured, the gate is satisfied for the rest of the session
  // and we skip the per-navigation refetch entirely.
  const configuredRef = useRef(false);

  useEffect(() => {
    if (configuredRef.current) return; // already past onboarding — no refetch
    let active = true;
    setChecking(true);
    (async () => {
      try {
        const profile = await api.get<Profile>('/profile');
        if (!active) return;
        const stillNotConfigured = Boolean(profile.notConfigured);
        setNotConfigured(stillNotConfigured);
        if (!stillNotConfigured) configuredRef.current = true;
      } catch {
        // On a load error, don't trap the user — let them through.
        if (active) setNotConfigured(false);
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [location.pathname]);

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  if (checking) return <PageLoader />;

  const onSetupPage = location.pathname.startsWith('/app/settings');
  if (notConfigured && !onSetupPage) {
    return <Navigate to="/app/settings" replace />;
  }

  const locked = notConfigured; // hide nav links while onboarding

  return (
    <div className="flex min-h-dvh flex-col bg-gray-50">
      <header className="app-header sticky top-0 z-30 border-b border-gray-200 bg-white">
        <div className="app-shell-width flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/app" className="flex items-center gap-2 font-semibold text-gray-900">
              <img src="/logo.svg" alt="" className="h-6 w-6" />
              <span className="hidden sm:inline">Read Worthy</span>
              <span className="sm:hidden">Read Worthy</span>
            </Link>
            {!locked && (
              // Desktop: full nav. On mobile the two actions live elsewhere —
              // Library is the home (tap the logo) and Add content is the +
              // button on the right — so there is no hamburger drawer to open.
              <nav className="hidden gap-1 text-sm sm:flex">
                {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
                        isActive
                          ? 'bg-indigo-50 text-indigo-700'
                          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                      }`
                    }
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </NavLink>
                ))}
              </nav>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Mobile-only: Add content as a primary action button (replaces the
                hamburger drawer — with Library as the home, it was the only
                thing the drawer did). Hidden on desktop where the nav shows it. */}
            {!locked && (
              <NavLink
                to="/app/add"
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:hidden ${
                    isActive
                      ? 'bg-indigo-600 text-white'
                      : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                  }`
                }
              >
                <PlusCircle className="h-4 w-4" /> Add
              </NavLink>
            )}
            <div className="relative flex items-center text-sm" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setUserMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 font-medium text-gray-600 hover:bg-gray-100"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700">
                  <UserCircle className="h-5 w-5" />
                </span>
                <span className="hidden max-w-[12rem] truncate sm:inline">{user?.email}</span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {userMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-40 mt-1 w-60 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
                >
                  <div className="border-b border-gray-100 px-4 py-3">
                    <p className="truncate text-sm font-medium text-gray-900">{user?.email}</p>
                    <p className="text-xs text-gray-500">{user?.role}</p>
                  </div>
                  <NavLink
                    to="/app/settings"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                    role="menuitem"
                  >
                    <SlidersHorizontal className="h-4 w-4 text-gray-500" />
                    Knowledge profile
                  </NavLink>
                  <NavLink
                    to="/app/notifications"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                    role="menuitem"
                  >
                    <Bell className="h-4 w-4 text-gray-500" />
                    Notifications
                  </NavLink>
                  <NavLink
                    to="/app/profile"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                    role="menuitem"
                  >
                    <UserCircle className="h-4 w-4 text-gray-500" />
                    My account
                  </NavLink>
                  <button
                    onClick={() => {
                      setUserMenuOpen(false);
                      void onLogout();
                    }}
                    className="flex w-full items-center gap-2 border-t border-gray-100 px-4 py-2.5 text-left text-sm font-medium text-indigo-600 hover:bg-indigo-50"
                    role="menuitem"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <VerifyEmailBanner />

      <main className="app-main flex-1">
        <div className="app-shell-width">
          <Outlet />
        </div>
      </main>

      <Footer />
    </div>
  );
}
