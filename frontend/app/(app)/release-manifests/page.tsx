"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
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
};

export default function ReleaseManifestsPage() {
  const { accessToken } = useAuth();
  const { hasModule, hasPermission } = useTenant();
  const [items, setItems] = useState<ReleaseManifestOut[]>([]);
  const [loading, setLoading] = useState(true);
  const canWrite = hasModule('releases') && hasPermission('releases:write');

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
        {canWrite && (
          <Button asChild>
            <Link href='/release-manifests/new'>New REL</Link>
          </Button>
        )}
      </div>

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
                <div className='text-xs text-muted-foreground'>{item.sha ? `sha: ${item.sha.slice(0, 7)}` : '—'}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
