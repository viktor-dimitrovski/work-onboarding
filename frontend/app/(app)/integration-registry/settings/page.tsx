'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import type { IrCryptoSettings } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SecretKeyEntry } from '@/components/common/secret-key-entry';

export default function IntegrationRegistrySettingsPage() {
  const router = useRouter();
  const { accessToken } = useAuth();
  const { hasModule, hasPermission, isLoading: tenantLoading } = useTenant();
  const { isLoading: authLoading } = useAuth();

  const [state, setState] = useState<IrCryptoSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !tenantLoading) {
      if (!hasModule('integration_registry') || !hasPermission('ir:admin')) {
        router.replace('/dashboard');
      }
    }
  }, [authLoading, tenantLoading, hasModule, hasPermission, router]);

  const loadState = () => {
    if (!accessToken) return;
    setLoading(true);
    api
      .get<IrCryptoSettings>('/integration-registry/settings', accessToken)
      .then((data) => setState(data))
      .catch((e) => setError(e.message || 'Failed to load settings'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const handleUnlock = async (passphrase: string, reinitialize: boolean) => {
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    try {
      await api.post(
        '/integration-registry/settings/unlock',
        { passphrase, reinitialize },
        accessToken,
      );
      loadState();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to unlock');
    } finally {
      setSaving(false);
    }
  };

  const handleLock = async () => {
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    try {
      await api.post('/integration-registry/settings/lock', {}, accessToken);
      loadState();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to lock');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-3xl mx-auto min-w-0">
      <div>
        <h1 className="text-xl font-semibold">Integration Registry Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage the per-tenant encryption key. The key is never stored and must be kept safe.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Encryption Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {loading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : (
            <>
              <div>
                <span className="font-medium">Initialized:</span>{' '}
                {state?.initialized ? 'Yes' : 'No'}
              </div>
              <div>
                <span className="font-medium">Unlocked:</span>{' '}
                {state?.unlocked ? 'Yes' : 'No'}
              </div>
              <p className="text-xs text-muted-foreground">
                After a backend restart, the module becomes locked until an admin re-enters the key.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {state?.initialized ? 'Unlock' : 'Initialize'} Encryption
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SecretKeyEntry
            submitLabel={state?.initialized ? 'Unlock' : 'Initialize'}
            allowReinitialize
            onSubmit={handleUnlock}
            disabled={saving}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            The key is not stored. If you lose it, existing encrypted data cannot be recovered.
          </p>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end">
        <Button variant="outline" onClick={handleLock} disabled={saving}>
          Lock Module
        </Button>
      </div>
    </div>
  );
}
