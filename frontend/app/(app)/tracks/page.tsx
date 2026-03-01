'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';

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
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MultiSelect } from '@/components/inputs/multi-select';
import { SingleSelect } from '@/components/inputs/single-select';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { useTrackPurposeLabels } from '@/lib/track-purpose';
import type { TrackTemplate } from '@/lib/types';
import { cn } from '@/lib/utils';
import { shortId } from '@/lib/constants';
import { AlertCircle, AlertTriangle, Ban, CheckCircle2, Layers, MoreHorizontal, Rocket, Trash2, X } from 'lucide-react';

interface TrackListResponse {
  items: TrackTemplate[];
  meta: { page: number; page_size: number; total: number };
}

type TrackCascadeDeletePreviewAssignment = {
  id: string;
  title: string;
  status: string;
  employee_id: string;
  mentor_id?: string | null;
  start_date: string;
  target_date: string;
  progress_percent: number;
};

type TrackCascadeDeletePreview = {
  template_id: string;
  title: string;
  assignment_count: number;
  assignments: TrackCascadeDeletePreviewAssignment[];
  confirm_phrase: string;
};

export default function TracksPage() {
  const { accessToken } = useAuth();
  const { hasModule, hasPermission } = useTenant();
  const { getLabel: getPurposeLabel, options: purposeOptions } = useTrackPurposeLabels();
  const [tracks, setTracks] = useState<TrackTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [trackToDelete, setTrackToDelete] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [exitingIds, setExitingIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [purposeFilter, setPurposeFilter] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'flat' | 'grouped'>('flat');
  const [activePurposeGroup, setActivePurposeGroup] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    actions?: { label: string; href?: string; onClick?: () => void }[];
  } | null>(null);
  const [cascadeTargetId, setCascadeTargetId] = useState<string | null>(null);
  const [cascadePreview, setCascadePreview] = useState<TrackCascadeDeletePreview | null>(null);
  const [cascadeLoading, setCascadeLoading] = useState(false);
  const [cascadeError, setCascadeError] = useState<string | null>(null);
  const [cascadeConfirm, setCascadeConfirm] = useState('');
  const [cascadeDeleting, setCascadeDeleting] = useState(false);

  const canManageTracks = hasModule('tracks') && hasPermission('tracks:write');

  const toastActions = useMemo(() => toast?.actions ?? [], [toast]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!cascadeTargetId || !accessToken) return;
    setCascadeLoading(true);
    setCascadeError(null);
    setCascadePreview(null);
    setCascadeConfirm('');
    api
      .get<TrackCascadeDeletePreview>(`/tracks/${cascadeTargetId}/delete-preview`, accessToken)
      .then((preview) => setCascadePreview(preview))
      .catch((err) => setCascadeError(normalizeApiErrorMessage(err)))
      .finally(() => setCascadeLoading(false));
  }, [accessToken, cascadeTargetId]);

  const normalizeApiErrorMessage = (err: unknown): string => {
    if (!(err instanceof Error)) return 'Something went wrong.';
    const raw = (err.message || '').trim();
    if (!raw) return 'Something went wrong.';
    try {
      const parsed = JSON.parse(raw) as { detail?: string; message?: string };
      return parsed?.detail || parsed?.message || raw;
    } catch {
      return raw;
    }
  };

  const filteredTracks = tracks.filter((track) => {
    if (purposeFilter.length > 0 && !purposeFilter.includes(track.purpose || '')) {
      return false;
    }
    if (!query.trim()) {
      return true;
    }
    const needle = query.trim().toLowerCase();
    return (
      track.title.toLowerCase().includes(needle) ||
      (track.description || '').toLowerCase().includes(needle) ||
      (track.role_target || '').toLowerCase().includes(needle)
    );
  });

  const loadTracks = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', '1');
      params.set('page_size', '100');
      if (statusFilter) params.set('status', statusFilter);
      if (roleFilter) params.set('role_target', roleFilter);
      const response = await api.get<TrackListResponse>(`/tracks?${params.toString()}`, accessToken);
      setTracks(response.items);
    } finally {
      setLoading(false);
    }
  };

  const setTrackActive = async (templateId: string, nextActive: boolean) => {
    if (!accessToken) return;
    setStatusUpdatingId(templateId);
    try {
      const action = nextActive ? 'activate' : 'deactivate';
      const updated = await api.post<TrackTemplate>(`/tracks/${templateId}/${action}`, {}, accessToken);
      setTracks((prev) => prev.map((track) => (track.id === templateId ? updated : track)));
    } catch (err) {
      setToast({ message: normalizeApiErrorMessage(err) || 'Failed to update track status' });
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const deleteTrack = async (templateId: string) => {
    if (!accessToken) return;
    const startedAt = Date.now();
    setDeletingId(templateId);
    let didSucceed = false;
    try {
      await api.delete(`/tracks/${templateId}`, accessToken);
      setExitingIds((prev) => (prev.includes(templateId) ? prev : [...prev, templateId]));
      window.setTimeout(() => {
        setTracks((prev) => prev.filter((track) => track.id !== templateId));
        setExitingIds((prev) => prev.filter((id) => id !== templateId));
      }, 1950);
      didSucceed = true;
    } catch (err) {
      const msg = normalizeApiErrorMessage(err) || 'Failed to delete track';
      const isReferenced = msg.toLowerCase().includes('referenced') && msg.toLowerCase().includes('assign');
      if (isReferenced) {
        setToast({
          message: "Can’t delete this track because it’s used by existing assignments.",
          actions: [
            { label: 'View assignments', href: `/assignments?template_id=${encodeURIComponent(templateId)}` },
            { label: 'Disable track', onClick: () => setTrackActive(templateId, false) },
          ],
        });
      } else {
        setToast({ message: msg });
      }
    } finally {
      if (didSucceed) {
        const elapsed = Date.now() - startedAt;
        const minVisibleMs = 3600;
        const delay = Math.max(0, minVisibleMs - elapsed);
        window.setTimeout(() => setDeletingId(null), delay);
      } else {
        setDeletingId(null);
      }
    }
  };

  const getLabel = (value?: string) => getPurposeLabel(value);

  const glassCardClass = 'bg-gradient-to-b from-white/90 to-white/60 backdrop-blur';

  const renderTrackCard = (track: TrackTemplate) => {
    const currentVersion = track.versions.find((version) => version.is_current) || track.versions[0];
    const hasDraft = track.versions.some((version) => version.status === 'draft');
    const isInactive = !track.is_active;
    const isUpdatingStatus = statusUpdatingId === track.id;
    const isDeleting = deletingId === track.id;
    const isExiting = exitingIds.includes(track.id);
    const phaseCount = currentVersion?.phases?.length ?? 0;
    const taskCount = currentVersion?.phases?.reduce((sum, phase) => sum + (phase.tasks?.length ?? 0), 0) ?? 0;

    return (
      <Card
        key={track.id}
        className={cn(
          'relative flex h-[240px] animate-fade-up flex-col overflow-hidden',
          glassCardClass,
          isInactive && 'border-amber-200 bg-amber-50/40 shadow-none',
          isExiting && 'opacity-0 scale-[0.98] transition-[opacity,transform] duration-[2100ms]',
        )}
      >
        {isDeleting || isExiting ? (
          <div
            aria-hidden
            className='pointer-events-none absolute inset-0 rounded-lg ring-4 ring-destructive/70 shadow-[0_0_0_6px_rgba(239,68,68,0.18)] animate-[pulse_9.6s_ease-in-out_infinite]'
          />
        ) : null}
        {isInactive && (
          <div
            aria-hidden
            className='pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(251,191,36,0.10)_0%,rgba(251,191,36,0.10)_10%,transparent_10%,transparent_50%,rgba(251,191,36,0.10)_50%,rgba(251,191,36,0.10)_60%,transparent_60%,transparent_100%)] bg-[length:18px_18px]'
          />
        )}
        <CardHeader className='space-y-1 pb-1'>
          <div className='flex items-center justify-between gap-3'>
            <CardTitle className='text-base leading-snug line-clamp-1'>{track.title}</CardTitle>
            <div className='flex items-center gap-2'>
              {currentVersion ? <StatusChip status={currentVersion.status} /> : <StatusChip status='draft' />}
              {isInactive && <StatusChip status='inactive' />}
              {canManageTracks && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='ghost'
                      size='icon'
                      aria-label='Track actions'
                      className='transition-none duration-0'
                    >
                      <MoreHorizontal className='h-4 w-4' />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='data-[state=open]:animate-none'>
                    <DropdownMenuItem asChild>
                      <Link href={`/tracks/${track.id}`}>
                        <Layers className='mr-2 h-4 w-4' />
                        Open builder
                      </Link>
                    </DropdownMenuItem>
                    {hasDraft && (
                      <DropdownMenuItem asChild>
                        <Link href={`/tracks/${track.id}/publish`}>
                          <Rocket className='mr-2 h-4 w-4' />
                          Publish
                        </Link>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onSelect={() => setTrackActive(track.id, !track.is_active)}
                      disabled={isUpdatingStatus || isDeleting}
                    >
                      {track.is_active ? <Ban className='mr-2 h-4 w-4' /> : <CheckCircle2 className='mr-2 h-4 w-4' />}
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
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className='text-destructive focus:text-destructive'
                      onSelect={() => setCascadeTargetId(track.id)}
                      disabled={isUpdatingStatus || isDeleting}
                    >
                      <AlertTriangle className='mr-2 h-4 w-4' />
                      Delete + assignments
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
          <CardDescription className='text-xs leading-snug line-clamp-1'>
            {track.description || 'No description provided.'}
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-1 flex-col pt-0'>
          <div className='mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] leading-tight text-muted-foreground'>
            <p className='truncate'>Role: {track.role_target || 'General'}</p>
            <p className='truncate'>Duration: {track.estimated_duration_days}d</p>
            <p className='truncate'>Purpose: {getLabel(track.purpose)}</p>
            <p className='truncate'>Versions: {track.versions.length}</p>
            <p className='truncate'>
              Phases: {phaseCount} • Tasks: {taskCount}
            </p>
            <p className='truncate'>
              By: {track.created_by_email || track.created_by_name || shortId(track.created_by)}
            </p>
          </div>

          <div className='mt-2 min-h-[24px]'>
            {isInactive ? (
              <div className='flex items-center gap-2 rounded-md border border-amber-200 bg-white/70 px-2 py-1 text-[11px] text-amber-900'>
                <Ban className='h-3.5 w-3.5 flex-none text-amber-700' />
                <p className='truncate'>Disabled: can’t be assigned until enabled.</p>
              </div>
            ) : null}
          </div>

          <div className='mt-auto flex flex-wrap gap-2 pt-2'>
            <Button size='sm' variant='outline' asChild>
              <Link href={`/tracks/${track.id}`}>Open builder</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  useEffect(() => {
    void loadTracks();
  }, [accessToken, statusFilter, roleFilter]);

  useEffect(() => {
    if (viewMode !== 'grouped') return;
    if (!activePurposeGroup) return;
    const stillHasItems = filteredTracks.some((t) => (t.purpose || '') === activePurposeGroup);
    if (!stillHasItems) {
      setActivePurposeGroup(null);
    }
  }, [activePurposeGroup, filteredTracks, viewMode]);

  if (loading) return <LoadingState label='Loading tracks...' />;

  return (
    <div className='space-y-5'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-2xl font-semibold'>Onboarding tracks</h2>
          <p className='text-sm text-muted-foreground'>Manage track templates and publication lifecycle.</p>
        </div>
        {canManageTracks && (
          <Button asChild>
            <Link href='/tracks/new'>New track</Link>
          </Button>
        )}
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder='Search tracks by title, role, or description...'
          className='max-w-sm'
        />
        <SingleSelect
          value={statusFilter}
          onChange={setStatusFilter}
          placeholder='All statuses'
          options={[
            { value: '', label: 'All statuses' },
            { value: 'draft', label: 'Draft' },
            { value: 'published', label: 'Published' },
            { value: 'archived', label: 'Archived' },
          ]}
          searchable={false}
          className='max-w-[200px]'
        />
        <Input
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value)}
          placeholder='Filter by role target'
          className='max-w-[200px]'
        />
        <MultiSelect
          value={purposeFilter}
          onChange={setPurposeFilter}
          placeholder='All purposes'
          options={purposeOptions}
          className='max-w-[320px]'
        />
        <div className='ml-auto flex items-center gap-1 rounded-md border bg-white p-1'>
          <Button
            type='button'
            size='sm'
            variant={viewMode === 'flat' ? 'secondary' : 'ghost'}
            onClick={() => {
              setViewMode('flat');
              setActivePurposeGroup(null);
            }}
          >
            Cards
          </Button>
          <Button
            type='button'
            size='sm'
            variant={viewMode === 'grouped' ? 'secondary' : 'ghost'}
            onClick={() => {
              setViewMode('grouped');
              setActivePurposeGroup(null);
            }}
          >
            Grouped
          </Button>
        </div>
        {(query || statusFilter || roleFilter || purposeFilter.length > 0) && (
          <Button
            type='button'
            variant='ghost'
            onClick={() => {
              setQuery('');
              setStatusFilter('');
              setRoleFilter('');
              setPurposeFilter([]);
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {filteredTracks.length === 0 ? (
        <EmptyState title='No tracks found' description='Create your first role-specific onboarding track.' />
      ) : (
        viewMode === 'flat' ? (
          <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
            {filteredTracks.map(renderTrackCard)}
          </div>
        ) : activePurposeGroup ? (
          <div className='space-y-4'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <div>
                <p className='text-sm font-semibold'>
                  {purposeOptions.find((o) => o.value === activePurposeGroup)?.label ?? activePurposeGroup}
                </p>
                <p className='text-xs text-muted-foreground'>Tracks in this purpose group.</p>
              </div>
              <Button type='button' variant='outline' onClick={() => setActivePurposeGroup(null)}>
                Back to groups
              </Button>
            </div>
            <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
              {filteredTracks.filter((t) => (t.purpose || '') === activePurposeGroup).map(renderTrackCard)}
            </div>
          </div>
        ) : (
          <div className='space-y-4'>
            <div className='grid gap-3 md:grid-cols-3 xl:grid-cols-4'>
              {purposeOptions
                .map((opt) => ({
                  opt,
                  count: filteredTracks.filter((t) => (t.purpose || '') === opt.value).length,
                }))
                .filter((row) => row.count > 0)
                .map(({ opt, count }) => (
                  <Card
                    key={opt.value}
                    className='cursor-pointer bg-gradient-to-b from-white/90 to-white/60 backdrop-blur'
                    onClick={() => setActivePurposeGroup(opt.value)}
                  >
                    <CardContent className='p-4'>
                      <p className='text-sm font-semibold'>{opt.label}</p>
                      <p className='mt-1 text-xs text-muted-foreground'>{count} tracks</p>
                    </CardContent>
                  </Card>
                ))}
            </div>
          </div>
        )
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

      <DialogPrimitive.Root
        open={cascadeTargetId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCascadeTargetId(null);
            setCascadePreview(null);
            setCascadeError(null);
            setCascadeConfirm('');
            setCascadeDeleting(false);
            setCascadeLoading(false);
          }
        }}
        modal
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className='fixed inset-0 bg-slate-950/40' />
          <DialogPrimitive.Content className='fixed left-1/2 top-1/2 w-[92vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-white p-6 shadow-soft'>
            <DialogPrimitive.Title className='text-base font-semibold text-destructive'>
              Delete + assignments
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className='mt-2 text-sm text-muted-foreground'>
              This will permanently delete the track <span className='font-medium'>and</span> all assignments that use it.
              This action cannot be undone.
            </DialogPrimitive.Description>

            <div className='mt-4 space-y-3'>
              {cascadeLoading ? (
                <p className='text-sm text-muted-foreground'>Loading preview…</p>
              ) : cascadePreview ? (
                <>
                  <div className='flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/10 px-3 py-2'>
                    <div className='min-w-0'>
                      <p className='truncate text-sm font-medium'>{cascadePreview.title}</p>
                      <p className='text-xs text-muted-foreground'>
                        Assignments to be deleted: <span className='font-medium'>{cascadePreview.assignment_count}</span>
                      </p>
                    </div>
                    <Button size='sm' variant='outline' asChild>
                      <Link href={`/assignments?template_id=${encodeURIComponent(cascadePreview.template_id)}`}>
                        View assignments
                      </Link>
                    </Button>
                  </div>

                  <div>
                    <p className='text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground'>
                      Preview (up to 25)
                    </p>
                    <ScrollArea className='mt-2 h-[240px] rounded-md border'>
                      <div className='divide-y'>
                        {cascadePreview.assignments.length === 0 ? (
                          <div className='p-3 text-sm text-muted-foreground'>No assignments will be deleted.</div>
                        ) : (
                          cascadePreview.assignments.map((a) => (
                            <div key={a.id} className='flex items-center justify-between gap-3 px-3 py-2 text-sm'>
                              <div className='min-w-0'>
                                <p className='truncate font-medium'>{a.title}</p>
                                <p className='mt-0.5 text-xs text-muted-foreground'>
                                  Status {a.status} • Start {a.start_date} • Target {a.target_date}
                                </p>
                              </div>
                              <Button size='sm' variant='outline' asChild>
                                <Link href={`/assignments/${a.id}`}>Open</Link>
                              </Button>
                            </div>
                          ))
                        )}
                        {cascadePreview.assignment_count > cascadePreview.assignments.length ? (
                          <div className='p-3 text-xs text-muted-foreground'>
                            And {cascadePreview.assignment_count - cascadePreview.assignments.length} more…
                          </div>
                        ) : null}
                      </div>
                    </ScrollArea>
                  </div>

                  <div className='rounded-md border bg-muted/10 p-3'>
                    <p className='text-sm font-medium'>Type to confirm</p>
                    <p className='mt-1 text-xs text-muted-foreground'>
                      Type{' '}
                      <span className='rounded bg-white px-1 py-0.5 font-mono text-[12px]'>
                        {cascadePreview.confirm_phrase}
                      </span>{' '}
                      to enable cascade delete.
                    </p>
                    <Input
                      className='mt-3'
                      value={cascadeConfirm}
                      onChange={(e) => setCascadeConfirm(e.target.value)}
                      placeholder={cascadePreview.confirm_phrase}
                    />
                  </div>

                  {cascadeError ? (
                    <div className='rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive'>
                      {cascadeError}
                    </div>
                  ) : null}
                </>
              ) : (
                <p className='text-sm text-muted-foreground'>Select a track to preview cascade delete.</p>
              )}
            </div>

            <div className='mt-5 flex justify-end gap-2'>
              <DialogPrimitive.Close asChild>
                <Button variant='outline' disabled={cascadeDeleting}>
                  Cancel
                </Button>
              </DialogPrimitive.Close>
              <Button
                variant='destructive'
                disabled={
                  cascadeDeleting ||
                  cascadeLoading ||
                  !cascadePreview ||
                  cascadeConfirm.trim() !== cascadePreview.confirm_phrase
                }
                onClick={async () => {
                  if (!accessToken || !cascadeTargetId || !cascadePreview) return;
                  setCascadeDeleting(true);
                  setCascadeError(null);
                  try {
                    await api.post(
                      `/tracks/${cascadeTargetId}/cascade-delete`,
                      { confirm_phrase: cascadeConfirm.trim() },
                      accessToken,
                    );
                    setExitingIds((prev) => (prev.includes(cascadeTargetId) ? prev : [...prev, cascadeTargetId]));
                    window.setTimeout(() => {
                      setTracks((prev) => prev.filter((t) => t.id !== cascadeTargetId));
                      setExitingIds((prev) => prev.filter((id) => id !== cascadeTargetId));
                    }, 1950);
                    setToast({
                      message: `Deleted track and ${cascadePreview.assignment_count} assignment(s).`,
                    });
                    setCascadeTargetId(null);
                    setCascadePreview(null);
                    setCascadeError(null);
                    setCascadeConfirm('');
                  } catch (err) {
                    setCascadeError(normalizeApiErrorMessage(err));
                  } finally {
                    setCascadeDeleting(false);
                  }
                }}
              >
                {cascadeDeleting ? 'Deleting…' : 'Delete track + assignments'}
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {toast ? (
        <div className='fixed right-4 top-4 z-[90] w-[min(420px,calc(100vw-2rem))]'>
          <div className='rounded-lg border bg-white/90 p-3 shadow-soft backdrop-blur'>
            <div className='flex items-start justify-between gap-3'>
              <div className='flex min-w-0 gap-2'>
                <AlertCircle className='mt-0.5 h-4 w-4 flex-none text-destructive' />
                <p className='min-w-0 whitespace-pre-wrap text-sm text-foreground'>{toast.message}</p>
              </div>
              <button
                type='button'
                className='rounded p-1 text-muted-foreground hover:bg-muted'
                onClick={() => setToast(null)}
                aria-label='Close'
              >
                <X className='h-4 w-4' />
              </button>
            </div>
            {toastActions.length > 0 ? (
              <div className='mt-3 flex flex-wrap gap-2'>
                {toastActions.map((a) =>
                  a.href ? (
                    <Button key={a.label} size='sm' variant='outline' asChild onClick={() => setToast(null)}>
                      <Link href={a.href}>{a.label}</Link>
                    </Button>
                  ) : (
                    <Button
                      key={a.label}
                      size='sm'
                      variant='outline'
                      onClick={() => {
                        a.onClick?.();
                        setToast(null);
                      }}
                    >
                      {a.label}
                    </Button>
                  ),
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
