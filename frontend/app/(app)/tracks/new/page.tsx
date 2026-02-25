'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { taskTypeOptions } from '@/lib/constants';
import { useAuth } from '@/lib/auth-context';

const schema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  role_target: z.string().optional(),
  estimated_duration_days: z.coerce.number().min(1).max(365),
  tags: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface DraftTask {
  title: string;
  task_type: string;
  order_index: number;
  required: boolean;
  instructions: string;
  estimated_minutes: number;
}

interface DraftPhase {
  title: string;
  description: string;
  order_index: number;
  tasks: DraftTask[];
}

export default function NewTrackPage() {
  const { accessToken } = useAuth();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiNotes, setAiNotes] = useState(
    'We need a 30-day onboarding for a backend engineer working on payments.\n- Week 1: orientation, security, dev env\n- Week 2: API standards, logging/monitoring\n- Week 3: hands-on small feature with mentor approval\n- Week 4: performance tuning & deployment checklist\nInclude one quiz, one code assignment, and mentor approval before production access.',
  );
  const [aiPhases, setAiPhases] = useState<DraftPhase[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [phases, setPhases] = useState<DraftPhase[]>([
    {
      title: 'Phase 1: Orientation',
      description: 'Initial context and setup',
      order_index: 0,
      tasks: [
        {
          title: 'Read internal SSDLC policy',
          task_type: 'read_material',
          order_index: 0,
          required: true,
          instructions: 'Read and acknowledge the policy document.',
          estimated_minutes: 20,
        },
      ],
    },
  ]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: 'DevOps Engineer Onboarding',
      description: 'Structured onboarding track for platform and infrastructure responsibilities.',
      role_target: 'devops',
      estimated_duration_days: 45,
      tags: 'devops,platform,security',
    },
  });

  const canSubmit = useMemo(
    () => phases.length > 0 && phases.every((phase) => phase.title && phase.tasks.length > 0),
    [phases],
  );

  const applyAiPhases = (draft: DraftPhase[]) => {
    const cleaned = draft.map((phase, phaseIndex) => ({
      title: phase.title || `Phase ${phaseIndex + 1}`,
      description: phase.description || '',
      order_index: phaseIndex,
      tasks: (phase.tasks || []).map((task, taskIndex) => ({
        title: task.title || `Task ${phaseIndex + 1}.${taskIndex + 1}`,
        task_type: task.task_type || 'checklist',
        order_index: taskIndex,
        required: typeof task.required === 'boolean' ? task.required : true,
        instructions: task.instructions || '',
        estimated_minutes: task.estimated_minutes || 30,
      })),
    }));
    setPhases(cleaned);
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
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to draft with AI');
      }
      setAiPhases(data.phases || []);
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
          passing_score: null,
          metadata: {},
          due_days_offset: taskIndex + phaseIndex,
          resources: [],
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

  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-2xl font-semibold'>Create track template</h2>
        <p className='text-sm text-muted-foreground'>
          Define phases and tasks for role-based onboarding.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>AI-assisted bulk drafting (optional)</CardTitle>
        </CardHeader>
        <CardContent className='grid gap-4 lg:grid-cols-[1.3fr,1fr]'>
          <div className='space-y-3'>
            <Label>Describe the onboarding goals</Label>
            <Textarea
              rows={10}
              value={aiNotes}
              onChange={(event) => setAiNotes(event.target.value)}
              placeholder='Paste bullets or free text. Mention role, phases, required approvals, quizzes, deliverables.'
            />
            <div className='flex flex-wrap gap-2'>
              <Button type='button' onClick={draftWithAI} disabled={aiLoading}>
                {aiLoading ? 'Drafting…' : 'Draft with AI'}
              </Button>
              {aiPhases && aiPhases.length > 0 && (
                <Button
                  type='button'
                  variant='secondary'
                  onClick={() => applyAiPhases(aiPhases)}
                >
                  Apply to builder
                </Button>
              )}
            </div>
            {aiError && <p className='text-sm text-destructive'>{aiError}</p>}
            {!process.env.OPENAI_API_KEY && (
              <p className='text-xs text-muted-foreground'>
                Note: Set `OPENAI_API_KEY` in frontend env to enable live drafting.
              </p>
            )}
          </div>

          <div className='space-y-3 rounded-md border bg-muted/30 p-4'>
            <p className='text-sm font-semibold'>Proposed structure preview</p>
            {aiPhases && aiPhases.length > 0 ? (
              <div className='space-y-3 max-h-96 overflow-auto pr-2'>
                {aiPhases.map((phase, idx) => (
                  <div key={idx} className='rounded-md border bg-white p-3 shadow-sm'>
                    <p className='text-sm font-semibold'>{phase.title}</p>
                    {phase.description && (
                      <p className='text-xs text-muted-foreground'>{phase.description}</p>
                    )}
                    <ul className='mt-2 space-y-1 text-xs'>
                      {phase.tasks?.map((task, tIdx) => (
                        <li key={tIdx} className='flex justify-between gap-2'>
                          <span className='font-medium'>{task.title}</span>
                          <span className='text-muted-foreground'>{task.task_type}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className='text-xs text-muted-foreground'>
                Run “Draft with AI” to preview structured phases and tasks, then apply to the builder for
                fine-tuning.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Track metadata</CardTitle>
        </CardHeader>
        <CardContent>
          <form className='grid gap-4 md:grid-cols-2' onSubmit={onSubmit}>
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
              <Input id='estimated_duration_days' type='number' {...form.register('estimated_duration_days')} />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='tags'>Tags (comma separated)</Label>
              <Input id='tags' placeholder='devops, platform, security' {...form.register('tags')} />
            </div>

            <div className='md:col-span-2'>
              <Card className='border-dashed'>
                <CardHeader>
                  <CardTitle className='text-base'>Phase builder</CardTitle>
                </CardHeader>
                <CardContent className='space-y-4'>
                  {phases.map((phase, phaseIndex) => (
                    <div key={phaseIndex} className='space-y-3 rounded-md border p-3'>
                      <div className='grid gap-2 md:grid-cols-2'>
                        <Input
                          value={phase.title}
                          onChange={(event) => {
                            const next = [...phases];
                            next[phaseIndex].title = event.target.value;
                            setPhases(next);
                          }}
                          placeholder='Phase title'
                        />
                        <Input
                          value={phase.description}
                          onChange={(event) => {
                            const next = [...phases];
                            next[phaseIndex].description = event.target.value;
                            setPhases(next);
                          }}
                          placeholder='Phase description'
                        />
                      </div>

                      <div className='space-y-2'>
                        {phase.tasks.map((task, taskIndex) => (
                          <div key={taskIndex} className='grid gap-2 rounded-md border bg-muted/30 p-3 md:grid-cols-4'>
                            <Input
                              value={task.title}
                              onChange={(event) => {
                                const next = [...phases];
                                next[phaseIndex].tasks[taskIndex].title = event.target.value;
                                setPhases(next);
                              }}
                              placeholder='Task title'
                              className='md:col-span-2'
                            />
                            <select
                              className='h-10 rounded-md border border-input bg-white px-3 text-sm'
                              value={task.task_type}
                              onChange={(event) => {
                                const next = [...phases];
                                next[phaseIndex].tasks[taskIndex].task_type = event.target.value;
                                setPhases(next);
                              }}
                            >
                              {taskTypeOptions.map((type) => (
                                <option key={type} value={type}>
                                  {type}
                                </option>
                              ))}
                            </select>
                            <Input
                              type='number'
                              value={task.estimated_minutes}
                              onChange={(event) => {
                                const next = [...phases];
                                next[phaseIndex].tasks[taskIndex].estimated_minutes = Number(event.target.value || 0);
                                setPhases(next);
                              }}
                              placeholder='Minutes'
                            />
                            <Textarea
                              className='md:col-span-4'
                              value={task.instructions}
                              onChange={(event) => {
                                const next = [...phases];
                                next[phaseIndex].tasks[taskIndex].instructions = event.target.value;
                                setPhases(next);
                              }}
                              placeholder='Task instructions'
                            />
                          </div>
                        ))}
                      </div>

                      <Button
                        type='button'
                        variant='outline'
                        onClick={() => {
                          const next = [...phases];
                          next[phaseIndex].tasks.push({
                            title: 'New task',
                            task_type: 'read_material',
                            order_index: next[phaseIndex].tasks.length,
                            required: true,
                            instructions: '',
                            estimated_minutes: 15,
                          });
                          setPhases(next);
                        }}
                      >
                        Add task
                      </Button>
                    </div>
                  ))}

                  <Button
                    type='button'
                    variant='secondary'
                    onClick={() => {
                      setPhases((existing) => [
                        ...existing,
                        {
                          title: `Phase ${existing.length + 1}`,
                          description: '',
                          order_index: existing.length,
                          tasks: [
                            {
                              title: 'New task',
                              task_type: 'checklist',
                              order_index: 0,
                              required: true,
                              instructions: '',
                              estimated_minutes: 15,
                            },
                          ],
                        },
                      ]);
                    }}
                  >
                    Add phase
                  </Button>
                </CardContent>
              </Card>
            </div>

            {error && <p className='md:col-span-2 text-sm text-destructive'>{error}</p>}

            <div className='flex gap-2 md:col-span-2'>
              <Button type='submit' disabled={saving || !canSubmit}>
                {saving ? 'Saving track...' : 'Create track'}
              </Button>
              <Button type='button' variant='outline' onClick={() => router.push('/tracks')}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
