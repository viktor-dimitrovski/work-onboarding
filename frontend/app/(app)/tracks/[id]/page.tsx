'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { BuilderShell } from '@/components/layout/builder-shell';
import { TrackBuilder, type DraftPhase, type DraftTask } from '@/components/tracks/track-builder';
import { SingleSelect } from '@/components/inputs/single-select';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTrackPurposeLabels } from '@/lib/track-purpose';
import type { TrackTemplate, TrackVersion } from '@/lib/types';
import { ArrowLeft } from 'lucide-react';

const schema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  role_target: z.string().optional(),
  estimated_duration_days: z.coerce.number().min(1).max(365),
  tags: z.string().optional(),
  purpose: z.string(),
  track_type: z.string(),
});

type FormValues = z.infer<typeof schema>;

type ValidationIssue = {
  id: string;
  phaseId: string;
  taskId?: string;
  title: string;
  description: string;
  severity: 'warning' | 'error';
};

function mapVersionToDraftPhases(version: TrackVersion): DraftPhase[] {
  return version.phases
    .slice()
    .sort((a, b) => a.order_index - b.order_index)
    .map((phase, phaseIndex) => ({
      client_id: `phase_${phase.id}`,
      title: phase.title,
      description: phase.description || '',
      order_index: phaseIndex,
      source_phase_id: phase.id,
      tasks: phase.tasks
        .slice()
        .sort((a, b) => a.order_index - b.order_index)
        .map((task, taskIndex) => ({
          client_id: `task_${task.id}`,
          title: task.title,
          task_type: task.task_type as DraftTask['task_type'],
          order_index: taskIndex,
          required: task.required,
          instructions: task.instructions || '',
          estimated_minutes: task.estimated_minutes || 30,
          passing_score: task.passing_score ?? null,
          metadata: task.metadata ?? {},
          resources: (task.resources || []).map((resource) => ({
            client_id: `res_${resource.id}`,
            resource_type: resource.resource_type,
            title: resource.title,
            url: resource.url ?? null,
            content_text: resource.content_text ?? null,
            order_index: resource.order_index,
            metadata: resource.metadata ?? {},
          })),
          due_days_offset: task.due_days_offset ?? null,
          source_task_id: task.id,
        })),
    }));
}

export default function TrackDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { accessToken } = useAuth();
  const router = useRouter();
  const { options: trackPurposeOptions, getLabel: getPurposeLabel, addPurpose } = useTrackPurposeLabels();
  const defaultPurpose = trackPurposeOptions[0]?.value ?? 'onboarding';
  const [track, setTrack] = useState<TrackTemplate | null>(null);
  const [phases, setPhases] = useState<DraftPhase[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const saveNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      description: '',
      role_target: '',
      estimated_duration_days: 30,
      tags: '',
      purpose: 'onboarding',
      track_type: 'GENERAL',
    },
  });

  const currentVersion = useMemo(() => {
    if (!track || track.versions.length === 0) return null;
    return track.versions.find((version) => version.is_current) || track.versions[0];
  }, [track]);

  useEffect(() => {
    const run = async () => {
      if (!accessToken || !id) return;
      setLoading(true);
      try {
        const response = await api.get<TrackTemplate>(`/tracks/${id}`, accessToken);
        setTrack(response);
        const version = response.versions.find((item) => item.is_current) || response.versions[0];
        if (version) {
          setPhases(mapVersionToDraftPhases(version));
        }
        const purpose =
          trackPurposeOptions.some((o) => o.value === response.purpose) ? response.purpose : defaultPurpose;
        form.reset({
          title: response.title,
          description: response.description || '',
          role_target: response.role_target || '',
          estimated_duration_days: response.estimated_duration_days,
          tags: response.tags.join(', '),
          purpose,
          track_type: response.track_type || version?.track_type || 'GENERAL',
        });
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [accessToken, id, form, trackPurposeOptions, defaultPurpose]);

  useEffect(() => {
    return () => {
      if (saveNoticeTimer.current) {
        clearTimeout(saveNoticeTimer.current);
      }
    };
  }, []);

  const flashSaveNotice = (kind: 'success' | 'error', message: string) => {
    setSaveNotice({ kind, message });
    if (saveNoticeTimer.current) {
      clearTimeout(saveNoticeTimer.current);
    }
    saveNoticeTimer.current = setTimeout(() => setSaveNotice(null), 4000);
  };

  const canSubmit = useMemo(
    () => phases.length > 0 && phases.every((phase) => phase.title && phase.tasks.length > 0),
    [phases],
  );

  const estimatedDays = form.watch('estimated_duration_days');
  const selectedPurpose = form.watch('purpose');
  const selectedPurposeLabel = getPurposeLabel(selectedPurpose);

  const trackTypeOptions = useMemo(
    () => [
      { value: 'GENERAL', label: 'General' },
      { value: 'RELEASE', label: 'Release template' },
      { value: 'TENANT_CREATION', label: 'Tenant creation' },
      { value: 'WORK_ORDER', label: 'Work order' },
    ],
    [],
  );

  const summary = useMemo(() => {
    const totalPhases = phases.length;
    const allTasks = phases.flatMap((phase) => phase.tasks || []);
    const totalTasks = allTasks.length;
    const requiredTasks = allTasks.filter((task) => task.required).length;
    const totalMinutes = allTasks.reduce((sum, task) => sum + (task.estimated_minutes || 0), 0);
    const quizCount = allTasks.filter((task) => task.task_type === 'quiz').length;
    const mentorApprovalCount = allTasks.filter((task) => task.task_type === 'mentor_approval').length;
    const days = estimatedDays || 1;
    const capacityMinutes = Math.max(1, days) * 6 * 60;
    return {
      totalPhases,
      totalTasks,
      requiredTasks,
      totalMinutes,
      quizCount,
      mentorApprovalCount,
      days,
      capacityMinutes,
    };
  }, [estimatedDays, phases]);

  const validationIssues = useMemo<ValidationIssue[]>(() => {
    const issues: ValidationIssue[] = [];
    phases.forEach((phase) => {
      if (!phase.title.trim()) {
        issues.push({
          id: `phase-title-${phase.client_id}`,
          phaseId: phase.client_id,
          title: 'Phase missing title',
          description: 'Add a title so the phase is discoverable.',
          severity: 'warning',
        });
      }

      phase.tasks.forEach((task) => {
        if (!task.title.trim()) {
          issues.push({
            id: `task-title-${task.client_id}`,
            phaseId: phase.client_id,
            taskId: task.client_id,
            title: 'Task missing title',
            description: 'Add a concise task title.',
            severity: 'error',
          });
        }

        if (!task.instructions.trim()) {
          issues.push({
            id: `task-instructions-${task.client_id}`,
            phaseId: phase.client_id,
            taskId: task.client_id,
            title: 'Task missing instructions',
            description: 'Add clear instructions so the assignee knows what to do.',
            severity: 'warning',
          });
        }

        const resourceUrl = task.resources?.[0]?.url?.trim();
        if (['read_material', 'video', 'external_link'].includes(task.task_type) && !resourceUrl) {
          issues.push({
            id: `task-resource-${task.client_id}`,
            phaseId: phase.client_id,
            taskId: task.client_id,
            title: 'Missing resource URL',
            description: 'Provide a resource URL for this task.',
            severity: 'warning',
          });
        }
      });
    });
    return issues;
  }, [phases]);

  const onSubmit = form.handleSubmit(async (values) => {
    if (!accessToken || !id) return;
    setSaving(true);
    setError(null);
    setSaveNotice(null);

    const payload = {
      title: values.title,
      description: values.description || null,
      role_target: values.role_target || null,
      estimated_duration_days: values.estimated_duration_days,
      tags: values.tags?.split(',').map((tag) => tag.trim()).filter(Boolean) ?? [],
      purpose: values.purpose,
      track_type: values.track_type,
      apply_to_assignments: false,
      phases: phases.map((phase, phaseIndex) => ({
        title: phase.title,
        description: phase.description || null,
        order_index: phaseIndex,
        source_phase_id: phase.source_phase_id ?? null,
        tasks: phase.tasks.map((task, taskIndex) => ({
          title: task.title,
          description: null,
          instructions: task.instructions,
          task_type: task.task_type,
          required: task.required,
          order_index: taskIndex,
          estimated_minutes: task.estimated_minutes,
          passing_score: task.passing_score ?? null,
          metadata: task.metadata ?? {},
          due_days_offset: task.due_days_offset ?? taskIndex + phaseIndex,
          resources: (task.resources ?? []).map((resource, resourceIndex) => ({
            resource_type: resource.resource_type,
            title: resource.title,
            content_text: resource.content_text ?? null,
            url: resource.url ?? null,
            order_index: resource.order_index ?? resourceIndex,
            metadata: resource.metadata ?? {},
          })),
          source_task_id: task.source_task_id ?? null,
        })),
      })),
    };

    try {
      const updated = await api.put<TrackTemplate>(`/tracks/${id}`, payload, accessToken);
      setTrack(updated);
      flashSaveNotice('success', 'Changes saved.');
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Failed to update track';
      setError(message);
      flashSaveNotice('error', message);
    } finally {
      setSaving(false);
    }
  });

  const deactivateTrack = async () => {
    if (!accessToken || !id) return;
    setSaving(true);
    try {
      await api.post(`/tracks/${id}/deactivate`, {}, accessToken);
      router.push('/tracks');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deactivate track');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState label='Loading track template...' />;
  if (!track || !currentVersion) {
    return <EmptyState title='Track not found' description='The requested track does not exist.' />;
  }

  return (
    <div className='space-y-6'>
      {saveNotice && (
        <div className='fixed right-6 top-20 z-50 w-[360px] max-w-[calc(100vw-3rem)]'>
          <Alert
            variant={saveNotice.kind === 'error' ? 'destructive' : 'default'}
            className={saveNotice.kind === 'success' ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900' : ''}
          >
            <AlertTitle>{saveNotice.kind === 'error' ? 'Save failed' : 'Saved'}</AlertTitle>
            <AlertDescription className={saveNotice.kind === 'success' ? 'text-emerald-800/80' : ''}>
              {saveNotice.message}
            </AlertDescription>
          </Alert>
        </div>
      )}
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex items-start gap-3'>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            aria-label='Back to tracks'
            onClick={() => router.push('/tracks')}
            className='mt-1'
          >
            <ArrowLeft className='h-4 w-4' />
          </Button>
          <div>
            <h2 className='text-2xl font-semibold'>Edit track</h2>
            <p className='text-sm text-muted-foreground'>
              Saving creates a new draft version. Publish it from the publish screen when ready.
            </p>
          </div>
        </div>
        <ConfirmDialog
          title='Deactivate track?'
          description='This hides the track from new assignments. Existing assignments remain.'
          confirmText='Deactivate'
          onConfirm={deactivateTrack}
          trigger={
            <Button variant='outline' disabled={saving}>
              Deactivate
            </Button>
          }
        />
      </div>

      <form onSubmit={onSubmit}>
        <div className='space-y-6 pb-28'>
          <BuilderShell
            workspaceLabel='Workspace'
            main={
              <div className='space-y-6'>
                <div className='rounded-xl border bg-white px-4 py-3'>
                  <div className='flex flex-wrap items-start justify-between gap-3'>
                    <div className='min-w-0'>
                      <p className='truncate text-sm font-semibold'>{form.watch('title') || 'Untitled track'}</p>
                      <div className='mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
                        <span>{selectedPurposeLabel}</span>
                        <span>•</span>
                        <span>{form.watch('role_target') || 'role: —'}</span>
                        <span>•</span>
                        <span>{estimatedDays || 1} days</span>
                        {form.watch('tags') ? (
                          <>
                            <span>•</span>
                            <span className='truncate'>{form.watch('tags')}</span>
                          </>
                        ) : null}
                      </div>
                      {form.formState.errors.title && (
                        <p className='mt-1 text-xs text-destructive'>{form.formState.errors.title.message}</p>
                      )}
                    </div>
                    <div className='flex items-center gap-2'>
                      <Button type='button' variant='outline' onClick={() => setDetailsOpen(true)}>
                        Edit track details
                      </Button>
                    </div>
                  </div>
                </div>

                {error && <p className='text-sm text-destructive'>{error}</p>}

                <Card>
                  <CardHeader>
                    <CardTitle>Builder</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <TrackBuilder
                      phases={phases}
                      setPhases={setPhases}
                      estimatedDurationDays={form.watch('estimated_duration_days')}
                      selectedTaskId={selectedTaskId}
                      onSelectTask={setSelectedTaskId}
                      selectedPhaseId={selectedPhaseId}
                    />
                  </CardContent>
                </Card>

                <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
                  <SheetContent side='right' className='flex h-full flex-col'>
                    <SheetHeader>
                      <SheetTitle>Track details</SheetTitle>
                      <p className='text-xs text-muted-foreground'>
                        Keep this out of the way while authoring phases and tasks.
                      </p>
                    </SheetHeader>

                    <div className='mt-4 flex-1 overflow-auto pr-1'>
                      <div className='rounded-xl border bg-muted/10 p-4'>
                        <p className='text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground'>
                          Basics
                        </p>
                        <div className='mt-3 grid gap-4 md:grid-cols-2'>
                        <div className='space-y-2'>
                          <Label htmlFor='title'>Title</Label>
                          <Input id='title' {...form.register('title')} />
                          {form.formState.errors.title && (
                            <p className='text-xs text-destructive'>{form.formState.errors.title.message}</p>
                          )}
                        </div>

                        <div className='space-y-2'>
                          <Label htmlFor='role_target'>Role target</Label>
                          <Input id='role_target' {...form.register('role_target')} />
                        </div>

                        <div className='space-y-2 md:col-span-2'>
                          <Label htmlFor='description'>Description</Label>
                          <Textarea id='description' rows={3} {...form.register('description')} />
                        </div>

                        <div className='space-y-2'>
                          <Label htmlFor='estimated_duration_days'>Estimated duration (days)</Label>
                          <Input
                            id='estimated_duration_days'
                            type='number'
                            {...form.register('estimated_duration_days')}
                          />
                        </div>

                        <div className='space-y-2'>
                          <Label htmlFor='tags'>Tags (comma separated)</Label>
                          <Input id='tags' placeholder='devops, platform, security' {...form.register('tags')} />
                        </div>

                        <div className='space-y-2'>
                          <Label htmlFor='purpose'>Track purpose</Label>
                          <SingleSelect
                            value={form.watch('purpose')}
                            onChange={(next) => form.setValue('purpose', next, { shouldDirty: true })}
                            options={trackPurposeOptions}
                            placeholder='Select purpose…'
                            creatable={{
                              enabled: true,
                              placeholder: 'Add new purpose…',
                              actionLabel: 'Add',
                              onCreate: async (label) => {
                                const createdValue = addPurpose(label);
                                form.setValue('purpose', createdValue, { shouldDirty: true });
                              },
                            }}
                          />
                        </div>

                        <div className='space-y-2'>
                          <Label htmlFor='track_type'>Track type</Label>
                          <SingleSelect
                            value={form.watch('track_type')}
                            onChange={(next) => form.setValue('track_type', next, { shouldDirty: true })}
                            options={trackTypeOptions}
                            placeholder='Select type…'
                          />
                          <p className='text-xs text-muted-foreground'>
                            Use <span className='font-medium'>RELEASE</span> to make templates appear in Release Center.
                          </p>
                        </div>
                      </div>
                      </div>
                    </div>
                    <div className='mt-4 flex items-center justify-end border-t bg-white/80 px-2 py-3'>
                      <Button type='button' variant='outline' onClick={() => setDetailsOpen(false)}>
                        Done
                      </Button>
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
            }
            workspace={
              <Tabs defaultValue='summary' className='w-full'>
                <Card>
                  <CardHeader className='space-y-3'>
                    <CardTitle className='text-base'>Workspace</CardTitle>
                    <TabsList className='grid w-full grid-cols-4'>
                      <TabsTrigger value='summary'>Summary</TabsTrigger>
                      <TabsTrigger value='ai'>AI</TabsTrigger>
                      <TabsTrigger value='validation'>Validation</TabsTrigger>
                      <TabsTrigger value='outline'>Outline</TabsTrigger>
                    </TabsList>
                  </CardHeader>
                  <CardContent>
                    <TabsContent value='summary'>
                      <ScrollArea className='h-[calc(100vh-360px)] pr-3'>
                        <div className='rounded-xl border bg-background/60 p-4'>
                          <div className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
                            {[
                              {
                                label: 'Phases',
                                value: summary.totalPhases,
                                className: 'border-l-4 border-l-blue-200 bg-blue-50/60',
                              },
                              {
                                label: 'Tasks',
                                value: summary.totalTasks,
                                className: 'border-l-4 border-l-emerald-200 bg-emerald-50/60',
                              },
                              {
                                label: 'Required',
                                value: summary.requiredTasks,
                                className: 'border-l-4 border-l-amber-200 bg-amber-50/60',
                              },
                              {
                                label: 'Total minutes',
                                value: summary.totalMinutes,
                                className: 'border-l-4 border-l-slate-200 bg-slate-50/60',
                              },
                              {
                                label: 'Quizzes',
                                value: summary.quizCount,
                                className: 'border-l-4 border-l-violet-200 bg-violet-50/60',
                              },
                              {
                                label: 'Mentor approvals',
                                value: summary.mentorApprovalCount,
                                className: 'border-l-4 border-l-teal-200 bg-teal-50/60',
                              },
                            ].map((metric) => (
                              <div
                                key={metric.label}
                                className={`flex items-center justify-between rounded-lg border px-3 py-2 ${metric.className}`}
                              >
                                <span className='text-xs text-muted-foreground leading-none'>{metric.label}</span>
                                <span
                                  className={`text-base font-semibold tabular-nums leading-none ${
                                    metric.value === 0 ? 'text-muted-foreground' : 'text-foreground'
                                  }`}
                                >
                                  {metric.value}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className='mt-3 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground'>
                          <p>
                            Capacity: {summary.capacityMinutes} min ({summary.days} days × 6h)
                          </p>
                          {summary.totalMinutes > summary.capacityMinutes && (
                            <p className='mt-1 text-destructive'>Track is longer than estimated capacity.</p>
                          )}
                        </div>
                      </ScrollArea>
                    </TabsContent>

                    <TabsContent value='ai'>
                      <ScrollArea className='h-[calc(100vh-360px)] pr-3'>
                        <div className='rounded-md border bg-muted/30 p-4'>
                          <p className='text-sm font-medium'>AI assistant</p>
                          <p className='mt-1 text-xs text-muted-foreground'>
                            Generate draft phases and tasks from onboarding notes, then merge them into your track.
                          </p>
                          <Button
                            size='sm'
                            variant='outline'
                            className='mt-3'
                            onClick={() => router.push('/tracks/new')}
                          >
                            Open AI draft
                          </Button>
                        </div>
                      </ScrollArea>
                    </TabsContent>

                    <TabsContent value='validation'>
                      <ScrollArea className='h-[calc(100vh-360px)] pr-3'>
                        <div className='space-y-3'>
                          {validationIssues.length === 0 ? (
                            <div className='rounded-md bg-slate-50 p-3 text-xs text-muted-foreground'>
                              No validation issues detected.
                            </div>
                          ) : (
                            validationIssues.map((issue) => (
                              <button
                                key={issue.id}
                                type='button'
                                className='w-full rounded-md border bg-white p-3 text-left text-sm transition hover:border-primary/40'
                                onClick={() => {
                                  setSelectedPhaseId(issue.phaseId);
                                  if (issue.taskId) {
                                    setSelectedTaskId(issue.taskId);
                                  }
                                }}
                              >
                                <div className='flex items-start justify-between gap-2'>
                                  <div>
                                    <p className='font-medium'>{issue.title}</p>
                                    <p className='text-xs text-muted-foreground'>{issue.description}</p>
                                  </div>
                                  <Badge variant='outline'>{issue.severity}</Badge>
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      </ScrollArea>
                    </TabsContent>

                    <TabsContent value='outline'>
                      <ScrollArea className='h-[calc(100vh-360px)] pr-3'>
                        <div className='space-y-3'>
                          {phases.map((phase) => (
                            <div key={phase.client_id} className='rounded-md border bg-white p-3'>
                              <button
                                type='button'
                                className='w-full text-left'
                                onClick={() => {
                                  setSelectedPhaseId(phase.client_id);
                                  setSelectedTaskId(null);
                                }}
                              >
                                <p className='text-sm font-semibold'>{phase.title || 'Untitled phase'}</p>
                                <p className='text-xs text-muted-foreground'>{phase.tasks.length} tasks</p>
                              </button>
                              <div className='mt-2 space-y-1'>
                                {phase.tasks.map((task) => (
                                  <button
                                    key={task.client_id}
                                    type='button'
                                    className='flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted/40'
                                    onClick={() => {
                                      setSelectedPhaseId(phase.client_id);
                                      setSelectedTaskId(task.client_id);
                                    }}
                                  >
                                    <span className='truncate'>{task.title || 'Untitled task'}</span>
                                    <span>{task.task_type}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </TabsContent>
                  </CardContent>
                </Card>
              </Tabs>
            }
          />
        </div>

        <div className='fixed bottom-0 left-0 right-0 z-20 border-t bg-white/95 backdrop-blur'>
          <div className='flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3'>
            <p className='text-xs text-muted-foreground'>
              {saving ? 'Saving changes...' : 'Saving creates a new draft version.'}
            </p>
            <div className='flex gap-2'>
              <Button type='submit' disabled={saving || !canSubmit}>
                {saving ? 'Saving changes...' : 'Save changes'}
              </Button>
              <Button type='button' variant='outline' onClick={() => router.push('/tracks')}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
