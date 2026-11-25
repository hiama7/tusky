// Provides the logged-in demo user and admin to the whole app.
import { createContext, useContext, useEffect, useState } from 'react';
import * as auth from '../services/auth';
import { CHANGE_EVENT } from '../services/storage';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => auth.currentUser());
  const [admin, setAdmin] = useState(() => auth.currentAdmin());

  // Stay in sync when another tab or a service changes the session/profile.
  useEffect(() => {
    const sync = () => {
      setUser(auth.currentUser());
      setAdmin(auth.currentAdmin());
    };
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const value = {
    user,
    admin,
    login: async (creds) => setUser(await auth.login(creds)),
    register: (data) => auth.register(data),
    logout: async () => { await auth.logout(); setUser(null); },
    adminLogin: async (creds) => setAdmin(await auth.adminLogin(creds)),
    adminLogout: async () => { await auth.adminLogout(); setAdmin(null); },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
