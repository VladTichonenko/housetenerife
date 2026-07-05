import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, clearToken, getManager, getToken, setManager, setToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(Boolean(getToken()));
  const [manager, setManagerState] = useState(getManager());
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const init = async () => {
      if (getToken() && !getManager()) {
        try {
          const data = await api.me();
          if (data.manager) {
            setManager(data.manager);
            setManagerState(data.manager);
          }
        } catch {
          clearToken();
          setIsAuthenticated(false);
        }
      }
      setBooting(false);
    };
    init();

    const onUnauthorized = () => {
      setIsAuthenticated(false);
      setManagerState(null);
    };
    window.addEventListener('ht:unauthorized', onUnauthorized);
    return () => window.removeEventListener('ht:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(async (code) => {
    const data = await api.login(code);
    setToken(data.token);
    if (data.manager) {
      setManager(data.manager);
      setManagerState(data.manager);
    }
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setManagerState(null);
    setIsAuthenticated(false);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, booting, manager, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
