import { useEffect, useRef, useState } from 'react';
import { BookOpen, MailCheck } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { ErrorMessage, Spinner } from '../components/Feedback.jsx';
import GoogleButton from '../components/GoogleButton.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useDocumentTitle } from '../utils/useDocumentTitle.js';

function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <Link to="/" className="auth-brand">
          <span className="brand-mark" aria-hidden="true">
            <BookOpen size={20} />
          </span>
          A-Read
        </Link>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
        {footer && <p className="auth-footer">{footer}</p>}
      </div>
    </div>
  );
}

function useGoAfterAuth() {
  const navigate = useNavigate();
  const location = useLocation();
  return () => navigate(location.state?.from || '/', { replace: true });
}

function useGoogleSignIn(setError) {
  const { loginWithGoogle } = useAuth();
  const go = useGoAfterAuth();
  return async (credential) => {
    setError(null);
    try {
      await loginWithGoogle(credential);
      go();
    } catch (err) {
      setError(err);
    }
  };
}

function ResendLink({ email }) {
  const [state, setState] = useState('idle');
  const resend = async () => {
    setState('sending');
    try {
      await api('/auth/resend-verification', { method: 'POST', body: { email } });
      setState('sent');
    } catch {
      setState('idle');
    }
  };
  if (state === 'sent') return <span className="muted">A new link is on its way.</span>;
  return (
    <button type="button" className="link-button" onClick={resend} disabled={state === 'sending'}>
      {state === 'sending' ? 'Sending…' : 'Send the link again'}
    </button>
  );
}

function CheckEmail({ email, onBack }) {
  return (
    <div className="check-email">
      <span className="check-email-icon" aria-hidden="true">
        <MailCheck size={30} />
      </span>
      <p>
        We sent a confirmation link to <strong>{email}</strong>. Open it to activate your account, then you're in.
      </p>
      <p className="muted small">
        Can't find it? Check spam or promotions. <ResendLink email={email} />
      </p>
      <button type="button" className="link-button" onClick={onBack}>
        Use a different email
      </button>
    </div>
  );
}

export function LoginPage() {
  const { user, login } = useAuth();
  const location = useLocation();
  const go = useGoAfterAuth();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const onGoogle = useGoogleSignIn(setError);
  useDocumentTitle('Log in');
  if (user) return <Navigate to={location.state?.from || '/'} replace />;

  const onSubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setBusy(true);
    try {
      await login(form.get('email'), form.get('password'));
      go();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  const unverified = error?.details?.code === 'EMAIL_NOT_VERIFIED';
  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to read and listen to the library."
      footer={
        <>
          New here?{' '}
          <Link to="/register" state={location.state}>
            Create an account
          </Link>
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
        {unverified ? (
          <div className="notice">
            {error.message} <ResendLink email={error.details.email} />
          </div>
        ) : (
          <ErrorMessage error={error} />
        )}
        <button className="button button-primary button-block" disabled={busy}>
          {busy ? <Spinner label="Logging in…" /> : 'Log in'}
        </button>
      </form>
      <GoogleButton onCredential={onGoogle} text="signin_with" />
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { user, register } = useAuth();
  const location = useLocation();
  const go = useGoAfterAuth();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pendingEmail, setPendingEmail] = useState(null);
  const onGoogle = useGoogleSignIn(setError);
  useDocumentTitle('Create an account');
  if (user) return <Navigate to={location.state?.from || '/'} replace />;

  const onSubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('password') !== form.get('confirm')) {
      setError(new Error('The passwords do not match'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await register(form.get('name'), form.get('email'), form.get('password'));
      if (result?.pending) {
        setPendingEmail(result.email);
        setBusy(false);
      } else {
        go();
      }
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  if (pendingEmail) {
    return (
      <AuthLayout title="Check your email">
        <CheckEmail email={pendingEmail} onBack={() => setPendingEmail(null)} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Read the library anywhere, or have any book read to you."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" state={location.state}>
            Log in
          </Link>
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
          <small className="muted">We'll send a link to confirm it's really yours.</small>
        </label>
        <label className="field">
          <span>Password</span>
          <input name="password" type="password" autoComplete="new-password" required minLength={8} />
          <small className="muted">At least 8 characters.</small>
        </label>
        <label className="field">
          <span>Confirm password</span>
          <input name="confirm" type="password" autoComplete="new-password" required minLength={8} />
        </label>
        <ErrorMessage error={error} />
        <button className="button button-primary button-block" disabled={busy}>
          {busy ? <Spinner label="Creating account…" /> : 'Create account'}
        </button>
      </form>
      <GoogleButton onCredential={onGoogle} text="signup_with" />
    </AuthLayout>
  );
}

export function VerifyEmailPage() {
  const { verifyEmail } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [error, setError] = useState(null);
  const started = useRef(false);
  useDocumentTitle('Confirm your email');

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true; // links are single-use, so never submit twice (StrictMode)
    verifyEmail(token)
      .then(() => navigate('/', { replace: true, state: { welcome: true } }))
      .catch(setError);
  }, [token, verifyEmail, navigate]);

  return (
    <AuthLayout title={error || !token ? 'Link not valid' : 'Confirming your email…'}>
      {!token ? (
        <ErrorMessage>This confirmation link is incomplete. Open the link from the email again.</ErrorMessage>
      ) : error ? (
        <>
          <ErrorMessage error={error} />
          <p className="auth-footer">
            <Link to="/login">Go to log in</Link> to request a new link.
          </p>
        </>
      ) : (
        <div className="center-block">
          <Spinner label="One moment…" />
        </div>
      )}
    </AuthLayout>
  );
}
