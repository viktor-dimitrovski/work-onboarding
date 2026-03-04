'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Info, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { useIrCrypto } from '../crypto-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SecretKeyEntry } from '@/components/common/secret-key-entry';

export default function IntegrationRegistrySettingsPage() {
  const router = useRouter();
  const { accessToken } = useAuth();
  const { hasModule, hasPermission, isLoading: tenantLoading } = useTenant();
  const { isLoading: authLoading } = useAuth();
  const { crypto, loading, refresh } = useIrCrypto();

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !tenantLoading) {
      if (!hasModule('integration_registry') || !hasPermission('ir:admin')) {
        router.replace('/dashboard');
      }
    }
  }, [authLoading, tenantLoading, hasModule, hasPermission, router]);

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
      refresh();
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
      refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to lock');
    } finally {
      setSaving(false);
    }
  };

  const isUnlocked = crypto?.unlocked ?? false;
  const isInitialized = crypto?.initialized ?? false;

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

      {/* Status card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            {loading ? (
              <span className="text-muted-foreground text-sm font-normal">Loading…</span>
            ) : isUnlocked ? (
              <>
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
                Encryption Status
                <Badge
                  variant="outline"
                  className="ml-1 bg-emerald-100 text-emerald-800 border-emerald-300 font-medium"
                >
                  Unlocked
                </Badge>
              </>
            ) : isInitialized ? (
              <>
                <ShieldX className="h-5 w-5 text-amber-500" />
                Encryption Status
                <Badge
                  variant="outline"
                  className="ml-1 bg-amber-100 text-amber-800 border-amber-300 font-medium"
                >
                  Locked
                </Badge>
              </>
            ) : (
              <>
                <ShieldAlert className="h-5 w-5 text-slate-400" />
                Encryption Status
                <Badge
                  variant="outline"
                  className="ml-1 bg-slate-100 text-slate-600 border-slate-300 font-medium"
                >
                  Not Initialized
                </Badge>
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!loading && (
            isUnlocked ? (
              <div className="rounded-md bg-emerald-50 border border-emerald-100 px-4 py-3 text-sm text-emerald-800 flex items-start gap-2.5">
                <Info className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
                <div className="space-y-1">
                  <p>The encryption key is loaded in memory. All encrypted fields are readable and new connections can be created.</p>
                  {crypto?.key_fingerprint && (
                    <p className="text-xs font-mono text-emerald-700">
                      Key fingerprint: {crypto.key_fingerprint.slice(0, 20)}…
                    </p>
                  )}
                </div>
              </div>
            ) : isInitialized ? (
              <div className="rounded-md bg-amber-50 border border-amber-100 px-4 py-3 text-sm text-amber-800 flex items-start gap-2.5">
                <Info className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                <p>The encryption key is not in memory — this happens after a backend restart. Enter the passphrase below to unlock the module.</p>
              </div>
            ) : (
              <div className="rounded-md bg-slate-50 border border-slate-100 px-4 py-3 text-sm text-slate-600 flex items-start gap-2.5">
                <Info className="h-4 w-4 shrink-0 mt-0.5 text-slate-400" />
                <p>No encryption key has been set for this tenant yet. Set a passphrase below to initialize encryption for the Integration Registry.</p>
              </div>
            )
          )}
        </CardContent>
      </Card>

      {/* Action card — shows ONLY the relevant action */}
      {!loading && (
        isUnlocked ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Lock Module</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Locking clears the key from memory. Encrypted fields will be hidden and new connections
                cannot be created until an admin unlocks again.
              </p>
              <div className="flex justify-end">
                <Button variant="destructive" onClick={handleLock} disabled={saving}>
                  {saving ? 'Locking…' : 'Lock Module'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {isInitialized ? 'Unlock Encryption' : 'Initialize Encryption'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SecretKeyEntry
                submitLabel={isInitialized ? 'Unlock' : 'Initialize & Unlock'}
                allowReinitialize={isInitialized}
                onSubmit={handleUnlock}
                disabled={saving}
              />
              <p className="mt-3 text-xs text-muted-foreground">
                The key is not stored anywhere. If you lose it, existing encrypted data cannot be recovered.
              </p>
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
}
