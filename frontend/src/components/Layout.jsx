import { BookOpen, LogOut, Moon, Shield, Sun, Upload } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';

const THEME_ORDER = ['light', 'sepia', 'dark'];

export function ThemeToggle() {
  const { update, theme: current } = useSettings();
  const next = THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
  return (
    <button type="button" className="icon-button" onClick={() => update({ theme: next })} title={`Switch to ${next} theme`}>
      {current === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
      <span className="sr-only">Switch to {next} theme</span>
    </button>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              <BookOpen size={18} />
            </span>
            A-Read
          </Link>
          <nav className="topnav">
            <NavLink to="/" end className="nav-library">
              Library
            </NavLink>
            {user.role === 'admin' && (
              <NavLink to="/admin" title="Admin panel">
                <Shield size={16} aria-hidden="true" /> <span className="hide-mobile">Admin</span>
              </NavLink>
            )}
            <NavLink to="/upload" className="button button-primary button-small">
              <Upload size={16} aria-hidden="true" /> <span className="hide-mobile">Upload</span>
            </NavLink>
            <ThemeToggle />
            <span className="user-chip" title={user.email}>
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <button type="button" className="icon-button" onClick={logout} title="Log out">
              <LogOut size={18} />
              <span className="sr-only">Log out</span>
            </button>
          </nav>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
