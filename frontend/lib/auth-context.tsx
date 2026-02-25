'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import type { AuthUser, TokenResponse } from '@/lib/types';

const STORAGE_KEY = 'onboarding_auth_v1';

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (role: string) => boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

function parseStoredAuth(raw: string | null): { user: AuthUser; accessToken: string; refreshToken: string } | null {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as { user: AuthUser; accessToken: string; refreshToken: string };
  } catch {
    return null;
  }
}

function writeStoredAuth(payload: { user: AuthUser; accessToken: string; refreshToken: string } | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (!payload) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = parseStoredAuth(window.localStorage.getItem(STORAGE_KEY));
    if (!stored) {
      setIsLoading(false);
      return;
    }

    setUser(stored.user);
    setAccessToken(stored.accessToken);
    setRefreshToken(stored.refreshToken);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!user || !accessToken || !refreshToken) {
      writeStoredAuth(null);
      return;
    }

    writeStoredAuth({ user, accessToken, refreshToken });
  }, [user, accessToken, refreshToken]);

  const login = async (email: string, password: string) => {
    const tokenResponse = await api.login(email, password);
    hydrateAuth(tokenResponse);
  };

  const hydrateAuth = (tokenResponse: TokenResponse) => {
    setUser(tokenResponse.user);
    setAccessToken(tokenResponse.access_token);
    setRefreshToken(tokenResponse.refresh_token);
  };

  const logout = async () => {
    try {
      if (refreshToken) {
        await api.logout(refreshToken);
      }
    } finally {
      setUser(null);
      setAccessToken(null);
      setRefreshToken(null);
    }
  };

  const hasRole = (role: string) => !!user?.roles.includes(role as never);

  const contextValue = useMemo<AuthState>(
    () => ({
      user,
      accessToken,
      refreshToken,
      isLoading,
      isAuthenticated: !!user && !!accessToken,
      login,
      logout,
      hasRole,
    }),
    [accessToken, isLoading, refreshToken, user],
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
