import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, onUnauthorized, tokenStore } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(tokenStore.get()));

  const logout = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    onUnauthorized(logout);
    if (!tokenStore.get()) return;
    api('/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, [logout]);

  const startSession = useCallback((data) => {
    tokenStore.set(data.token);
    setUser(data.user);
    return data.user;
  }, []);

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
      logout,
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
