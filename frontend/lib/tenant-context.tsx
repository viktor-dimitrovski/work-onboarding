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

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const { accessToken, isAuthenticated } = useAuth();
  const [context, setContext] = useState<TenantContextPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      setContext(null);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    api
      .getTenantContext(accessToken)
      .then((data) => {
        if (isMounted) {
          setContext(data as TenantContextPayload);
        }
      })
      .catch(() => {
        if (isMounted) {
          setContext(null);
        }
      })
      .finally(() => {
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
