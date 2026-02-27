'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { StatusChip } from '@/components/common/status-chip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTrackPurposeLabels } from '@/lib/track-purpose';
import type { TrackTemplate } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Ban, CheckCircle2, MoreHorizontal, Trash2 } from 'lucide-react';

interface TrackListResponse {
  items: TrackTemplate[];
  meta: { page: number; page_size: number; total: number };
}

export default function TracksPage() {
  const { accessToken, hasRole } = useAuth();
  const { getLabel: getPurposeLabel } = useTrackPurposeLabels();
  const [tracks, setTracks] = useState<TrackTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [trackToDelete, setTrackToDelete] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canManageTracks = hasRole('admin') || hasRole('super_admin');

  const loadTracks = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const response = await api.get<TrackListResponse>('/tracks?page=1&page_size=100', accessToken);
      setTracks(response.items);
    } finally {
      setLoading(false);
    }
  };

  const setTrackActive = async (templateId: string, nextActive: boolean) => {
    if (!accessToken) return;
    setStatusUpdatingId(templateId);
    setActionError(null);
    try {
      const action = nextActive ? 'activate' : 'deactivate';
      const updated = await api.post<TrackTemplate>(`/tracks/${templateId}/${action}`, {}, accessToken);
      setTracks((prev) => prev.map((track) => (track.id === templateId ? updated : track)));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update track status');
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const deleteTrack = async (templateId: string) => {
    if (!accessToken) return;
    setDeletingId(templateId);
    setActionError(null);
    try {
      await api.delete(`/tracks/${templateId}`, accessToken);
      setTracks((prev) => prev.filter((track) => track.id !== templateId));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete track');
    } finally {
      setDeletingId(null);
    }
  };

  const getLabel = (value?: string) => getPurposeLabel(value);

  useEffect(() => {
    const run = async () => {
      await loadTracks();
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
            const hasDraft = track.versions.some((version) => version.status === 'draft');
            const isInactive = !track.is_active;
            const isUpdatingStatus = statusUpdatingId === track.id;
            const isDeleting = deletingId === track.id;
            return (
              <Card
                key={track.id}
                className={cn(
                  'relative animate-fade-up overflow-hidden',
                  isInactive && 'border-amber-200 bg-amber-50/40 shadow-none',
                )}
              >
                {isInactive && (
                  <div
                    aria-hidden
                    className='pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(251,191,36,0.10)_0%,rgba(251,191,36,0.10)_10%,transparent_10%,transparent_50%,rgba(251,191,36,0.10)_50%,rgba(251,191,36,0.10)_60%,transparent_60%,transparent_100%)] bg-[length:18px_18px]'
                  />
                )}
                <CardHeader>
                  <div className='flex items-center justify-between gap-3'>
                    <CardTitle>{track.title}</CardTitle>
                    <div className='flex items-center gap-2'>
                      {currentVersion ? <StatusChip status={currentVersion.status} /> : <StatusChip status='draft' />}
                      {isInactive && <StatusChip status='inactive' />}
                      {canManageTracks && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant='ghost' size='icon' aria-label='Track actions'>
                              <MoreHorizontal className='h-4 w-4' />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align='end'>
                            <DropdownMenuItem asChild>
                              <Link href={`/tracks/${track.id}`}>Open builder</Link>
                            </DropdownMenuItem>
                            {hasDraft && (
                              <DropdownMenuItem asChild>
                                <Link href={`/tracks/${track.id}/publish`}>Publish</Link>
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onSelect={() => setTrackActive(track.id, !track.is_active)}
                              disabled={isUpdatingStatus || isDeleting}
                            >
                              {track.is_active ? (
                                <Ban className='mr-2 h-4 w-4' />
                              ) : (
                                <CheckCircle2 className='mr-2 h-4 w-4' />
                              )}
                              {track.is_active
                                ? isUpdatingStatus
                                  ? 'Disabling…'
                                  : 'Disable'
                                : isUpdatingStatus
                                  ? 'Enabling…'
                                  : 'Enable'}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className='text-destructive focus:text-destructive'
                              onSelect={() => setTrackToDelete(track.id)}
                              disabled={isDeleting}
                            >
                              <Trash2 className='mr-2 h-4 w-4' />
                              Delete permanently
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                  <CardDescription>{track.description || 'No description provided.'}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className='text-xs text-muted-foreground'>
                    <p>Role target: {track.role_target || 'General'}</p>
                    <p>Estimated duration: {track.estimated_duration_days} days</p>
                    <p>Purpose: {getLabel(track.purpose)}</p>
                    <p>Versions: {track.versions.length}</p>
                  </div>

                  {isInactive && (
                    <div className='mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-white/70 px-3 py-2 text-xs text-amber-900'>
                      <Ban className='mt-0.5 h-4 w-4 flex-none text-amber-700' />
                      <div>
                        <p className='font-medium'>Disabled</p>
                        <p className='text-amber-800/90'>
                          This track can’t be assigned. Enable it from the menu when you’re ready.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className='mt-4 flex flex-wrap gap-2'>
                    <Button variant='outline' asChild>
                      <Link href={`/tracks/${track.id}`}>Open builder</Link>
                    </Button>
                    {hasDraft && (
                      <Button variant='secondary' asChild>
                        <Link href={`/tracks/${track.id}/publish`}>Publish</Link>
                      </Button>
                    )}
                  </div>
                  {actionError && (
                    <p className='mt-3 whitespace-pre-wrap text-xs text-destructive'>
                      {actionError}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        title='Delete track?'
        description='This will permanently delete the track and all versions. Existing assignments cannot be recovered.'
        confirmText={trackToDelete && deletingId === trackToDelete ? 'Deleting…' : 'Delete'}
        open={trackToDelete !== null}
        onOpenChange={(open) => !open && setTrackToDelete(null)}
        onConfirm={() => {
          if (trackToDelete) {
            void deleteTrack(trackToDelete);
            setTrackToDelete(null);
          }
        }}
      />
    </div>
  );
}
