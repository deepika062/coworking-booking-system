import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { refreshSession, setAccessToken, subscribeSession } from '../api/client.js';
import { authApi } from '../api/endpoints.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    subscribeSession(setUser);
    // Restore the session from the httpOnly refresh cookie (if any).
    refreshSession()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const startSession = useCallback((session) => {
    setAccessToken(session.accessToken);
    setUser(session.user);
    return session.user;
  }, []);

  const login = useCallback((creds) => authApi.login(creds).then(startSession), [startSession]);
  const register = useCallback((body) => authApi.register(body).then(startSession), [startSession]);
  const logout = useCallback(async () => {
    await authApi.logout().catch(() => {});
    setAccessToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, isAdmin: user?.role === 'admin', login, register, logout }),
    [user, loading, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
