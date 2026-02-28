'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { BuilderShell } from '@/components/layout/builder-shell';
import { TrackBuilder, type DraftPhase, type DraftTask } from '@/components/tracks/track-builder';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTrackPurposeLabels } from '@/lib/track-purpose';

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

type AiApplyMode = 'replace' | 'append_phases' | 'append_tasks';

function wrapTaskForBuilder(task: DraftTask, phaseIndex: number, taskIndex: number): DraftTask {
  return {
    ...task,
    client_id: task.client_id || `task_${phaseIndex}_${taskIndex}_${Math.random().toString(36).slice(2, 8)}`,
    order_index: taskIndex,
    required: typeof task.required === 'boolean' ? task.required : true,
    estimated_minutes: task.estimated_minutes || 30,
    metadata: task.metadata ?? {},
    resources: task.resources ?? [],
  };
}

function wrapPhaseForBuilder(phase: DraftPhase, index: number): DraftPhase {
  return {
    ...phase,
    client_id: phase.client_id || `phase_${index}_${Math.random().toString(36).slice(2, 8)}`,
    order_index: index,
    tasks: (phase.tasks || []).map((task, taskIndex) => wrapTaskForBuilder(task, index, taskIndex)),
  };
}

export default function NewTrackPage() {
  const { accessToken } = useAuth();
  const router = useRouter();
  const { options: trackPurposeOptions, getLabel: getPurposeLabel } = useTrackPurposeLabels();
  const defaultPurpose = trackPurposeOptions[0]?.value ?? 'onboarding';
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [aiNotes, setAiNotes] = useState(
    'We need a 30-day onboarding for a backend engineer working on payments.\n- Week 1: orientation, security, dev env\n- Week 2: API standards, logging/monitoring\n- Week 3: hands-on small feature with mentor approval\n- Week 4: performance tuning & deployment checklist\nInclude one quiz, one code assignment, and mentor approval before production access.',
  );
  const [aiPhases, setAiPhases] = useState<DraftPhase[] | null>(null);
  const [aiSelected, setAiSelected] = useState<Record<number, boolean>>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiApplyMode, setAiApplyMode] = useState<AiApplyMode>('replace');
  const [aiTargetPhaseId, setAiTargetPhaseId] = useState<string | null>(null);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);

  const [phases, setPhases] = useState<DraftPhase[]>([
    wrapPhaseForBuilder(
      {
        client_id: 'phase_seed',
        title: 'Phase 1: Orientation',
        description: 'Initial context and setup',
        order_index: 0,
        tasks: [
          {
            client_id: 'task_seed',
            title: 'Read internal SSDLC policy',
            task_type: 'read_material',
            order_index: 0,
            required: true,
            instructions: 'Read and acknowledge the policy document.',
            estimated_minutes: 20,
            metadata: {},
            resources: [],
          } as DraftTask,
        ],
      } as DraftPhase,
      0,
    ),
  ]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: 'DevOps Engineer Onboarding',
      description: 'Structured onboarding track for platform and infrastructure responsibilities.',
      role_target: 'devops',
      estimated_duration_days: 45,
      tags: 'devops,platform,security',
      purpose: defaultPurpose,
      track_type: 'GENERAL',
    },
  });

  const estimatedDays = form.watch('estimated_duration_days');

  useEffect(() => {
    if (!aiTargetPhaseId && phases[0]) {
      setAiTargetPhaseId(phases[0].client_id);
      return;
    }
    if (aiTargetPhaseId && !phases.some((phase) => phase.client_id === aiTargetPhaseId)) {
      setAiTargetPhaseId(phases[0]?.client_id ?? null);
    }
  }, [aiTargetPhaseId, phases]);

  const canSubmit = useMemo(
    () => phases.length > 0 && phases.every((phase) => phase.title && phase.tasks.length > 0),
    [phases],
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

        if (task.task_type === 'quiz') {
          const questions = (task.metadata?.quiz as Record<string, unknown> | undefined)?.questions as
            | unknown[]
            | undefined;
          if (!questions || questions.length === 0) {
            issues.push({
              id: `task-quiz-${task.client_id}`,
              phaseId: phase.client_id,
              taskId: task.client_id,
              title: 'Quiz missing questions',
              description: 'Add at least one question with correct answers.',
              severity: 'error',
            });
          }
        }
      });
    });
    return issues;
  }, [phases]);

  const selectedAiPhases = useMemo(() => {
    if (!aiPhases) return [];
    const selected = aiPhases.filter((_, index) => aiSelected[index]);
    return selected.length > 0 ? selected : aiPhases;
  }, [aiPhases, aiSelected]);

  const aiApplyCounts = useMemo(() => {
    const taskCount = selectedAiPhases.reduce((sum, phase) => sum + (phase.tasks?.length || 0), 0);
    return { phaseCount: selectedAiPhases.length, taskCount };
  }, [selectedAiPhases]);

  const applyAiPhases = (draft: DraftPhase[]) => {
    const cleaned = draft.map((phase, phaseIndex) =>
      wrapPhaseForBuilder(
        {
          ...phase,
          title: phase.title || `Phase ${phaseIndex + 1}`,
          description: phase.description || '',
          order_index: phaseIndex,
          tasks: (phase.tasks || []).map((task, taskIndex) => ({
            ...task,
            title: task.title || `Task ${phaseIndex + 1}.${taskIndex + 1}`,
            task_type: (task.task_type as DraftTask['task_type']) || 'checklist',
            order_index: taskIndex,
            required: typeof task.required === 'boolean' ? task.required : true,
            instructions: task.instructions || '',
            estimated_minutes: task.estimated_minutes || 30,
            metadata: task.metadata ?? {},
            resources: task.resources ?? [],
          })),
        } as DraftPhase,
        phaseIndex,
      ),
    );
    setPhases(cleaned);
  };

  const applySelectedAiPhases = () => {
    if (!selectedAiPhases.length) return;
    if (aiApplyMode === 'replace') {
      applyAiPhases(selectedAiPhases);
      return;
    }

    if (aiApplyMode === 'append_phases') {
      const startIndex = phases.length;
      const appended = selectedAiPhases.map((phase, index) => wrapPhaseForBuilder(phase, startIndex + index));
      setPhases([...phases, ...appended]);
      return;
    }

    if (aiApplyMode === 'append_tasks') {
      const targetPhaseId = aiTargetPhaseId ?? phases[0]?.client_id;
      if (!targetPhaseId) return;
      const targetIndex = phases.findIndex((phase) => phase.client_id === targetPhaseId);
      if (targetIndex < 0) return;
      const incomingTasks = selectedAiPhases.flatMap((phase) => phase.tasks || []);
      const startIndex = phases[targetIndex].tasks.length;
      const wrappedTasks = incomingTasks.map((task, idx) =>
        wrapTaskForBuilder(task, targetIndex, startIndex + idx),
      );
      const next = [...phases];
      next[targetIndex] = {
        ...next[targetIndex],
        tasks: [...next[targetIndex].tasks, ...wrappedTasks],
      };
      setPhases(next);
      setSelectedPhaseId(targetPhaseId);
    }
  };

  const draftWithAI = async () => {
    if (!aiNotes || aiNotes.trim().length < 10) {
      setAiError('Please add more context before drafting.');
      return;
    }
    setAiLoading(true);
    setAiError(null);
    try {
      const response = await fetch('/api/ai/draft-track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: aiNotes,
          meta: {
            title: form.getValues('title'),
            role_target: form.getValues('role_target'),
            tags: form.getValues('tags'),
            purpose: form.getValues('purpose'),
            estimated_duration_days: form.getValues('estimated_duration_days'),
          },
        }),
      });
      const raw = await response.text();
      let data: any = null;
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          data = null;
        }
      }

      if (!data) {
        if (!response.ok) {
          throw new Error(raw || 'Failed to draft with AI');
        }
        throw new Error('Invalid JSON response from server.');
      }

      if (!response.ok) {
        const pieces = [
          data?.error || 'Failed to draft with AI',
          data?.hint ? `Hint: ${data.hint}` : null,
          data?.request_id ? `Request ID: ${data.request_id}` : null,
        ].filter(Boolean);
        throw new Error(pieces.join('\n'));
      }
      if (!Array.isArray(data.phases)) {
        throw new Error('AI response missing phases.');
      }
      setAiPhases(data.phases || []);
      setAiSelected({});
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI draft failed');
    } finally {
      setAiLoading(false);
    }
  };

  const onSubmit = form.handleSubmit(async (values) => {
    if (!accessToken || !canSubmit) {
      return;
    }

    setSaving(true);
    setError(null);

    const payload = {
      ...values,
      tags: values.tags?.split(',').map((tag) => tag.trim()).filter(Boolean) ?? [],
      purpose: values.purpose,
      track_type: values.track_type,
      phases: phases.map((phase, phaseIndex) => ({
        title: phase.title,
        description: phase.description,
        order_index: phaseIndex,
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
        })),
      })),
    };

    try {
      const created = await api.post<{ id: string }>('/tracks', payload, accessToken);
      router.replace(`/tracks/${created.id}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to create track');
    } finally {
      setSaving(false);
    }
  });

  const applyDescription =
    aiApplyMode === 'replace'
      ? `Replace current builder content with ${aiApplyCounts.phaseCount} phases and ${aiApplyCounts.taskCount} tasks.`
      : aiApplyMode === 'append_phases'
        ? `Append ${aiApplyCounts.phaseCount} phases and ${aiApplyCounts.taskCount} tasks to the existing builder.`
        : `Append ${aiApplyCounts.taskCount} tasks to the selected phase without removing existing tasks.`;
  const selectedPurpose = form.watch('purpose');
  const selectedPurposeLabel = getPurposeLabel(selectedPurpose);

  return (
    <div className='min-h-screen bg-slate-50'>
      <form onSubmit={onSubmit}>
        <div className='sticky top-0 z-20 border-b bg-white/95 backdrop-blur'>
          <div className='flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3'>
            <div>
              <div className='flex flex-wrap items-center gap-2'>
                <h2 className='text-xl font-semibold'>Create track template</h2>
                <Badge variant='secondary'>{selectedPurposeLabel}</Badge>
              </div>
              <p className='text-xs text-muted-foreground'>
                Build the track and apply AI suggestions only when you’re ready.
              </p>
            </div>
            <div className='flex items-center gap-2'>
              {validationIssues.length > 0 && (
                <Badge variant='outline'>{validationIssues.length} issues</Badge>
              )}
              {aiPhases && aiPhases.length > 0 && <Badge variant='outline'>AI draft ready</Badge>}
              <Button type='submit' disabled={saving || !canSubmit}>
                {saving ? 'Saving track...' : 'Create track'}
              </Button>
              <Button type='button' variant='outline' onClick={() => router.push('/tracks')}>
                Cancel
              </Button>
            </div>
          </div>
        </div>

        <div className='w-full space-y-6 px-6 py-6 pb-28'>
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

                {error && (
                  <Alert variant='destructive'>
                    <AlertTitle>Could not create track</AlertTitle>
                    <AlertDescription className='text-destructive/90'>{error}</AlertDescription>
                  </Alert>
                )}

                <Card>
                  <CardHeader>
                    <div className='flex flex-wrap items-start justify-between gap-3'>
                      <div>
                        <CardTitle>Builder</CardTitle>
                        <p className='text-sm text-muted-foreground'>
                          Build phases and tasks. Use the drawer to edit instructions and advanced fields.
                        </p>
                      </div>
                      <div className='text-right text-xs text-muted-foreground'>
                        <p>
                          Capacity: {summary.capacityMinutes} min ({summary.days} days × 6h)
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <TrackBuilder
                      phases={phases}
                      setPhases={setPhases}
                      estimatedDurationDays={estimatedDays}
                      selectedTaskId={selectedTaskId}
                      onSelectTask={setSelectedTaskId}
                      selectedPhaseId={selectedPhaseId}
                    />
                  </CardContent>
                </Card>
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
                        <div className='space-y-4'>
                          <div className='flex items-center justify-between'>
                            <div>
                              <p className='text-sm font-medium'>AI assistant</p>
                              <p className='text-xs text-muted-foreground'>Optional helper for quick drafts.</p>
                            </div>
                            <Badge variant='outline'>Optional</Badge>
                          </div>

                          <div className='space-y-2'>
                            <Label>Notes</Label>
                            <Textarea
                              rows={7}
                              value={aiNotes}
                              onChange={(event) => setAiNotes(event.target.value)}
                              placeholder='Paste bullets or free text. Mention role, phases, approvals, quizzes, deliverables.'
                            />
                          </div>

                          <div className='space-y-2'>
                            <Label>Apply mode</Label>
                            <select
                              className='h-10 w-full rounded-md border border-input bg-white px-3 text-sm'
                              value={aiApplyMode}
                              onChange={(event) => setAiApplyMode(event.target.value as AiApplyMode)}
                            >
                              <option value='replace'>Replace builder</option>
                              <option value='append_phases'>Append phases</option>
                              <option value='append_tasks'>Append tasks to phase</option>
                            </select>
                            {aiApplyMode === 'append_tasks' && (
                              <select
                                className='mt-2 h-10 w-full rounded-md border border-input bg-white px-3 text-sm'
                                value={aiTargetPhaseId ?? ''}
                                onChange={(event) => setAiTargetPhaseId(event.target.value)}
                              >
                                {phases.map((phase) => (
                                  <option key={phase.client_id} value={phase.client_id}>
                                    {phase.title || 'Untitled phase'}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>

                          <div className='flex flex-wrap gap-2'>
                            <Button type='button' variant='secondary' onClick={draftWithAI} disabled={aiLoading}>
                              {aiLoading ? 'Drafting…' : 'Draft with AI'}
                            </Button>
                            {aiPhases && aiPhases.length > 0 && (
                              <>
                                <ConfirmDialog
                                  title='Apply AI draft?'
                                  description={applyDescription}
                                  confirmText='Apply'
                                  onConfirm={applySelectedAiPhases}
                                  trigger={
                                    <Button type='button'>
                                      Apply selected
                                    </Button>
                                  }
                                />
                                <Button type='button' variant='outline' onClick={draftWithAI}>
                                  Regenerate
                                </Button>
                              </>
                            )}
                          </div>

                          {aiError && (
                            <Alert variant='destructive'>
                              <AlertTitle>AI draft failed</AlertTitle>
                              <AlertDescription className='whitespace-pre-wrap text-destructive/90'>
                                {aiError}
                              </AlertDescription>
                            </Alert>
                          )}

                          <div className='rounded-md border bg-white'>
                            <div className='border-b px-3 py-2'>
                              <p className='text-sm font-semibold'>AI preview</p>
                              <p className='text-xs text-muted-foreground'>Select phases to apply (or apply all).</p>
                            </div>
                            <div className='p-3'>
                              {aiPhases && aiPhases.length > 0 ? (
                                <div className='space-y-3'>
                                  {aiPhases.map((phase, idx) => {
                                    const totalMinutes =
                                      phase.tasks?.reduce((sum, task) => sum + (task.estimated_minutes || 0), 0) || 0;
                                    const requiredCount = phase.tasks?.filter((task) => task.required).length || 0;
                                    return (
                                      <div key={idx} className='rounded-md border bg-slate-50 p-3'>
                                        <label className='flex items-start gap-2'>
                                          <input
                                            type='checkbox'
                                            checked={Boolean(aiSelected[idx])}
                                            onChange={(event) =>
                                              setAiSelected((prev) => ({ ...prev, [idx]: event.target.checked }))
                                            }
                                          />
                                          <div>
                                            <p className='text-sm font-semibold'>{phase.title}</p>
                                            {phase.description && (
                                              <p className='text-xs text-muted-foreground'>{phase.description}</p>
                                            )}
                                            <p className='text-xs text-muted-foreground'>
                                              {phase.tasks?.length || 0} tasks • {requiredCount} required • {totalMinutes}{' '}
                                              min
                                            </p>
                                          </div>
                                        </label>
                                        <ul className='mt-2 space-y-1 text-xs text-muted-foreground'>
                                          {phase.tasks?.slice(0, 6).map((task, tIdx) => (
                                            <li key={tIdx} className='flex flex-wrap items-center justify-between gap-2'>
                                              <span className='font-medium text-foreground/90'>{task.title}</span>
                                              <span>
                                                {task.task_type} • {task.required ? 'required' : 'optional'} •{' '}
                                                {task.estimated_minutes || 0}m
                                              </span>
                                            </li>
                                          ))}
                                          {(phase.tasks?.length || 0) > 6 && (
                                            <li className='text-xs text-muted-foreground'>
                                              + {(phase.tasks?.length || 0) - 6} more tasks…
                                            </li>
                                          )}
                                        </ul>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className='rounded-md bg-slate-50 p-3 text-xs text-muted-foreground'>
                                  Draft a proposal to preview phases and tasks. You can apply only the phases you want.
                                </div>
                              )}
                            </div>
                          </div>
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

        <div className='fixed bottom-0 left-0 right-0 border-t bg-white/95 backdrop-blur'>
          <div className='flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3'>
            <p className='text-xs text-muted-foreground'>All changes are local until you create the track.</p>
            <div className='flex gap-2'>
              <Button type='submit' disabled={saving || !canSubmit}>
                {saving ? 'Saving track...' : 'Create track'}
              </Button>
              <Button type='button' variant='outline' onClick={() => router.push('/tracks')}>
                Cancel
              </Button>
            </div>
          </div>
        </div>

        <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
          <SheetContent side='right' className='flex h-full flex-col'>
            <SheetHeader>
              <SheetTitle>Track details</SheetTitle>
              <p className='text-xs text-muted-foreground'>
                Keep this out of the way while authoring phases and tasks.
              </p>
            </SheetHeader>

            <div className='mt-4 flex-1 overflow-auto pr-1'>
              <div className='grid gap-4 md:grid-cols-2'>
                <div className='space-y-2'>
                  <Label htmlFor='title'>Title</Label>
                  <Input id='title' {...form.register('title')} />
                  {form.formState.errors.title && (
                    <p className='text-xs text-destructive'>{form.formState.errors.title.message}</p>
                  )}
                </div>

                <div className='space-y-2'>
                  <Label htmlFor='role_target'>Role target</Label>
                  <Input id='role_target' {...form.register('role_target')} placeholder='devops, backend, qa...' />
                </div>

                <div className='space-y-2 md:col-span-2'>
                  <Label htmlFor='description'>Description</Label>
                  <Textarea id='description' rows={3} {...form.register('description')} />
                </div>

                <div className='space-y-2'>
                  <Label htmlFor='estimated_duration_days'>Estimated duration (days)</Label>
                  <Input id='estimated_duration_days' type='number' {...form.register('estimated_duration_days')} />
                </div>

                <div className='space-y-2'>
                  <Label htmlFor='tags'>Tags (comma separated)</Label>
                  <Input id='tags' placeholder='devops, platform, security' {...form.register('tags')} />
                </div>

                <div className='space-y-2'>
                  <Label htmlFor='purpose'>Track purpose</Label>
                  <select
                    id='purpose'
                    className='h-10 rounded-md border border-input bg-white px-3 text-sm'
                    {...form.register('purpose')}
                  >
                    {trackPurposeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className='space-y-2'>
                  <Label htmlFor='track_type'>Track type</Label>
                  <select
                    id='track_type'
                    className='h-10 rounded-md border border-input bg-white px-3 text-sm'
                    {...form.register('track_type')}
                  >
                    <option value='GENERAL'>GENERAL</option>
                    <option value='RELEASE'>RELEASE</option>
                    <option value='TENANT_CREATION'>TENANT_CREATION</option>
                    <option value='WORK_ORDER'>WORK_ORDER</option>
                  </select>
                  <p className='text-xs text-muted-foreground'>
                    Use <span className='font-medium'>RELEASE</span> to make templates appear in Release Center.
                  </p>
                </div>
              </div>
            </div>

            <SheetFooter className='mt-4'>
              <Button type='button' variant='outline' onClick={() => setDetailsOpen(false)}>
                Done
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </form>
    </div>
  );
}
