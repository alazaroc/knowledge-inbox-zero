import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Library,
  PlusCircle,
  LogOut,
  Menu,
  X,
  SlidersHorizontal,
  UserCircle,
  ChevronDown,
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
  const [menuOpen, setMenuOpen] = useState(false);
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

  // Close the mobile drawer on Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

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
            {!locked && (
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                className="rounded p-1 text-gray-600 hover:bg-gray-100 sm:hidden"
                aria-label="Toggle menu"
              >
                {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            )}
            <Link to="/app" className="flex items-center gap-2 font-semibold text-gray-900">
              <img src="/logo.svg" alt="" className="h-6 w-6" />
              <span className="hidden sm:inline">Knowledge Inbox Zero</span>
              <span className="sm:hidden">Inbox Zero</span>
            </Link>
            {!locked && (
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
      </header>

      <VerifyEmailBanner />

      {/* Mobile nav: native-feeling side drawer (slides in from the left) with a
          dimmed overlay. Closes on overlay tap or Escape. Replaces the old
          push-down panel so it behaves like a real mobile menu. */}
      {!locked && (
        <div
          className={`fixed inset-0 z-40 sm:hidden ${menuOpen ? '' : 'pointer-events-none'}`}
          aria-hidden={!menuOpen}
        >
          {/* Overlay */}
          <div
            onClick={() => setMenuOpen(false)}
            className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
              menuOpen ? 'opacity-100' : 'opacity-0'
            }`}
          />
          {/* Drawer panel */}
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className={`absolute left-0 top-0 flex h-full w-72 max-w-[80%] flex-col bg-white shadow-xl transition-transform duration-200 ease-out ${
              menuOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <span className="flex items-center gap-2 font-semibold text-gray-900">
                <img src="/logo.svg" alt="" className="h-6 w-6" />
                Inbox Zero
              </span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="rounded p-1 text-gray-600 hover:bg-gray-100"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 py-2">
              {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-3 text-sm font-medium ${
                      isActive ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700 hover:bg-gray-50'
                    }`
                  }
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </NavLink>
              ))}
            </nav>
          </aside>
        </div>
      )}

      <main className="app-main flex-1">
        <div className="app-shell-width">
          <Outlet />
        </div>
      </main>

      <Footer />
    </div>
  );
}
