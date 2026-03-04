'use client';

import { IrCryptoProvider, useIrCrypto } from './crypto-context';
import { ModuleLockedBanner } from '@/components/common/module-locked-banner';

function LayoutInner({ children }: { children: React.ReactNode }) {
  const { crypto } = useIrCrypto();

  const locked = crypto ? !crypto.unlocked : false;
  const desc = crypto?.initialized
    ? 'Encryption key is not loaded. Some data is hidden until an admin unlocks it in Settings.'
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

export default function IntegrationRegistryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <IrCryptoProvider>
      <LayoutInner>{children}</LayoutInner>
    </IrCryptoProvider>
  );
}
