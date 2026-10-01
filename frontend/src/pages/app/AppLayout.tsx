import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-dvh bg-gray-50">
      <header className="app-header flex items-center justify-between border-b border-gray-200 bg-white">
        <div className="flex items-center gap-6">
          <Link to="/app" className="flex items-center gap-2 font-semibold text-gray-900">
            <img src="/logo.svg" alt="" className="h-6 w-6" />
            {'{{PROJECT_NAME}}'}
          </Link>
          <nav className="flex gap-4 text-sm text-gray-600">
            <Link to="/app/library" className="hover:text-gray-900">
              Library
            </Link>
            <Link to="/app/add" className="hover:text-gray-900">
              Add content
            </Link>
            <Link to="/app/profile" className="hover:text-gray-900">
              Profile
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-gray-500 sm:inline">{user?.email}</span>
          <button onClick={onLogout} className="text-indigo-600 hover:underline">
            Sign out
          </button>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
