import { useState } from 'react';
import { BookOpen, Heart, ListChecks, LogOut, Megaphone, Moon, Shield, Sun, Upload, X } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useSystemConfig } from '../api/queries.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import { isAdmin } from '../utils/roles.js';
import InstallButton from './InstallButton.jsx';
import OfflineBanner from './OfflineBanner.jsx';
import PromotionPopup from './PromotionPopup.jsx';
import QuotePopup from './QuotePopup.jsx';

const THEME_ORDER = ['light', 'sepia', 'dark'];

export function ThemeToggle() {
  const { update, theme: current } = useSettings();
  const next = THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
  return (
    <button type="button" className="icon-button theme-toggle" onClick={() => update({ theme: next })} title={`Switch to ${next} theme`}>
      {current === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
      <span className="sr-only">Switch to {next} theme</span>
    </button>
  );
}

const DISMISSED_KEY = 'a-read-announcement-dismissed';

// The super admin's site-wide notice. A reader can hide it until the text changes.
function Announcement({ text }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY);
    } catch {
      return null;
    }
  });
  if (!text || dismissed === text) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, text);
    } catch {
      // ignore
    }
    setDismissed(text);
  };
  return (
    <div className="announcement" role="status">
      <Megaphone size={16} aria-hidden="true" />
      <span>{text}</span>
      <button type="button" className="icon-button" onClick={dismiss} title="Hide this notice">
        <X size={16} />
        <span className="sr-only">Hide this notice</span>
      </button>
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const { data: system } = useSystemConfig();
  const canUpload = system?.uploads !== 'admins' || isAdmin(user);
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              <BookOpen size={18} />
            </span>
            <span className="brand-name">A-Read</span>
          </Link>
          <nav className="topnav">
            <NavLink to="/" end className="nav-library">
              Library
            </NavLink>
            <NavLink to="/support" title="Support A-Read">
              <Heart size={16} aria-hidden="true" /> <span className="hide-mobile">Support</span>
            </NavLink>
            {user ? (
              <>
                <NavLink to="/required" title="Required reading">
                  <ListChecks size={16} aria-hidden="true" /> <span className="hide-mobile">Required</span>
                </NavLink>
                {isAdmin(user) && (
                  <NavLink to="/admin" title="Admin panel">
                    <Shield size={16} aria-hidden="true" /> <span className="hide-mobile">Admin</span>
                  </NavLink>
                )}
                {canUpload && (
                  <NavLink to="/upload" className="button button-primary button-small">
                    <Upload size={16} aria-hidden="true" /> <span className="hide-mobile">Upload</span>
                  </NavLink>
                )}
                <InstallButton />
                <ThemeToggle />
                <span className="user-chip" title={`${user.name} · ${user.email}`}>
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
                <button type="button" className="icon-button" onClick={logout} title="Log out">
                  <LogOut size={18} />
                  <span className="sr-only">Log out</span>
                </button>
              </>
            ) : (
              <>
                <InstallButton />
                <ThemeToggle />
                <Link to="/login" state={{ from: location.pathname }} className="button button-ghost button-small">
                  Log in
                </Link>
                <Link to="/register" state={{ from: location.pathname }} className="button button-primary button-small">
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <OfflineBanner />
      <Announcement text={system?.announcement} />
      <main className="page">
        <Outlet />
      </main>
      <QuotePopup />
      <PromotionPopup />
    </div>
  );
}
