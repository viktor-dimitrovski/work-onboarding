'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { TenantContext as TenantContextPayload } from '@/lib/types';

interface TenantContextState {
  context: TenantContextPayload | null;
  isLoading: boolean;
  hasPermission: (permission: string) => boolean;
  hasModule: (moduleKey: string) => boolean;
}

const TenantContext = createContext<TenantContextState | undefined>(undefined);

// Deduplicate calls in dev (React StrictMode) and across components.
const tenantContextCacheByToken = new Map<string, TenantContextPayload>();
const tenantContextInflightByToken = new Map<string, Promise<TenantContextPayload>>();

function isProductHost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  const reserved = (process.env.NEXT_PUBLIC_RESERVED_SUBDOMAINS || 'admin')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  // Check if the first subdomain label is a reserved name (e.g. admin.solvebox.org → "admin").
  // This avoids depending on NEXT_PUBLIC_BASE_DOMAINS matching the runtime domain,
  // since NEXT_PUBLIC_* vars are baked in at build time and may differ from the deploy target.
  const parts = host.split('.');
  if (parts.length >= 3 && reserved.includes(parts[0])) return true;
  return false;
}

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const { accessToken, isAuthenticated } = useAuth();
  const [context, setContext] = useState<TenantContextPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !accessToken || isProductHost()) {
      setContext(null);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    const cached = tenantContextCacheByToken.get(accessToken);
    if (cached) {
      setContext(cached);
      setIsLoading(false);
      return () => {
        isMounted = false;
      };
    }

    setIsLoading(true);

    const existing = tenantContextInflightByToken.get(accessToken);
    const promise =
      existing ??
      api.getTenantContext(accessToken).then((data) => {
        const payload = data as TenantContextPayload;
        tenantContextCacheByToken.set(accessToken, payload);
        return payload;
      });
    if (!existing) tenantContextInflightByToken.set(accessToken, promise);

    promise
      .then((data) => {
        if (isMounted) {
          setContext(data);
        }
      })
      .catch(() => {
        if (isMounted) {
          setContext(null);
        }
      })
      .finally(() => {
        tenantContextInflightByToken.delete(accessToken);
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [accessToken, isAuthenticated]);

  const hasPermission = useCallback(
    (permission: string) => {
      if (!context) {
        return false;
      }
      return context.permissions?.includes(permission) ?? false;
    },
    [context],
  );

  const hasModule = useCallback(
    (moduleKey: string) => {
      if (!context) {
        return false;
      }
      return context.modules?.includes(moduleKey) ?? false;
    },
    [context],
  );

  const value = useMemo(
    () => ({
      context,
      isLoading,
      hasPermission,
      hasModule,
    }),
    [context, hasModule, hasPermission, isLoading],
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return ctx;
}
