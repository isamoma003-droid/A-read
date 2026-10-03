import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.jsx';
import { API_URL } from './api/client.js';
import { flushPendingProgress } from './offline/progressQueue.js';
import { AuthProvider } from './context/AuthContext.jsx';
import { SettingsProvider } from './context/SettingsContext.jsx';
import { configureUploads } from './uploads/store.js';
import './styles/global.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      // Always try the request (the service worker may answer it from a downloaded book).
      networkMode: 'offlineFirst',
      refetchOnWindowFocus: false,
      retry: (count, error) => error?.status >= 500 && count < 2,
    },
    mutations: { networkMode: 'offlineFirst' },
  },
});

configureUploads({ queryClient });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SettingsProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </SettingsProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

// Each time the app opens (or comes back after a while), wake the API and, through it, ISA Tech
// Hub: both can sleep when idle, and a reader paying by M-Pesa shouldn't wait for them.
let lastWake = 0;
function wakeServers() {
  if (Date.now() - lastWake < 5 * 60 * 1000) return;
  lastWake = Date.now();
  fetch(`${API_URL}/system/wake`, { cache: 'no-store' }).catch(() => {});
}
wakeServers();
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && wakeServers());

// Send reading progress saved while offline.
flushPendingProgress();
window.addEventListener('online', () => flushPendingProgress());

// Installable app + offline app shell (production only; the dev server serves live modules).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
