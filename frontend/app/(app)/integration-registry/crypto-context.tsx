'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { IrCryptoSettings } from '@/lib/types';

interface IrCryptoContextValue {
  crypto: IrCryptoSettings | null;
  loading: boolean;
  refresh: () => void;
}

const IrCryptoContext = createContext<IrCryptoContextValue>({
  crypto: null,
  loading: true,
  refresh: () => {},
});

export function IrCryptoProvider({ children }: { children: ReactNode }) {
  const { accessToken } = useAuth();
  const [crypto, setCrypto] = useState<IrCryptoSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!accessToken) return;
    setLoading(true);
    api
      .get<IrCryptoSettings>('/integration-registry/settings', accessToken)
      .then((data) => setCrypto(data))
      .catch(() => setCrypto(null))
      .finally(() => setLoading(false));
  }, [accessToken]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <IrCryptoContext.Provider value={{ crypto, loading, refresh }}>
      {children}
    </IrCryptoContext.Provider>
  );
}

export const useIrCrypto = () => useContext(IrCryptoContext);
