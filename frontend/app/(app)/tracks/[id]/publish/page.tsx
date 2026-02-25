'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { StatusChip } from '@/components/common/status-chip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { TrackTemplate } from '@/lib/types';

export default function PublishTrackPage() {
  const { id } = useParams<{ id: string }>();
  const { accessToken } = useAuth();
  const [track, setTrack] = useState<TrackTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTrack = async () => {
    if (!accessToken || !id) return;
    setLoading(true);
    setError(null);
    try {
      setTrack(await api.get<TrackTemplate>(`/tracks/${id}`, accessToken));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load track');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTrack();
  }, [accessToken, id]);

  const publishVersion = async (versionId: string) => {
    if (!accessToken) return;
    await api.post(`/tracks/${id}/publish/${versionId}`, {}, accessToken);
    await loadTrack();
  };

  if (loading) return <LoadingState label='Loading publish options...' />;
  if (!track) return <EmptyState title='Track not found' description='Track template does not exist.' />;

  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-2xl font-semibold'>Publish track</h2>
        <p className='text-sm text-muted-foreground'>Promote a draft track version to active publication.</p>
      </div>

      {error && <p className='rounded-md bg-destructive/10 p-3 text-sm text-destructive'>{error}</p>}

      <div className='space-y-3'>
        {track.versions
          .slice()
          .sort((a, b) => b.version_number - a.version_number)
          .map((version) => (
            <Card key={version.id}>
              <CardHeader>
                <div className='flex items-center justify-between'>
                  <CardTitle>Version {version.version_number}</CardTitle>
                  <StatusChip status={version.status} />
                </div>
                <CardDescription>{version.description || 'No version description provided.'}</CardDescription>
              </CardHeader>
              <CardContent className='flex items-center justify-between'>
                <p className='text-sm text-muted-foreground'>
                  Phases: {version.phases.length} • Current: {version.is_current ? 'Yes' : 'No'}
                </p>
                <ConfirmDialog
                  title='Publish this version?'
                  description='Publishing this version will archive any currently published version.'
                  confirmText='Publish'
                  onConfirm={() => {
                    void publishVersion(version.id);
                  }}
                  trigger={
                    <Button disabled={version.status === 'published'}>
                      {version.status === 'published' ? 'Published' : 'Publish'}
                    </Button>
                  }
                />
              </CardContent>
            </Card>
          ))}
      </div>
    </div>
  );
}
