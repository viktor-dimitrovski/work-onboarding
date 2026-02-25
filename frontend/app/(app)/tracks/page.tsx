'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { StatusChip } from '@/components/common/status-chip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { TrackTemplate } from '@/lib/types';

interface TrackListResponse {
  items: TrackTemplate[];
  meta: { page: number; page_size: number; total: number };
}

export default function TracksPage() {
  const { accessToken } = useAuth();
  const [tracks, setTracks] = useState<TrackTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      if (!accessToken) return;
      setLoading(true);
      try {
        const response = await api.get<TrackListResponse>('/tracks?page=1&page_size=100', accessToken);
        setTracks(response.items);
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [accessToken]);

  if (loading) return <LoadingState label='Loading tracks...' />;

  return (
    <div className='space-y-5'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-2xl font-semibold'>Onboarding tracks</h2>
          <p className='text-sm text-muted-foreground'>Manage track templates and publication lifecycle.</p>
        </div>
        <Button asChild>
          <Link href='/tracks/new'>New track</Link>
        </Button>
      </div>

      {tracks.length === 0 ? (
        <EmptyState title='No tracks found' description='Create your first role-specific onboarding track.' />
      ) : (
        <div className='grid gap-4 lg:grid-cols-2'>
          {tracks.map((track) => {
            const currentVersion = track.versions.find((version) => version.is_current) || track.versions[0];
            return (
              <Card key={track.id} className='animate-fade-up'>
                <CardHeader>
                  <div className='flex items-center justify-between gap-3'>
                    <CardTitle>{track.title}</CardTitle>
                    {currentVersion ? <StatusChip status={currentVersion.status} /> : <StatusChip status='draft' />}
                  </div>
                  <CardDescription>{track.description || 'No description provided.'}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className='text-xs text-muted-foreground'>
                    <p>Role target: {track.role_target || 'General'}</p>
                    <p>Estimated duration: {track.estimated_duration_days} days</p>
                    <p>Versions: {track.versions.length}</p>
                  </div>
                  <div className='mt-4 flex gap-2'>
                    <Button variant='outline' asChild>
                      <Link href={`/tracks/${track.id}`}>Open builder</Link>
                    </Button>
                    <Button variant='secondary' asChild>
                      <Link href={`/tracks/${track.id}/publish`}>Publish</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
