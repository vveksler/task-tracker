'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { User } from '@/types/api';
import {
  apiLogin,
  apiLogout,
  apiRefreshToken,
  apiRegister,
  setAccessToken,
  setOnSessionExpired,
} from '@/lib/api-client';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** Registers and returns a message; does not create a session until email is verified. */
  register: (
    email: string,
    password: string,
    name: string,
  ) => Promise<{ message: string }>;
  /** Apply a session after email verification (BFF already set the refresh cookie). */
  setSessionUser: (user: User) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const useAuth = (): AuthState => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    apiRefreshToken()
      .then((data) => {
        if (data) setUser(data.user);
      })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    setOnSessionExpired(() => {
      setUser(null);
    });
    return () => setOnSessionExpired(null);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiLogin(email, password);
    setUser(data.user);
  }, []);

  const register = useCallback(
    async (email: string, password: string, name: string) => {
      return apiRegister(email, password, name);
    },
    [],
  );

  const setSessionUser = useCallback((next: User) => {
    setUser(next);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setAccessToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, isLoading, login, register, setSessionUser, logout }),
    [user, isLoading, login, register, setSessionUser, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
