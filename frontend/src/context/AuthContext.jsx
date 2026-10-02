import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, onUnauthorized, tokenStore } from '../api/client.js';
import { clearOfflineBooks } from '../offline/store.js';

const AuthContext = createContext(null);
const USER_KEY = 'a-read-user';
const OFFLINE_OWNER_KEY = 'a-read-offline-owner';

// Books kept offline belong to one account. When a different account signs in on this device,
// they're forgotten: they can include the previous reader's paid chapters and private file links.
function claimOfflineBooks(user) {
  if (!user?.id) return;
  try {
    const owner = localStorage.getItem(OFFLINE_OWNER_KEY);
    if (owner && owner !== user.id) clearOfflineBooks();
    localStorage.setItem(OFFLINE_OWNER_KEY, user.id);
  } catch {
    // Storage blocked: nothing is kept offline either.
  }
}

// The last signed-in user, so the app still knows who you are when it opens offline.
function storedUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

function storeUser(user) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    // ignore
  }
}

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [user, setUserState] = useState(() => (tokenStore.get() ? storedUser() : null));
  const [loading, setLoading] = useState(() => Boolean(tokenStore.get()) && !storedUser());
  const setUser = useCallback((next) => {
    storeUser(next);
    claimOfflineBooks(next);
    setUserState(next);
  }, []);

  const logout = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient, setUser]);

  useEffect(() => {
    onUnauthorized(logout);
    if (!tokenStore.get()) return;
    api('/auth/me')
      .then((data) => setUser(data.user))
      // Only a real "not signed in" answer logs you out; being offline keeps the saved session.
      .catch((err) => err.status === 401 && logout())
      .finally(() => setLoading(false));
  }, [logout, setUser]);

  const startSession = useCallback((data) => {
    tokenStore.set(data.token);
    setUser(data.user);
    return data.user;
  }, [setUser]);

  const value = useMemo(
    () => ({
      user,
      loading,
      login: (email, password) => api('/auth/login', { method: 'POST', body: { email, password } }).then(startSession),
      // Resolves to { pending: true, email } when the account must be confirmed by email first.
      register: (name, email, password) =>
        api('/auth/register', { method: 'POST', body: { name, email, password } }).then((data) =>
          data.pending ? data : startSession(data),
        ),
      loginWithGoogle: (credential) => api('/auth/google', { method: 'POST', body: { credential } }).then(startSession),
      verifyEmail: (token) => api('/auth/verify-email', { method: 'POST', body: { token } }).then(startSession),
      // Explicit log out also forgets the books kept for offline reading on this device.
      logout: () => {
        clearOfflineBooks();
        logout();
      },
    }),
    [user, loading, logout, startSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
