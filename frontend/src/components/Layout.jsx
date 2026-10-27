import { useState } from 'react';
import { BookOpen, Crown, Download, Feather, Heart, ListChecks, LogOut, Megaphone, Moon, Shield, Smartphone, Sun, Upload, User, X } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useSystemConfig } from '../api/queries.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import { isAdmin } from '../utils/roles.js';
import InstallButton, { InstallModal } from './InstallButton.jsx';
import OfflineBanner from './OfflineBanner.jsx';
import PromotionPopup from './PromotionPopup.jsx';
import QuotePopup from './QuotePopup.jsx';
import UploadDock from './UploadDock.jsx';

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

function Footer({ onOpenInstall, system, user }) {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-col footer-brand">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              <BookOpen size={18} />
            </span>
            <span className="brand-name">A-Read</span>
          </Link>
          <p className="muted small" style={{ marginTop: '8px', maxWidth: '300px' }}>
            Your digital library for reading books, listening to narration, and offline reading anywhere on your device.
          </p>
        </div>

        <div className="footer-col">
          <h4 className="footer-heading">Explore</h4>
          <ul className="footer-links">
            <li>
              <Link to="/">Library</Link>
            </li>
            <li>
              <Link to="/authors">Authors</Link>
            </li>
            {system?.pass && (
              <li>
                <Link to="/premium">Premium Pass</Link>
              </li>
            )}
            {user && (
              <li>
                <Link to="/required">Required Reading</Link>
              </li>
            )}
          </ul>
        </div>

        <div className="footer-col">
          <h4 className="footer-heading">App & Support</h4>
          <ul className="footer-links">
            <li>
              <Link to="/support">Support A-Read & M-Pesa</Link>
            </li>
            <li>
              <button type="button" className="footer-link-button" onClick={onOpenInstall}>
                <Download size={14} /> Download Android APK
              </button>
            </li>
            <li>
              <button type="button" className="footer-link-button" onClick={onOpenInstall}>
                <Smartphone size={14} /> Install Web / Mobile App
              </button>
            </li>
          </ul>
        </div>
      </div>

      <div className="footer-bottom">
        <p className="muted small">© {new Date().getFullYear()} A-Read. All rights reserved.</p>
      </div>
    </footer>
  );
}

function MobileNav({ onOpenInstall, user }) {
  return (
    <nav className="mobile-nav" aria-label="Mobile Navigation">
      <NavLink to="/" end className={({ isActive }) => (isActive ? 'mobile-nav-item active' : 'mobile-nav-item')}>
        <BookOpen size={20} />
        <span>Library</span>
      </NavLink>
      <NavLink to="/authors" className={({ isActive }) => (isActive ? 'mobile-nav-item active' : 'mobile-nav-item')}>
        <Feather size={20} />
        <span>Authors</span>
      </NavLink>
      <button type="button" className="mobile-nav-item" onClick={onOpenInstall}>
        <Download size={20} />
        <span>Get App</span>
      </button>
      <NavLink to="/support" className={({ isActive }) => (isActive ? 'mobile-nav-item active' : 'mobile-nav-item')}>
        <Heart size={20} />
        <span>Support</span>
      </NavLink>
      {user ? (
        <NavLink to="/required" className={({ isActive }) => (isActive ? 'mobile-nav-item active' : 'mobile-nav-item')}>
          <ListChecks size={20} />
          <span>Required</span>
        </NavLink>
      ) : (
        <NavLink to="/login" className={({ isActive }) => (isActive ? 'mobile-nav-item active' : 'mobile-nav-item')}>
          <User size={20} />
          <span>Account</span>
        </NavLink>
      )}
    </nav>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const { data: system } = useSystemConfig();
  const [installModalOpen, setInstallModalOpen] = useState(false);
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
            <NavLink to="/authors" title="Authors">
              <Feather size={16} aria-hidden="true" /> <span className="hide-mobile">Authors</span>
            </NavLink>
            {system?.pass && (
              <NavLink to="/premium" title="Premium Pass">
                <Crown size={16} aria-hidden="true" /> <span className="hide-mobile">Premium</span>
              </NavLink>
            )}
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

      <Footer onOpenInstall={() => setInstallModalOpen(true)} system={system} user={user} />
      <MobileNav onOpenInstall={() => setInstallModalOpen(true)} user={user} system={system} />

      <InstallModal open={installModalOpen} onClose={() => setInstallModalOpen(false)} />

      <UploadDock />
      <QuotePopup />
      <PromotionPopup />
    </div>
  );
}
