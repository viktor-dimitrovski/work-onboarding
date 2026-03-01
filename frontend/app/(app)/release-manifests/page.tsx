"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';

type ReleaseManifestOut = {
  rel_id: string;
  path: string;
  sha?: string | null;
  raw_markdown: string;
  sync_status?: string | null;
  pr_url?: string | null;
  branch?: string | null;
};

export default function ReleaseManifestsPage() {
  const { accessToken } = useAuth();
  const { hasModule, hasPermission } = useTenant();
  const [items, setItems] = useState<ReleaseManifestOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingRel, setSyncingRel] = useState<string | null>(null);
  const [prRel, setPrRel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bulkSyncing, setBulkSyncing] = useState(false);
  const canWrite = hasModule('releases') && hasPermission('releases:write');

  const syncBadgeClass = (status?: string | null) => {
    switch (status) {
      case 'synced':
        return 'border-emerald-200 bg-emerald-50 text-emerald-700';
      case 'pending':
        return 'border-amber-200 bg-amber-50 text-amber-700';
      case 'failed':
        return 'border-red-200 bg-red-50 text-red-700';
      case 'disabled':
        return 'border-muted text-muted-foreground';
      default:
        return 'border-muted text-muted-foreground';
    }
  };

  const updateItem = (relId: string, next: ReleaseManifestOut) => {
    setItems((prev) => prev.map((item) => (item.rel_id === relId ? next : item)));
  };

  const syncNow = async (relId: string) => {
    if (!accessToken) return;
    setSyncingRel(relId);
    setError(null);
    try {
      const response = await api.post<ReleaseManifestOut>(`/release-manifests/${relId}/sync`, {}, accessToken);
      updateItem(relId, response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to queue sync');
    } finally {
      setSyncingRel(null);
    }
  };

  const createPr = async (relId: string) => {
    if (!accessToken) return;
    setPrRel(relId);
    setError(null);
    try {
      const response = await api.post<ReleaseManifestOut>(`/release-manifests/${relId}/pr`, {}, accessToken);
      updateItem(relId, response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create PR');
    } finally {
      setPrRel(null);
    }
  };

  const bulkSync = async (status?: string) => {
    if (!accessToken || !canWrite) return;
    setBulkSyncing(true);
    setError(null);
    try {
      const params = status ? `?sync_status=${encodeURIComponent(status)}` : '';
      await api.post(`/release-manifests/sync${params}`, {}, accessToken);
      const response = await api.get<ReleaseManifestOut[]>('/release-manifests', accessToken);
      setItems(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to queue bulk sync');
    } finally {
      setBulkSyncing(false);
    }
  };

  useEffect(() => {
    if (!accessToken) return;
    const run = async () => {
      setLoading(true);
      try {
        const response = await api.get<ReleaseManifestOut[]>('/release-manifests', accessToken);
        setItems(response);
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [accessToken]);

  if (loading) return <LoadingState label='Loading release manifests...' />;

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-semibold'>Release Manifests</h2>
          <p className='text-sm text-muted-foreground'>Aggregate multiple WOs into a deploy-ready REL.</p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          {canWrite && (
            <>
              <Button type='button' variant='outline' onClick={() => bulkSync()} disabled={bulkSyncing}>
                {bulkSyncing ? 'Syncing…' : 'Sync all'}
              </Button>
              <Button type='button' variant='outline' onClick={() => bulkSync('failed')} disabled={bulkSyncing}>
                Sync failed
              </Button>
            </>
          )}
          {canWrite && (
            <Button asChild>
              <Link href='/release-manifests/new'>New REL</Link>
            </Button>
          )}
        </div>
      </div>

      {error && <p className='text-sm text-destructive'>{error}</p>}

      {items.length === 0 ? (
        <EmptyState title='No release manifests' description='Create the first REL by aggregating work orders.' />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Recent RELs</CardTitle>
          </CardHeader>
          <CardContent className='space-y-2'>
            {items.map((item) => (
              <div key={item.rel_id} className='flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2'>
                <div>
                  <p className='text-sm font-medium'>{item.rel_id}</p>
                  <p className='text-xs text-muted-foreground'>{item.path}</p>
                </div>
                <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
                  <Badge variant='outline' className={syncBadgeClass(item.sync_status)}>
                    {item.sync_status || 'unknown'}
                  </Badge>
                  {item.pr_url ? (
                    <a className='text-primary underline' href={item.pr_url} target='_blank' rel='noreferrer'>
                      Open PR
                    </a>
                  ) : (
                    <Button
                      type='button'
                      size='sm'
                      variant='outline'
                      onClick={() => createPr(item.rel_id)}
                      disabled={!canWrite || prRel === item.rel_id}
                    >
                      {prRel === item.rel_id ? 'Creating…' : 'Create PR'}
                    </Button>
                  )}
                  <Button
                    type='button'
                    size='sm'
                    variant='outline'
                    onClick={() => syncNow(item.rel_id)}
                    disabled={!canWrite || syncingRel === item.rel_id}
                  >
                    {syncingRel === item.rel_id ? 'Syncing…' : 'Sync now'}
                  </Button>
                  <span>{item.sha ? `sha: ${item.sha.slice(0, 7)}` : '—'}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
