import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ErrorMessage, Spinner } from '../components/Feedback.jsx';
import { useAuth } from '../context/AuthContext.jsx';

function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true">
            <BookOpen size={20} />
          </span>
          A-Read
        </div>
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
        {children}
        <p className="auth-footer">{footer}</p>
      </div>
    </div>
  );
}

function useAuthForm(submit) {
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const onSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await submit(new FormData(event.currentTarget));
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return { error, busy, onSubmit };
}

export function LoginPage() {
  const { user, login } = useAuth();
  const { error, busy, onSubmit } = useAuthForm((form) => login(form.get('email'), form.get('password')));
  if (user) return <Navigate to="/" replace />;
  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to read and listen to the shared library."
      footer={
        <>
          New here? <Link to="/register">Create an account</Link>
        </>
      }
    >
      <form className="form" onSubmit={onSubmit}>
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" autoComplete="email" required autoFocus />
        </label>
        <label className="field">
          <span>Password</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <ErrorMessage error={error} />
        <button className="button button-primary button-block" disabled={busy}>
          {busy ? <Spinner label="Logging in…" /> : 'Log in'}
        </button>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { user, register } = useAuth();
  const { error, busy, onSubmit } = useAuthForm((form) =>
    register(form.get('name'), form.get('email'), form.get('password')),
  );
  if (user) return <Navigate to="/" replace />;
  return (
    <AuthLayout
      title="Create your account"
      subtitle="Upload books, read them anywhere, or have them read to you."
      footer={
        <>
          Already have an account? <Link to="/login">Log in</Link>
        </>
      }
    >
      <form className="form" onSubmit={onSubmit}>
        <label className="field">
          <span>Name</span>
          <input name="name" autoComplete="name" required maxLength={80} autoFocus />
        </label>
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label className="field">
          <span>Password</span>
          <input name="password" type="password" autoComplete="new-password" required minLength={8} />
          <small className="muted">At least 8 characters.</small>
        </label>
        <ErrorMessage error={error} />
        <button className="button button-primary button-block" disabled={busy}>
          {busy ? <Spinner label="Creating account…" /> : 'Create account'}
        </button>
      </form>
    </AuthLayout>
  );
}
