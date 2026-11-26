// Provides the logged-in user and admin. Sessions are restored on page load from
// the httpOnly refresh cookies (separate for user and admin); nothing about the
// session is stored in localStorage.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as auth from '../services/auth';
import { SESSION_EXPIRED_EVENT } from '../services/api';
import { clearLegacyDemoData } from '../services/storage';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [admin, setAdmin] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    clearLegacyDemoData();
    Promise.allSettled([auth.restore('user'), auth.restore('admin')]).then(([u, a]) => {
      setUser(u.value || null);
      setAdmin(a.value || null);
      setReady(true);
    });
    const onExpired = (e) => (e.detail === 'admin' ? setAdmin(null) : setUser(null));
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const refreshUser = useCallback(async () => setUser(await auth.me()), []);

  const value = useMemo(() => ({
    user,
    admin,
    ready,
    setUser,
    refreshUser,
    login: async (creds) => setUser(await auth.login(creds)),
    register: (data) => auth.register(data),
    logout: async () => { await auth.logout(); setUser(null); },
    adminLogin: async (creds) => setAdmin(await auth.adminLogin(creds)),
    adminLogout: async () => { await auth.adminLogout(); setAdmin(null); },
  }), [user, admin, ready, refreshUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
