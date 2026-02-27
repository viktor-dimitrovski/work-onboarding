import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { taskTypeOptions } from '@/lib/constants';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AssessmentTest } from '@/lib/types';
import type { DraftPhase, DraftResource, DraftTask, QuizQuestion, TaskType } from '@/components/tracks/track-builder';

interface TaskDetailsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: DraftTask | null;
  phase: DraftPhase | null;
  onUpdateTask: (update: Partial<DraftTask>) => void;
}

function buildId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function updateResource(task: DraftTask, update: Partial<DraftResource>) {
  const current = task.resources?.[0];
  return {
    client_id: current?.client_id ?? buildId('res'),
    resource_type: update.resource_type ?? current?.resource_type ?? 'external_url',
    title: update.title ?? current?.title ?? '',
    url: update.url ?? current?.url ?? '',
    content_text: update.content_text ?? current?.content_text ?? null,
    order_index: update.order_index ?? current?.order_index ?? 0,
    metadata: update.metadata ?? current?.metadata ?? {},
  } as DraftResource;
}

export function TaskDetailsSheet({ open, onOpenChange, task, phase, onUpdateTask }: TaskDetailsSheetProps) {
  if (!task) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side='right' />
      </Sheet>
    );
  }

  const metadata = (task.metadata ?? {}) as Record<string, any>;
  const quizMeta = (metadata.quiz ?? {}) as Record<string, any>;
  const fileUploadMeta = (metadata.file_upload ?? {}) as Record<string, any>;
  const mentorMeta = (metadata.mentor ?? {}) as Record<string, any>;
  const assessmentMeta = (metadata.assessment ?? {}) as Record<string, any>;
  const questions = (quizMeta.questions ?? []) as QuizQuestion[];
  const { accessToken } = useAuth();
  const [assessmentTests, setAssessmentTests] = useState<AssessmentTest[]>([]);

  useEffect(() => {
    const loadTests = async () => {
      if (!accessToken || !open || task.task_type !== 'assessment_test') return;
      try {
        const response = await api.get<{ items: AssessmentTest[] }>(
          '/assessments/tests?page=1&page_size=100&status=published',
          accessToken,
        );
        setAssessmentTests(response.items || []);
      } catch {
        setAssessmentTests([]);
      }
    };

    void loadTests();
  }, [accessToken, open, task.task_type]);

  const setMetadata = (next: Record<string, any>) => onUpdateTask({ metadata: next });

  const updateQuizQuestions = (nextQuestions: QuizQuestion[]) => {
    setMetadata({
      ...metadata,
      quiz: {
        ...quizMeta,
        questions: nextQuestions,
      },
    });
  };

  const updateResourceFields = (update: Partial<DraftResource>) => {
    const resourceType =
      task.task_type === 'video' ? 'video_link' : task.task_type === 'read_material' ? 'external_url' : 'external_url';
    const nextResource = updateResource(task, { ...update, resource_type: resourceType });
    onUpdateTask({ resources: [nextResource] });
  };

  const isResourceTask = ['read_material', 'video', 'external_link', 'code_assignment'].includes(task.task_type);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side='right' className='w-[92vw] max-w-xl'>
        <SheetHeader>
          <SheetTitle className='text-lg'>Task details</SheetTitle>
          <SheetDescription className='text-xs text-muted-foreground'>
            {phase?.title ? `Phase: ${phase.title}` : 'Update task instructions and details.'}
          </SheetDescription>
          <div className='mt-2 flex flex-wrap items-center gap-2'>
            <Badge variant='secondary' className='capitalize'>
              {task.task_type.replace('_', ' ')}
            </Badge>
            <span className='text-xs text-muted-foreground'>{task.estimated_minutes || 0} minutes</span>
            <span className='text-xs'>{task.required ? 'Required' : 'Optional'}</span>
          </div>
        </SheetHeader>

        <div className='mt-3 rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground'>
          Changes save automatically. Use “Done” to close this panel.
        </div>

        <ScrollArea className='mt-4 h-[calc(100vh-260px)] pr-3'>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label>Title</Label>
              <Input value={task.title} onChange={(event) => onUpdateTask({ title: event.target.value })} />
            </div>

            <div className='grid gap-3 md:grid-cols-2'>
              <div className='space-y-2'>
                <Label>Task type</Label>
                <select
                  className='h-10 rounded-md border border-input bg-white px-3 text-sm'
                  value={task.task_type}
                  onChange={(event) =>
                    onUpdateTask({
                      task_type: event.target.value as TaskType,
                      passing_score:
                        event.target.value === 'quiz' && task.passing_score == null ? 80 : task.passing_score,
                    })
                  }
                >
                  {taskTypeOptions.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              <div className='space-y-2'>
                <Label>Estimated minutes</Label>
                <Input
                  type='number'
                  min={5}
                  max={120}
                  value={task.estimated_minutes}
                  onChange={(event) => onUpdateTask({ estimated_minutes: Number(event.target.value || 0) })}
                />
              </div>

              <label className='flex items-center gap-2 text-sm'>
                <input
                  type='checkbox'
                  checked={task.required}
                  onChange={(event) => onUpdateTask({ required: event.target.checked })}
                />
                Required
              </label>
            </div>

            <div className='space-y-2'>
              <Label>Instructions</Label>
              <Textarea
                rows={4}
                value={task.instructions}
                onChange={(event) => onUpdateTask({ instructions: event.target.value })}
                placeholder='Describe what the assignee should do.'
              />
            </div>

            {isResourceTask && (
              <div className='space-y-3 rounded-md border bg-muted/30 p-3'>
                <p className='text-sm font-medium'>Resource</p>
                <div className='space-y-2'>
                  <Label>Resource label</Label>
                  <Input
                    value={task.resources?.[0]?.title || ''}
                    onChange={(event) => updateResourceFields({ title: event.target.value })}
                    placeholder='Policy doc, runbook, video...'
                  />
                </div>
                <div className='space-y-2'>
                  <Label>Resource URL</Label>
                  <Input
                    value={task.resources?.[0]?.url || ''}
                    onChange={(event) => updateResourceFields({ url: event.target.value })}
                    placeholder='https://...'
                  />
                </div>
              </div>
            )}

            {task.task_type === 'file_upload' && (
              <div className='space-y-3 rounded-md border bg-muted/30 p-3'>
                <p className='text-sm font-medium'>File upload settings</p>
                <div className='space-y-2'>
                  <Label>Allowed types (comma separated)</Label>
                  <Input
                    value={(fileUploadMeta.allowed_types as string[] | undefined)?.join(', ') || ''}
                    onChange={(event) =>
                      setMetadata({
                        ...metadata,
                        file_upload: {
                          ...fileUploadMeta,
                          allowed_types: event.target.value
                            .split(',')
                            .map((val) => val.trim())
                            .filter(Boolean),
                        },
                      })
                    }
                    placeholder='pdf, docx, zip'
                  />
                </div>
                <div className='space-y-2'>
                  <Label>Max size (MB)</Label>
                  <Input
                    type='number'
                    min={1}
                    value={fileUploadMeta.max_size_mb ?? ''}
                    onChange={(event) =>
                      setMetadata({
                        ...metadata,
                        file_upload: {
                          ...fileUploadMeta,
                          max_size_mb: Number(event.target.value || 0),
                        },
                      })
                    }
                    placeholder='50'
                  />
                </div>
              </div>
            )}

            {task.task_type === 'assessment_test' && (
              <div className='space-y-3 rounded-md border bg-muted/30 p-3'>
                <p className='text-sm font-medium'>Assessment</p>
                <div className='space-y-2'>
                  <Label>Assessment test</Label>
                  <select
                    className='h-10 w-full rounded-md border border-input bg-white px-3 text-sm'
                    value={assessmentMeta.test_id || ''}
                    onChange={(event) =>
                      setMetadata({
                        ...metadata,
                        assessment: {
                          ...assessmentMeta,
                          test_id: event.target.value || null,
                        },
                      })
                    }
                  >
                    <option value=''>Select a published test</option>
                    {assessmentTests
                      .filter((test) => test.versions.some((version) => version.status === 'published'))
                      .map((test) => {
                        const latest = test.versions
                          .filter((version) => version.status === 'published')
                          .sort((a, b) => b.version_number - a.version_number)[0];
                        return (
                          <option key={test.id} value={test.id}>
                            {test.title} {latest ? `• v${latest.version_number}` : ''}
                          </option>
                        );
                      })}
                  </select>
                </div>
              </div>
            )}

            {task.task_type === 'quiz' && (
              <div className='space-y-3 rounded-md border bg-muted/30 p-3'>
                <p className='text-sm font-medium'>Quiz settings</p>
                <div className='grid gap-3 md:grid-cols-2'>
                  <div className='space-y-2'>
                    <Label>Passing score (%)</Label>
                    <Input
                      type='number'
                      min={0}
                      max={100}
                      value={task.passing_score ?? ''}
                      onChange={(event) => onUpdateTask({ passing_score: Number(event.target.value || 0) })}
                      placeholder='80'
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label>Attempts allowed</Label>
                    <Input
                      type='number'
                      min={1}
                      value={quizMeta.attempts_allowed ?? ''}
                      onChange={(event) =>
                        setMetadata({
                          ...metadata,
                          quiz: {
                            ...quizMeta,
                            attempts_allowed: Number(event.target.value || 1),
                          },
                        })
                      }
                      placeholder='2'
                    />
                  </div>
                </div>

                <div className='space-y-2'>
                  <div className='flex items-center justify-between'>
                    <Label>Questions</Label>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      onClick={() => {
                        const nextQuestions = [
                          ...questions,
                          {
                            type: 'single',
                            prompt: 'New question',
                            options: ['Option 1', 'Option 2'],
                            correct_option_ids: [0],
                            points: 5,
                            difficulty: 'medium',
                          },
                        ];
                        updateQuizQuestions(nextQuestions);
                      }}
                    >
                      Add question
                    </Button>
                  </div>

                  <div className='space-y-3'>
                    {questions.map((question, qIndex) => {
                      const questionType = question.type || 'single';
                      const questionDifficulty = question.difficulty || 'medium';
                      const questionOptions = question.options || [];

                      return (
                        <div key={`question-${qIndex}`} className='rounded-md border bg-white p-3'>
                          <div className='grid gap-2 md:grid-cols-3'>
                            <Input
                              value={question.prompt}
                              onChange={(event) => {
                                const next = [...questions];
                                next[qIndex] = { ...next[qIndex], prompt: event.target.value };
                                updateQuizQuestions(next);
                              }}
                              placeholder='Question prompt'
                              className='md:col-span-2'
                            />
                            <select
                              className='h-10 rounded-md border border-input bg-white px-3 text-sm'
                              value={questionType}
                              onChange={(event) => {
                                const next = [...questions];
                                next[qIndex] = {
                                  ...next[qIndex],
                                  type: event.target.value as QuizQuestion['type'],
                                  correct_option_ids:
                                    event.target.value === 'single'
                                      ? next[qIndex].correct_option_ids.slice(0, 1)
                                      : next[qIndex].correct_option_ids,
                                };
                                updateQuizQuestions(next);
                              }}
                            >
                              <option value='single'>Single choice</option>
                              <option value='multi'>Multi choice</option>
                            </select>
                          </div>

                          <div className='mt-2 grid gap-2 md:grid-cols-3'>
                            <Input
                              type='number'
                              min={1}
                              value={question.points}
                              onChange={(event) => {
                                const next = [...questions];
                                next[qIndex] = { ...next[qIndex], points: Number(event.target.value || 0) };
                                updateQuizQuestions(next);
                              }}
                              placeholder='Points'
                            />
                            <select
                              className='h-10 rounded-md border border-input bg-white px-3 text-sm'
                              value={questionDifficulty}
                              onChange={(event) => {
                                const next = [...questions];
                                next[qIndex] = {
                                  ...next[qIndex],
                                  difficulty: event.target.value as QuizQuestion['difficulty'],
                                };
                                updateQuizQuestions(next);
                              }}
                            >
                              <option value='easy'>Easy</option>
                              <option value='medium'>Medium</option>
                              <option value='hard'>Hard</option>
                            </select>
                            <Button
                              type='button'
                              variant='outline'
                              onClick={() => {
                                const next = questions.filter((_, idx) => idx !== qIndex);
                                updateQuizQuestions(next);
                              }}
                            >
                              Remove question
                            </Button>
                          </div>

                          <div className='mt-3 space-y-2'>
                            {questionOptions.map((option, optionIndex) => {
                              const isCorrect = question.correct_option_ids.includes(optionIndex);
                              return (
                                <div key={`question-${qIndex}-opt-${optionIndex}`} className='flex items-center gap-2'>
                                  <input
                                    type={questionType === 'single' ? 'radio' : 'checkbox'}
                                    checked={isCorrect}
                                    onChange={(event) => {
                                      const next = [...questions];
                                      const current = next[qIndex];
                                      const nextCorrect =
                                        questionType === 'single'
                                          ? [optionIndex]
                                          : event.target.checked
                                            ? [...current.correct_option_ids, optionIndex]
                                            : current.correct_option_ids.filter((id) => id !== optionIndex);
                                      next[qIndex] = { ...current, correct_option_ids: nextCorrect };
                                      updateQuizQuestions(next);
                                    }}
                                  />
                                  <Input
                                    value={option}
                                    onChange={(event) => {
                                      const next = [...questions];
                                      const opts = [...next[qIndex].options];
                                      opts[optionIndex] = event.target.value;
                                      next[qIndex] = { ...next[qIndex], options: opts };
                                      updateQuizQuestions(next);
                                    }}
                                    placeholder={`Option ${optionIndex + 1}`}
                                  />
                                  <Button
                                    type='button'
                                    variant='ghost'
                                    size='sm'
                                    onClick={() => {
                                      const next = [...questions];
                                      const opts = next[qIndex].options.filter((_, idx) => idx !== optionIndex);
                                      const correct = next[qIndex].correct_option_ids
                                        .filter((id) => id !== optionIndex)
                                        .map((id) => (id > optionIndex ? id - 1 : id));
                                      next[qIndex] = { ...next[qIndex], options: opts, correct_option_ids: correct };
                                      updateQuizQuestions(next);
                                    }}
                                  >
                                    Remove
                                  </Button>
                                </div>
                              );
                            })}
                            <Button
                              type='button'
                              variant='outline'
                              size='sm'
                              onClick={() => {
                                const next = [...questions];
                                const opts = [
                                  ...next[qIndex].options,
                                  `Option ${next[qIndex].options.length + 1}`,
                                ];
                                next[qIndex] = { ...next[qIndex], options: opts };
                                updateQuizQuestions(next);
                              }}
                            >
                              Add option
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {task.task_type === 'mentor_approval' && (
              <div className='space-y-3 rounded-md border bg-muted/30 p-3'>
                <p className='text-sm font-medium'>Mentor approval criteria</p>
                <div className='space-y-2'>
                  <Label>Approval criteria</Label>
                  <Input
                    value={mentorMeta.approval_criteria ?? ''}
                    onChange={(event) =>
                      setMetadata({
                        ...metadata,
                        mentor: {
                          ...mentorMeta,
                          approval_criteria: event.target.value,
                        },
                      })
                    }
                    placeholder='What must be verified before approval?'
                  />
                </div>
                <div className='space-y-2'>
                  <Label>Mentor role</Label>
                  <Input
                    value={mentorMeta.mentor_role ?? ''}
                    onChange={(event) =>
                      setMetadata({
                        ...metadata,
                        mentor: {
                          ...mentorMeta,
                          mentor_role: event.target.value,
                        },
                      })
                    }
                    placeholder='mentor, lead, reviewer'
                  />
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <SheetFooter className='mt-4 border-t pt-3'>
          <SheetClose asChild>
            <Button variant='secondary'>Done</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
