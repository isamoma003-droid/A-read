import { CircleAlert, LoaderCircle } from 'lucide-react';

export function Spinner({ size = 18, label }) {
  return (
    <span className="spinner" role="status">
      <LoaderCircle size={size} className="spin" aria-hidden="true" />
      {label ? <span>{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

export function PageLoader({ label = 'Loading…' }) {
  return (
    <div className="page-loader">
      <Spinner size={28} label={label} />
    </div>
  );
}

export function ErrorMessage({ error, children }) {
  if (!error && !children) return null;
  return (
    <div className="error-message" role="alert">
      <CircleAlert size={18} aria-hidden="true" />
      <span>{children || error?.message || 'Something went wrong'}</span>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="empty-state">
      {Icon && <Icon size={40} strokeWidth={1.5} aria-hidden="true" />}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ProgressBar({ value, label }) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="progress-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}
