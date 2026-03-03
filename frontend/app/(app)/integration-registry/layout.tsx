'use client';

import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { IrCryptoSettings } from '@/lib/types';
import { ModuleLockedBanner } from '@/components/common/module-locked-banner';

export default function IntegrationRegistryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { accessToken } = useAuth();
  const [crypto, setCrypto] = useState<IrCryptoSettings | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    api
      .get<IrCryptoSettings>('/integration-registry/settings', accessToken)
      .then((data) => setCrypto(data))
      .catch(() => {});
  }, [accessToken]);

  const locked = crypto ? !crypto.unlocked : false;
  const desc = crypto?.initialized
    ? 'Encryption key is not loaded. Some data is hidden until an admin unlocks it.'
    : 'Encryption is not initialized. An admin must set the key in Settings.';

  return (
    <div className="-m-6 p-4 min-h-0 flex flex-col gap-4">
      <ModuleLockedBanner
        isLocked={locked}
        title="Integration Registry locked"
        description={desc}
        settingsHref="/integration-registry/settings"
      />
      {children}
    </div>
  );
}
