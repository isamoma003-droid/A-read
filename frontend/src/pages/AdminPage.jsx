import { useState } from 'react';
import { BookOpen, Crown, Database, Headphones, Search, Shield, ShieldOff, Trash2, Users } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAdminStats, useAdminUsers, useBooks } from '../api/queries.js';
import BookCover from '../components/BookCover.jsx';
import { ErrorMessage, Spinner } from '../components/Feedback.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { FORMAT_LABELS, formatBytes, formatKes, formatNumber, timeAgo } from '../utils/format.js';
import { useDebounced } from '../utils/useDebounced.js';
import { useDocumentTitle } from '../utils/useDocumentTitle.js';
import AdminAssignments from './AdminAssignments.jsx';
import AdminCategories from './AdminCategories.jsx';
import AdminPayments from './AdminPayments.jsx';
import AdminPremium from './AdminPremium.jsx';
import AdminPromotions from './AdminPromotions.jsx';

const TABS = [
  ['overview', 'Overview'],
  ['assignments', 'Assignments'],
  ['users', 'Users'],
  ['books', 'Books'],
  ['categories', 'Categories'],
  ['premium', 'Premium'],
  ['promotions', 'Popups'],
  ['payments', 'Payments'],
];

export default function AdminPage() {
  const { user } = useAuth();
  // The tab lives in the URL (/admin?tab=premium&book=…) so pages can link straight to it.
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'overview';
  const setTab = (id) => setParams(id === 'overview' ? {} : { tab: id }, { replace: true });
  useDocumentTitle('Admin');
  if (user.role !== 'admin') return <Navigate to="/" replace />;

  return (
    <div className="admin">
      <header className="page-header">
        <p className="eyebrow">
          <Shield size={12} aria-hidden="true" /> Admin
        </p>
        <h1 className="section-title">Admin panel</h1>
      </header>
      <div className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'assignments' && <AdminAssignments />}
      {tab === 'users' && <UsersTab me={user} />}
      {tab === 'books' && <BooksTab />}
      {tab === 'categories' && <AdminCategories />}
      {tab === 'premium' && <AdminPremium />}
      {tab === 'promotions' && <AdminPromotions />}
      {tab === 'payments' && <AdminPayments />}
    </div>
  );
}

function Stat({ icon: Icon, label, value, detail }) {
  return (
    <div className="stat">
      <span className="stat-icon">
        <Icon size={18} aria-hidden="true" />
      </span>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {detail && <span className="muted small">{detail}</span>}
    </div>
  );
}

function Overview() {
  const { data, isPending, error } = useAdminStats();
  if (isPending) return <Spinner label="Loading stats…" />;
  if (error) return <ErrorMessage error={error} />;
  const formats = Object.entries(data.formats)
    .map(([f, n]) => `${n} ${FORMAT_LABELS[f] || f}`)
    .join(' · ');
  return (
    <div className="stat-grid">
      <Stat icon={Users} label="Readers" value={formatNumber(data.users)} detail={`${data.newUsersThisWeek} new this week · ${data.admins} admin${data.admins === 1 ? '' : 's'}`} />
      <Stat icon={BookOpen} label="Books" value={formatNumber(data.books)} detail={formats || 'None yet'} />
      <Stat icon={Headphones} label="With audio" value={formatNumber(data.narrated + data.audiobooks)} detail={`${data.narrated} narrated · ${data.audiobooks} audiobooks`} />
      <Stat icon={Crown} label="Premium books" value={formatNumber(data.premium)} detail="Readers pay once to unlock" />
      <Stat icon={Database} label="Storage used" value={formatBytes(data.storageBytes) || '0 B'} detail={`${formatNumber(data.words)} words of text`} />
    </div>
  );
}

function UsersTab({ me }) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 300);
  const { data: users, isPending, error } = useAdminUsers(q);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(null);

  const run = async (id, request) => {
    setBusy(id);
    setActionError(null);
    try {
      await request();
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      queryClient.invalidateQueries({ queryKey: ['books'] });
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(null);
    }
  };

  const setRole = (u, role) => run(u.id, () => api(`/admin/users/${u.id}`, { method: 'PATCH', body: { role } }));
  const remove = (u) => {
    if (!window.confirm(`Delete ${u.name}'s account (${u.email})? Their progress and bookmarks are removed.`)) return;
    const deleteBooks = u.books > 0 && window.confirm(`Also delete the ${u.books} book(s) they uploaded? Cancel keeps them in the library.`);
    run(u.id, () => api(`/admin/users/${u.id}${deleteBooks ? '?deleteBooks=true' : ''}`, { method: 'DELETE' }));
  };

  return (
    <section className="panel">
      <label className="search search-compact">
        <Search size={18} aria-hidden="true" />
        <input type="search" placeholder="Search by name or email" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search users" />
      </label>
      <ErrorMessage error={error || actionError} />
      {isPending ? (
        <Spinner label="Loading users…" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Reader</th>
                <th>Role</th>
                <th className="num">Books</th>
                <th>Joined</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="person">
                      <span className="user-chip">{u.name.slice(0, 1).toUpperCase()}</span>
                      <div>
                        <strong>{u.name}</strong>
                        {u.id === me.id && <span className="badge">You</span>}
                        <div className="muted small">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${u.role === 'admin' ? 'badge-accent' : ''}`}>{u.role}</span>
                  </td>
                  <td className="num">{u.books}</td>
                  <td className="muted small">{timeAgo(u.createdAt)}</td>
                  <td className="actions">
                    {u.id !== me.id && (
                      <>
                        {u.role === 'admin' ? (
                          <button type="button" className="button button-small button-ghost" disabled={busy === u.id} onClick={() => setRole(u, 'user')}>
                            <ShieldOff size={14} aria-hidden="true" /> Remove admin
                          </button>
                        ) : (
                          <button type="button" className="button button-small button-ghost" disabled={busy === u.id} onClick={() => setRole(u, 'admin')}>
                            <Shield size={14} aria-hidden="true" /> Make admin
                          </button>
                        )}
                        <button type="button" className="icon-button danger" disabled={busy === u.id} onClick={() => remove(u)} title="Delete account">
                          <Trash2 size={16} />
                          <span className="sr-only">Delete {u.name}</span>
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && <p className="muted">No users match.</p>}
        </div>
      )}
    </section>
  );
}

function BooksTab() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 300);
  const books = useBooks({ q, sort: 'recent', limit: 50 });
  const list = books.data?.pages.flatMap((p) => p.books) ?? [];
  const [actionError, setActionError] = useState(null);

  const remove = async (book) => {
    if (!window.confirm(`Delete "${book.title}" for everyone? This can't be undone.`)) return;
    setActionError(null);
    try {
      await api(`/books/${book.id}`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['books'] });
      queryClient.invalidateQueries({ queryKey: ['admin'] });
    } catch (err) {
      setActionError(err);
    }
  };

  return (
    <section className="panel">
      <label className="search search-compact">
        <Search size={18} aria-hidden="true" />
        <input type="search" placeholder="Search books" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search books" />
      </label>
      <ErrorMessage error={books.error || actionError} />
      {books.isPending ? (
        <Spinner label="Loading books…" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Book</th>
                <th>Uploaded by</th>
                <th>Format</th>
                <th className="num">Size</th>
                <th>Added</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {list.map((book) => (
                <tr key={book.id}>
                  <td>
                    <Link to={`/books/${book.id}`} className="table-book">
                      <BookCover book={book} size="tiny" />
                      <div>
                        <strong>{book.title}</strong>
                        {book.author && <div className="muted small">{book.author}</div>}
                      </div>
                    </Link>
                  </td>
                  <td className="small">{book.uploadedBy?.name || '—'}</td>
                  <td>
                    <span className="badge">{FORMAT_LABELS[book.format]}</span>
                    {book.hasAudio && (
                      <span className="badge badge-accent" title="Has audio">
                        <Headphones size={11} aria-hidden="true" />
                      </span>
                    )}
                    {book.premium && (
                      <span className="badge badge-premium" title={`Premium: ${formatKes(book.premium.price)}`}>
                        <Crown size={11} aria-hidden="true" />
                      </span>
                    )}
                  </td>
                  <td className="num small">{formatBytes(book.file?.bytes)}</td>
                  <td className="muted small">{timeAgo(book.createdAt)}</td>
                  <td className="actions">
                    <button type="button" className="icon-button danger" onClick={() => remove(book)} title="Delete book">
                      <Trash2 size={16} />
                      <span className="sr-only">Delete {book.title}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && <p className="muted">No books found.</p>}
          {books.hasNextPage && (
            <div className="center-block">
              <button type="button" className="button" onClick={() => books.fetchNextPage()} disabled={books.isFetchingNextPage}>
                Load more
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
