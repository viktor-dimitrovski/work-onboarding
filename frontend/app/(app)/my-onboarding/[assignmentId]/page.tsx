'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { StatusChip } from '@/components/common/status-chip';
import { TaskPanelChecklist } from '@/components/assignments/task-panel-checklist';
import { TaskPanelReadLink } from '@/components/assignments/task-panel-read-link';
import { TaskPanelReviewRequired } from '@/components/assignments/task-panel-review-required';
import { getTaskTypeIcon, getTaskTypeLabel } from '@/components/assignments/task-type';
import { TaskResourceList } from '@/components/assignments/task-resource-list';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { Assignment, AssignmentTask, QuizAttempt } from '@/lib/types';

export default function MyOnboardingPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { accessToken } = useAuth();
  const router = useRouter();

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [selectedTask, setSelectedTask] = useState<AssignmentTask | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number[]>>({});
  const [quizAttempts, setQuizAttempts] = useState<QuizAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openPhaseIds, setOpenPhaseIds] = useState<string[]>([]);
  const [phaseView, setPhaseView] = useState<'list' | 'wizard'>('list');
  const [wizardPhaseId, setWizardPhaseId] = useState<string | null>(null);
  const [commentOpen, setCommentOpen] = useState(false);
  const [checklistUpdatingId, setChecklistUpdatingId] = useState<string | null>(null);
  const selectedTaskIdRef = useRef<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nextTask = useMemo(
    () => assignment?.phases.flatMap((phase) => phase.tasks).find((task) => task.is_next_recommended) || null,
    [assignment],
  );

  const orderedPhases = useMemo(() => {
    if (!assignment) return [];
    return assignment.phases.slice().sort((a, b) => a.order_index - b.order_index);
  }, [assignment]);

  const selectedPhaseId = useMemo(() => {
    if (!assignment || !selectedTask) return null;
    return assignment.phases.find((phase) => phase.tasks.some((task) => task.id === selectedTask.id))?.id ?? null;
  }, [assignment, selectedTask]);

  const load = async ({ silent } = { silent: false }) => {
    if (!accessToken || !assignmentId) return;
    if (!silent || !assignment) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    try {
      const response = await api.get<Assignment>(`/assignments/${assignmentId}`, accessToken);
      setAssignment(response);

      const desiredTaskId = selectedTaskIdRef.current ?? selectedTask?.id ?? null;
      const allTasks = response.phases.flatMap((phase) => phase.tasks);
      const nextSelected =
        (desiredTaskId ? allTasks.find((task) => task.id === desiredTaskId) : null) ||
        allTasks.find((task) => task.is_next_recommended) ||
        allTasks[0] ||
        null;
      setSelectedTask(nextSelected);

      const storageKey = `onboarding:assignment:${assignmentId}:open-phases`;
      if (typeof window !== 'undefined') {
        try {
          const stored = window.localStorage.getItem(storageKey);
          if (stored) {
            const parsed = JSON.parse(stored) as unknown;
            if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
              setOpenPhaseIds(parsed);
              return;
            }
          }
        } catch {
          // ignore
        }
      }

      const phaseContainingSelected = nextSelected
        ? response.phases.find((phase) => phase.tasks.some((t) => t.id === nextSelected.id))?.id
        : null;
      const inProgressPhase = response.phases.find((phase) => phase.status === 'in_progress')?.id ?? null;
      const defaultPhaseId = phaseContainingSelected || inProgressPhase || response.phases[0]?.id || null;
      setOpenPhaseIds(defaultPhaseId ? [defaultPhaseId] : []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accessToken, assignmentId]);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) {
        clearTimeout(noticeTimer.current);
      }
    };
  }, []);

  const flashNotice = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) {
      clearTimeout(noticeTimer.current);
    }
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  };

  useEffect(() => {
    selectedTaskIdRef.current = selectedTask?.id ?? null;
  }, [selectedTask?.id]);

  useEffect(() => {
    if (!orderedPhases.length) return;
    if (selectedPhaseId) {
      setWizardPhaseId(selectedPhaseId);
      return;
    }
    if (!wizardPhaseId) {
      const inProgress = orderedPhases.find((phase) => phase.status === 'in_progress')?.id ?? orderedPhases[0]?.id ?? null;
      setWizardPhaseId(inProgress);
    }
  }, [orderedPhases, selectedPhaseId, wizardPhaseId]);

  useEffect(() => {
    if (!assignmentId) return;
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(`onboarding:assignment:${assignmentId}:open-phases`, JSON.stringify(openPhaseIds));
    } catch {
      // ignore
    }
  }, [assignmentId, openPhaseIds]);

  useEffect(() => {
    setAnswerText('');
    setFileUrl('');
    setQuizAnswers({});
    setError(null);
    setCommentOpen(false);
  }, [selectedTask?.id]);

  useEffect(() => {
    const loadAttempts = async () => {
      if (!accessToken || !assignmentId || !selectedTask || selectedTask.task_type !== 'quiz') {
        setQuizAttempts([]);
        return;
      }
      try {
        const response = await api.get<QuizAttempt[]>(
          `/progress/assignments/${assignmentId}/tasks/${selectedTask.id}/quiz-attempts`,
          accessToken,
        );
        setQuizAttempts(response);
      } catch {
        setQuizAttempts([]);
      }
    };

    void loadAttempts();
  }, [accessToken, assignmentId, selectedTask?.id, selectedTask?.task_type]);

  const updateTaskInState = (taskId: string, update: Partial<AssignmentTask>) => {
    setAssignment((prev) => {
      if (!prev) return prev;
      const nextPhases = prev.phases.map((phase) => ({
        ...phase,
        tasks: phase.tasks.map((task) => (task.id === taskId ? { ...task, ...update } : task)),
      }));
      return { ...prev, phases: nextPhases };
    });
    setSelectedTask((prev) => (prev?.id === taskId ? { ...prev, ...update } : prev));
  };

  const replaceTaskInState = (nextTask: AssignmentTask) => {
    setAssignment((prev) => {
      if (!prev) return prev;
      const nextPhases = prev.phases.map((phase) => ({
        ...phase,
        tasks: phase.tasks.map((task) => (task.id === nextTask.id ? nextTask : task)),
      }));
      return { ...prev, phases: nextPhases };
    });
    setSelectedTask((prev) => (prev?.id === nextTask.id ? nextTask : prev));
  };

  const submitTask = async () => {
    if (!accessToken || !assignmentId || !selectedTask) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);

    const needsReview = ['mentor_approval', 'code_assignment', 'file_upload'].includes(selectedTask.task_type);
    updateTaskInState(selectedTask.id, {
      status: needsReview ? 'pending_review' : 'completed',
      progress_percent: needsReview ? 75 : 100,
      completed_at: needsReview ? selectedTask.completed_at ?? null : new Date().toISOString(),
    });

    try {
      await api.post(
        `/progress/assignments/${assignmentId}/tasks/${selectedTask.id}/submit`,
        {
          submission_type: fileUrl ? 'file' : 'text',
          answer_text: answerText || null,
          file_url: fileUrl || null,
          metadata: {
            submitted_from: 'employee_flow',
          },
        },
        accessToken,
      );
      setAnswerText('');
      setFileUrl('');
      await load({ silent: true });
      flashNotice('Saved.');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to submit task');
      await load({ silent: true });
    } finally {
      setSubmitting(false);
    }
  };

  const submitQuiz = async () => {
    if (!accessToken || !assignmentId || !selectedTask) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      await api.post(
        `/progress/assignments/${assignmentId}/tasks/${selectedTask.id}/submit`,
        {
          submission_type: 'quiz',
          quiz_answers: quizAnswers,
          metadata: {
            submitted_from: 'employee_flow',
          },
        },
        accessToken,
      );
      setQuizAnswers({});
      await load({ silent: true });
      flashNotice('Quiz submitted.');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to submit quiz');
      await load({ silent: true });
    } finally {
      setSubmitting(false);
    }
  };

  const updateChecklistItem = async (itemId: string, checked: boolean, comment?: string | null) => {
    if (!accessToken || !assignmentId || !selectedTask) return;
    setChecklistUpdatingId(itemId);
    setError(null);
    setNotice(null);

    try {
      const updated = await api.patch<AssignmentTask>(
        `/progress/assignments/${assignmentId}/tasks/${selectedTask.id}/checklist`,
        {
          item_id: itemId,
          checked,
          comment: comment ?? null,
        },
        accessToken,
      );
      replaceTaskInState(updated);
      await load({ silent: true });
      flashNotice('Checklist updated.');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to update checklist');
      await load({ silent: true });
    } finally {
      setChecklistUpdatingId(null);
    }
  };

  if (loading) return <LoadingState label='Loading onboarding flow...' />;
  if (!assignment) return <EmptyState title='Assignment not found' description='You do not have access to this onboarding assignment.' />;

  const isQuiz = selectedTask?.task_type === 'quiz';
  const isAssessment = selectedTask?.task_type === 'assessment_test';
  const isChecklist = selectedTask?.task_type === 'checklist';
  const isReadLike = ['read_material', 'video', 'external_link'].includes(selectedTask?.task_type || '');
  const quizMeta = (selectedTask?.metadata?.quiz as Record<string, unknown>) || null;
  const assessmentMeta = (selectedTask?.metadata?.assessment as Record<string, unknown>) || null;
  const assessmentDeliveryId = assessmentMeta?.delivery_id as string | undefined;
  const quizQuestions = (quizMeta?.questions as Array<Record<string, unknown>>) || [];
  const attemptsAllowed = quizMeta?.attempts_allowed as number | undefined;
  const attemptsUsed = quizMeta?.attempts_used as number | undefined;
  const attemptsRemaining = quizMeta?.attempts_remaining as number | undefined;
  const quizLocked =
    attemptsRemaining === 0 || selectedTask?.status === 'completed' || selectedTask?.status === 'pending_review';
  const lastAttemptAnswers =
    quizAttempts.length > 0 ? (quizAttempts[quizAttempts.length - 1].answers as Record<string, number[]>) : {};
  const reviewRequired = ['mentor_approval', 'code_assignment', 'file_upload'].includes(
    selectedTask?.task_type || '',
  );
  const taskCompleted = selectedTask?.status === 'completed';
  const taskPendingReview = selectedTask?.status === 'pending_review';
  const taskLocked = taskCompleted || taskPendingReview;
  const taskResources = selectedTask?.resources ?? [];

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <Button type='button' variant='outline' size='sm' onClick={() => router.back()}>
          Back
        </Button>
        <div className='flex items-center gap-3'>
          {notice && <p className='text-xs text-emerald-600'>{notice}</p>}
          {refreshing && <p className='text-xs text-muted-foreground'>Refreshing…</p>}
        </div>
      </div>

      <Card className='bg-muted/10'>
        <CardContent className='flex flex-wrap items-center justify-between gap-3 py-3'>
          <div className='min-w-0'>
            <p className='truncate text-sm font-semibold'>{assignment.title}</p>
            <p className='text-xs text-muted-foreground'>
              Follow phases in order. Mentor approvals will appear in your review queue automatically.
            </p>
          </div>
          {nextTask ? (
            <div className='flex items-center gap-3 rounded-md border bg-white/70 px-3 py-2'>
              <div>
                <p className='text-[11px] uppercase tracking-wide text-muted-foreground'>Next task</p>
                <p className='text-sm font-medium'>{nextTask.title}</p>
              </div>
              <StatusChip status={nextTask.status} />
            </div>
          ) : (
            <div className='rounded-md border bg-white/70 px-3 py-2 text-xs text-muted-foreground'>
              No next task
            </div>
          )}
        </CardContent>
      </Card>

      <div className='grid gap-6 lg:grid-cols-[1.6fr,1fr] lg:items-start'>
        <Card>
          <CardHeader>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <CardTitle>Phase timeline</CardTitle>
              <div className='flex items-center gap-2'>
                <Button
                  type='button'
                  size='sm'
                  variant={phaseView === 'list' ? 'secondary' : 'ghost'}
                  onClick={() => setPhaseView('list')}
                >
                  List
                </Button>
                <Button
                  type='button'
                  size='sm'
                  variant={phaseView === 'wizard' ? 'secondary' : 'ghost'}
                  onClick={() => setPhaseView('wizard')}
                >
                  Wizard
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className='pr-2'>
            {phaseView === 'list' ? (
              <Accordion type='multiple' className='space-y-2' value={openPhaseIds} onValueChange={setOpenPhaseIds}>
                {orderedPhases.map((phase) => (
                  <AccordionItem key={phase.id} value={phase.id} className='rounded-md border px-3'>
                    <AccordionTrigger>
                      <div className='flex w-full flex-wrap items-center justify-between gap-3'>
                        <div>
                          <p className='font-medium'>{phase.title}</p>
                          <p className='text-xs text-muted-foreground'>
                            {phase.tasks.length} tasks • {Math.round(phase.progress_percent)}%
                          </p>
                        </div>
                        <div className='w-28'>
                          <Progress value={phase.progress_percent} className='h-2' />
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className='space-y-2'>
                        {phase.tasks
                          .filter((task) => !task.metadata?.archived_from_republish)
                          .slice()
                          .sort((a, b) => a.order_index - b.order_index)
                          .map((task) => (
                            <button
                              key={task.id}
                              className={`w-full rounded-md border px-3 py-2 text-left transition ${
                                selectedTask?.id === task.id
                                  ? 'border-primary bg-secondary/70'
                                  : 'bg-muted/30 hover:border-primary/40'
                              }`}
                              onClick={() => {
                                setSelectedTask(task);
                                setOpenPhaseIds((prev) => (prev.includes(phase.id) ? prev : [...prev, phase.id]));
                              }}
                            >
                              <div className='flex items-start justify-between gap-3'>
                                <div className='flex min-w-0 items-start gap-2'>
                                  <span className='mt-0.5 rounded-md border bg-white p-1 text-muted-foreground'>
                                    {(() => {
                                      const Icon = getTaskTypeIcon(task.task_type);
                                      return <Icon className='h-3.5 w-3.5' />;
                                    })()}
                                  </span>
                                  <div className='min-w-0'>
                                    <p className='truncate text-sm font-medium'>{task.title}</p>
                                    <p className='mt-0.5 text-xs text-muted-foreground'>
                                      {getTaskTypeLabel(task.task_type)}
                                      {task.estimated_minutes ? ` • ${task.estimated_minutes}m` : ''}
                                      {task.due_date ? ` • due ${task.due_date}` : ''}
                                    </p>
                                  </div>
                                </div>
                                <StatusChip status={task.status} />
                              </div>
                            </button>
                          ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            ) : (
              (() => {
                const currentIndex = orderedPhases.findIndex((phase) => phase.id === wizardPhaseId);
                const phase = currentIndex >= 0 ? orderedPhases[currentIndex] : orderedPhases[0];
                if (!phase) {
                  return (
                    <div className='rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground'>
                      No phases available.
                    </div>
                  );
                }
                const tasks = phase.tasks
                  .filter((task) => !task.metadata?.archived_from_republish)
                  .slice()
                  .sort((a, b) => a.order_index - b.order_index);
                const goToPhase = (index: number) => {
                  const next = orderedPhases[index];
                  if (!next) return;
                  setWizardPhaseId(next.id);
                  setOpenPhaseIds([next.id]);
                  const nextTask = next.tasks
                    .filter((task) => !task.metadata?.archived_from_republish)
                    .slice()
                    .sort((a, b) => a.order_index - b.order_index)[0];
                  if (nextTask) {
                    setSelectedTask(nextTask);
                  }
                };
                return (
                  <div className='space-y-3'>
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                      <div>
                        <p className='text-sm font-semibold'>{phase.title}</p>
                        <p className='text-xs text-muted-foreground'>
                          Phase {currentIndex + 1} of {orderedPhases.length} • {tasks.length} tasks •{' '}
                          {Math.round(phase.progress_percent)}%
                        </p>
                      </div>
                      <div className='flex items-center gap-2'>
                        <Button
                          type='button'
                          size='sm'
                          variant='outline'
                          onClick={() => goToPhase(currentIndex - 1)}
                          disabled={currentIndex <= 0}
                        >
                          Prev
                        </Button>
                        <Button
                          type='button'
                          size='sm'
                          variant='outline'
                          onClick={() => goToPhase(currentIndex + 1)}
                          disabled={currentIndex >= orderedPhases.length - 1}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                    <Progress value={phase.progress_percent} className='h-2' />
                    <div className='space-y-2'>
                      {tasks.map((task) => (
                        <button
                          key={task.id}
                          className={`w-full rounded-md border px-3 py-2 text-left transition ${
                            selectedTask?.id === task.id
                              ? 'border-primary bg-secondary/70'
                              : 'bg-muted/30 hover:border-primary/40'
                          }`}
                          onClick={() => {
                            setSelectedTask(task);
                            setOpenPhaseIds([phase.id]);
                          }}
                        >
                          <div className='flex items-start justify-between gap-3'>
                            <div className='flex min-w-0 items-start gap-2'>
                              <span className='mt-0.5 rounded-md border bg-white p-1 text-muted-foreground'>
                                {(() => {
                                  const Icon = getTaskTypeIcon(task.task_type);
                                  return <Icon className='h-3.5 w-3.5' />;
                                })()}
                              </span>
                              <div className='min-w-0'>
                                <p className='truncate text-sm font-medium'>{task.title}</p>
                                <p className='mt-0.5 text-xs text-muted-foreground'>
                                  {getTaskTypeLabel(task.task_type)}
                                  {task.estimated_minutes ? ` • ${task.estimated_minutes}m` : ''}
                                  {task.due_date ? ` • due ${task.due_date}` : ''}
                                </p>
                              </div>
                            </div>
                            <StatusChip status={task.status} />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()
            )}
          </CardContent>
        </Card>

        <Card className='lg:sticky lg:top-24 lg:max-h-[calc(100vh-260px)] lg:overflow-auto'>
          <CardHeader>
            <div className='flex items-start justify-between gap-3'>
              <div>
                <CardTitle>{selectedTask ? getTaskTypeLabel(selectedTask.task_type) : 'Select a task'}</CardTitle>
                <CardDescription>{selectedTask?.title || 'Choose a task from the phase timeline.'}</CardDescription>
              </div>
              {selectedTask && <StatusChip status={selectedTask.status} />}
            </div>
            {selectedTask ? (
              <p className='text-xs text-muted-foreground'>
                {selectedTask.estimated_minutes ? `${selectedTask.estimated_minutes} minutes` : 'No time estimate'}
                {selectedTask.due_date ? ` • due ${selectedTask.due_date}` : ''}
              </p>
            ) : null}
          </CardHeader>
          <CardContent className='space-y-3'>
            {!selectedTask ? (
              <div className='rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground'>
                Select a task from the left to see details and submit progress.
              </div>
            ) : isAssessment ? (
              <div className='space-y-3'>
                <div className='rounded-md border bg-muted/30 p-3 text-sm'>
                  <p>Assessment task</p>
                  <p className='text-xs text-muted-foreground'>
                    Complete the linked assessment to mark this task as finished.
                  </p>
                </div>
                {assessmentDeliveryId ? (
                  <Button asChild disabled={taskLocked}>
                    <a href={`/assessments/deliveries/${assessmentDeliveryId}`}>Start assessment</a>
                  </Button>
                ) : (
                  <p className='text-xs text-muted-foreground'>Delivery not created for this task yet.</p>
                )}
              </div>
            ) : isQuiz ? (
              <div className='space-y-4'>
                <div className='rounded-md border bg-muted/30 p-3 text-sm'>
                  <p>Attempts: {attemptsUsed ?? 0} / {attemptsAllowed ?? '∞'}</p>
                  {attemptsRemaining !== undefined && <p>Remaining: {attemptsRemaining}</p>}
                </div>
                {quizQuestions.length === 0 ? (
                  <p className='text-sm text-muted-foreground'>No quiz questions configured.</p>
                ) : (
                  <div className='space-y-4'>
                    {quizQuestions.map((question, qIndex) => {
                      const options = (question.options as string[]) || [];
                      const correctOptionIds = (question.correct_option_ids as number[] | undefined) || [];
                      const selected = quizAnswers[String(qIndex)] || [];
                      return (
                        <div key={`quiz-${qIndex}`} className='rounded-md border p-3'>
                          <p className='font-medium'>{question.prompt as string}</p>
                          <p className='text-xs text-muted-foreground'>
                            Points: {(question.points as number | undefined) ?? 1} • Difficulty:{' '}
                            {(question.difficulty as string | undefined) ?? 'medium'}
                          </p>
                          <div className='mt-2 space-y-2'>
                            {options.map((option, optionIndex) => {
                              const isChecked = selected.includes(optionIndex);
                              return (
                                <label key={`quiz-${qIndex}-opt-${optionIndex}`} className='flex items-center gap-2 text-sm'>
                                  <input
                                    type={question.type === 'multi' ? 'checkbox' : 'radio'}
                                    name={`quiz-${qIndex}`}
                                    disabled={quizLocked}
                                    checked={isChecked}
                                    onChange={(event) => {
                                      const next = { ...quizAnswers };
                                      if (question.type === 'multi') {
                                        next[String(qIndex)] = event.target.checked
                                          ? [...selected, optionIndex]
                                          : selected.filter((id) => id !== optionIndex);
                                      } else {
                                        next[String(qIndex)] = [optionIndex];
                                      }
                                      setQuizAnswers(next);
                                    }}
                                  />
                                  <span>{option}</span>
                                </label>
                              );
                            })}
                          </div>
                          {correctOptionIds.length > 0 && (
                            <p className='mt-2 text-xs text-muted-foreground'>
                              Correct answer: {correctOptionIds.map((id) => options[id]).filter(Boolean).join(', ')}
                            </p>
                          )}
                          {lastAttemptAnswers[String(qIndex)] && (
                            <p className='mt-1 text-xs text-muted-foreground'>
                              Your last answer:{' '}
                              {lastAttemptAnswers[String(qIndex)]
                                .map((id) => options[id])
                                .filter(Boolean)
                                .join(', ')}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {quizAttempts.length > 0 && (
                  <div className='rounded-md border bg-white p-3'>
                    <p className='text-sm font-medium'>Attempt history</p>
                    <ul className='mt-2 space-y-2 text-xs text-muted-foreground'>
                      {quizAttempts.map((attempt) => (
                        <li key={attempt.id} className='flex items-center justify-between'>
                          <span>
                            Attempt {attempt.attempt_number}: {attempt.score}/{attempt.max_score}{' '}
                            {attempt.passed ? '(passed)' : '(failed)'}
                          </span>
                          <span>{new Date(attempt.submitted_at).toLocaleString()}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : isChecklist ? (
              <>
                {selectedTask.instructions && (
                  <div className='rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground'>
                    {selectedTask.instructions}
                  </div>
                )}
                <TaskResourceList resources={taskResources} />
                <TaskPanelChecklist
                  task={selectedTask}
                  onToggleItem={updateChecklistItem}
                  updatingItemId={checklistUpdatingId}
                  disabled={taskLocked}
                />
              </>
            ) : reviewRequired ? (
              <TaskPanelReviewRequired
                task={selectedTask}
                resources={taskResources}
                answerText={answerText}
                onAnswerChange={setAnswerText}
                fileUrl={fileUrl}
                onFileUrlChange={setFileUrl}
                submitting={submitting}
                disabled={taskLocked}
                pendingReview={taskPendingReview}
                onSubmit={submitTask}
              />
            ) : isReadLike ? (
              <TaskPanelReadLink
                task={selectedTask}
                resources={taskResources}
                comment={answerText}
                onCommentChange={setAnswerText}
                commentOpen={commentOpen}
                onToggleComment={() => setCommentOpen((prev) => !prev)}
                submitting={submitting}
                disabled={taskLocked}
                onSubmit={submitTask}
              />
            ) : (
              <>
                {taskCompleted && (
                  <div className='rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground'>
                    This task is completed. Submissions are disabled.
                  </div>
                )}
                {taskPendingReview && (
                  <div className='rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground'>
                    This task is pending review. You can resubmit only if revisions are requested.
                  </div>
                )}
                <div className='space-y-2'>
                  <Label>Response</Label>
                  <Textarea
                    rows={6}
                    placeholder='Describe what you completed, answers, or links to evidence.'
                    value={answerText}
                    onChange={(event) => setAnswerText(event.target.value)}
                    disabled={taskLocked}
                  />
                </div>

                <div className='space-y-2'>
                  <Label>File URL (optional)</Label>
                  <input
                    value={fileUrl}
                    onChange={(event) => setFileUrl(event.target.value)}
                    placeholder='https://files.example.com/...'
                    className='h-10 w-full rounded-md border border-input bg-white px-3 text-sm'
                    disabled={taskLocked}
                  />
                </div>
                <div className='flex flex-wrap gap-2'>
                  <Button onClick={submitTask} disabled={!selectedTask || submitting || taskLocked}>
                    {submitting ? 'Submitting...' : 'Submit task'}
                  </Button>
                  {!reviewRequired && (
                    <Button
                      variant='outline'
                      onClick={() => {
                        setAnswerText('');
                        setFileUrl('');
                        void submitTask();
                      }}
                      disabled={!selectedTask || submitting || taskLocked}
                    >
                      Mark complete
                    </Button>
                  )}
                </div>
              </>
            )}

            {error && <p className='text-sm text-destructive'>{error}</p>}

            {isQuiz ? (
              <Button onClick={submitQuiz} disabled={!selectedTask || submitting || quizLocked}>
                {submitting ? 'Submitting...' : 'Submit quiz'}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
