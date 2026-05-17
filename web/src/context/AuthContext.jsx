import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, clearToken, getToken, setToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(Boolean(getToken()));
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    setBooting(false);
    const onUnauthorized = () => setIsAuthenticated(false);
    window.addEventListener('ht:unauthorized', onUnauthorized);
    return () => window.removeEventListener('ht:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(async (code) => {
    const data = await api.login(code);
    setToken(data.token);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setIsAuthenticated(false);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, booting, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
