import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

let scriptPromise;
function loadGoogleScript() {
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = resolve;
    script.onerror = () => {
      scriptPromise = undefined;
      reject(new Error('Could not load Google sign-in'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export const useAuthConfig = () =>
  useQuery({ queryKey: ['auth-config'], queryFn: () => api('/auth/config'), staleTime: Infinity, retry: 1 });

// "Continue with Google" via Google Identity Services. Renders nothing if the server has no
// GOOGLE_CLIENT_ID configured.
export default function GoogleButton({ onCredential, text = 'continue_with' }) {
  const { data: config } = useAuthConfig();
  const holder = useRef(null);
  const latest = useRef(onCredential);
  const [error, setError] = useState(null);
  const clientId = config?.googleClientId;

  useEffect(() => {
    latest.current = onCredential;
  });

  useEffect(() => {
    if (!clientId) return undefined;
    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled || !holder.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => latest.current(response.credential),
          ux_mode: 'popup',
        });
        window.google.accounts.id.renderButton(holder.current, {
          theme: document.documentElement.dataset.theme === 'dark' ? 'filled_black' : 'outline',
          size: 'large',
          shape: 'pill',
          text,
          width: Math.min(holder.current.offsetWidth || 360, 400),
        });
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [clientId, text]);

  if (!clientId) return null;
  return (
    <div className="google-signin">
      <div className="divider">
        <span>or</span>
      </div>
      <div ref={holder} className="google-button" />
      {error && <p className="muted small">{error}</p>}
    </div>
  );
}
