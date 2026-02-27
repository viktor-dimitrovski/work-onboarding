'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { api, isAuthExpiredError } from '@/lib/api';
import type { AuthUser, TokenResponse } from '@/lib/types';

const STORAGE_KEY = 'onboarding_auth_v1';
const AUTH_UPDATED_EVENT = 'onboarding:auth-updated';
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;

type JwtPayload = { exp?: number };

function decodeJwtPayload(token: string): JwtPayload | null {
  const [, payload] = token.split('.');
  if (!payload) {
    return null;
  }

  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const json = atob(padded);
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

function getAccessTokenExpiryMs(token: string): number | null {
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    return null;
  }
  return exp * 1000;
}

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
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);

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
    const syncFromStorage = () => {
      const stored = parseStoredAuth(window.localStorage.getItem(STORAGE_KEY));
      if (!stored) {
        setUser(null);
        setAccessToken(null);
        setRefreshToken(null);
        return;
      }
      setUser(stored.user);
      setAccessToken(stored.accessToken);
      setRefreshToken(stored.refreshToken);
    };

    window.addEventListener(AUTH_UPDATED_EVENT, syncFromStorage);
    return () => window.removeEventListener(AUTH_UPDATED_EVENT, syncFromStorage);
  }, []);

  useEffect(() => {
    if (!user || !accessToken || !refreshToken) {
      writeStoredAuth(null);
      return;
    }

    writeStoredAuth({ user, accessToken, refreshToken });
  }, [user, accessToken, refreshToken]);

  const clearAuthState = useCallback(() => {
    setUser(null);
    setAccessToken(null);
    setRefreshToken(null);
  }, []);

  const hydrateAuth = useCallback((tokenResponse: TokenResponse) => {
    setUser(tokenResponse.user);
    setAccessToken(tokenResponse.access_token);
    setRefreshToken(tokenResponse.refresh_token);
  }, []);

  const refreshSession = useCallback(async () => {
    if (!refreshToken) {
      return;
    }

    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const refreshPromise = api
      .refresh(refreshToken)
      .then((tokenResponse) => {
        hydrateAuth(tokenResponse);
      })
      .catch(() => {
        clearAuthState();
      })
      .finally(() => {
        refreshInFlightRef.current = null;
      });

    refreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  }, [clearAuthState, hydrateAuth, refreshToken]);

  const login = async (email: string, password: string) => {
    const tokenResponse = await api.login(email, password);
    hydrateAuth(tokenResponse);
  };

  const logout = async () => {
    try {
      if (refreshToken) {
        await api.logout(refreshToken);
      }
    } finally {
      clearAuthState();
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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleRejection = (event: PromiseRejectionEvent) => {
      if (isAuthExpiredError(event.reason)) {
        event.preventDefault();
      }
    };

    window.addEventListener('unhandledrejection', handleRejection);
    return () => window.removeEventListener('unhandledrejection', handleRejection);
  }, []);

  useEffect(() => {
    if (!accessToken || !refreshToken) {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      return;
    }

    const expiryMs = getAccessTokenExpiryMs(accessToken);
    if (!expiryMs) {
      return;
    }

    const refreshAt = expiryMs - ACCESS_TOKEN_REFRESH_SKEW_MS;
    const delay = Math.max(refreshAt - Date.now(), 0);

    if (delay === 0) {
      void refreshSession();
      return;
    }

    refreshTimerRef.current = window.setTimeout(() => {
      void refreshSession();
    }, delay);

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [accessToken, refreshSession, refreshToken]);

  useEffect(() => {
    if (!accessToken || !refreshToken) {
      return;
    }

    const maybeRefresh = () => {
      const expiryMs = getAccessTokenExpiryMs(accessToken);
      if (!expiryMs) {
        return;
      }
      if (expiryMs - Date.now() <= ACCESS_TOKEN_REFRESH_SKEW_MS) {
        void refreshSession();
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        maybeRefresh();
      }
    };

    window.addEventListener('focus', maybeRefresh);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', maybeRefresh);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [accessToken, refreshSession, refreshToken]);

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
