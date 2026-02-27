'use client';

import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { StatusChip } from '@/components/common/status-chip';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { Assignment, AssignmentTask, QuizAttempt } from '@/lib/types';

export default function MyOnboardingPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { accessToken } = useAuth();

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [selectedTask, setSelectedTask] = useState<AssignmentTask | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number[]>>({});
  const [quizAttempts, setQuizAttempts] = useState<QuizAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextTask = useMemo(
    () => assignment?.phases.flatMap((phase) => phase.tasks).find((task) => task.is_next_recommended) || null,
    [assignment],
  );

  const load = async () => {
    if (!accessToken || !assignmentId) return;
    setLoading(true);
    try {
      const response = await api.get<Assignment>(`/assignments/${assignmentId}`, accessToken);
      setAssignment(response);
      if (!selectedTask) {
        const firstTask = response.phases.flatMap((phase) => phase.tasks)[0];
        setSelectedTask(firstTask || null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accessToken, assignmentId]);

  useEffect(() => {
    setAnswerText('');
    setFileUrl('');
    setQuizAnswers({});
    setError(null);
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

  const submitTask = async () => {
    if (!accessToken || !assignmentId || !selectedTask) return;
    setSubmitting(true);
    setError(null);

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
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to submit task');
    } finally {
      setSubmitting(false);
    }
  };

  const submitQuiz = async () => {
    if (!accessToken || !assignmentId || !selectedTask) return;
    setSubmitting(true);
    setError(null);

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
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to submit quiz');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingState label='Loading onboarding flow...' />;
  if (!assignment) return <EmptyState title='Assignment not found' description='You do not have access to this onboarding assignment.' />;

  const isQuiz = selectedTask?.task_type === 'quiz';
  const isAssessment = selectedTask?.task_type === 'assessment_test';
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

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle>{assignment.title}</CardTitle>
          <CardDescription>
            Follow phases in order. Mentor approvals will appear in your review queue automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {nextTask ? (
            <div className='flex items-center justify-between rounded-md border bg-muted/30 p-3'>
              <div>
                <p className='font-medium'>Next recommended task</p>
                <p className='text-sm'>{nextTask.title}</p>
              </div>
              <StatusChip status={nextTask.status} />
            </div>
          ) : (
            <EmptyState title='No next task' description='All required tasks may be completed.' />
          )}
        </CardContent>
      </Card>

      <div className='grid gap-6 lg:grid-cols-[1.2fr,1fr]'>
        <Card>
          <CardHeader>
            <CardTitle>Phase timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type='multiple' className='space-y-2'>
              {assignment.phases
                .slice()
                .sort((a, b) => a.order_index - b.order_index)
                .map((phase) => (
                  <AccordionItem key={phase.id} value={phase.id} className='rounded-md border px-3'>
                    <AccordionTrigger>
                      <div>
                        <p>{phase.title}</p>
                        <p className='text-xs text-muted-foreground'>{phase.tasks.length} tasks</p>
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
                              className={`w-full rounded-md border p-3 text-left transition ${
                                selectedTask?.id === task.id
                                  ? 'border-primary bg-secondary/70'
                                  : 'bg-muted/30 hover:border-primary/40'
                              }`}
                              onClick={() => setSelectedTask(task)}
                            >
                              <div className='flex items-center justify-between'>
                                <p className='font-medium'>{task.title}</p>
                                <StatusChip status={task.status} />
                              </div>
                              <p className='mt-1 text-xs text-muted-foreground'>{task.instructions || 'No instructions'}</p>
                            </button>
                          ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
            </Accordion>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{isQuiz ? 'Complete quiz' : 'Submit selected task'}</CardTitle>
            <CardDescription>{selectedTask?.title || 'Choose a task from the phase timeline.'}</CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            {isAssessment ? (
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
              </>
            )}

            {error && <p className='text-sm text-destructive'>{error}</p>}

            {!isQuiz && (
              <div className='rounded-md border border-muted bg-muted/30 px-3 py-2 text-xs text-muted-foreground'>
                <p className='font-medium text-foreground/80'>Submit vs Mark complete</p>
                <p className='mt-1'>
                  <strong>Submit task</strong> = complete the task and save your response/evidence.{' '}
                  <strong>Mark complete</strong> = complete the task without adding any response or file link. Both use
                  the same submit; only the payload (with or without text/URL) differs.
                </p>
                <p className='mt-1'>
                  &quot;Mark complete&quot; is only shown for task types that don&apos;t require mentor review (e.g.
                  read_material, checklist, video). For mentor_approval, code_assignment, or file_upload you only get
                  &quot;Submit for review&quot;, and the mentor must approve before the task is fully complete.
                </p>
              </div>
            )}

            {isQuiz ? (
              <Button onClick={submitQuiz} disabled={!selectedTask || submitting || quizLocked}>
                {submitting ? 'Submitting...' : 'Submit quiz'}
              </Button>
            ) : (
              <div className='flex flex-wrap gap-2'>
                <Button onClick={submitTask} disabled={!selectedTask || submitting || taskLocked}>
                  {submitting ? 'Submitting...' : reviewRequired ? 'Submit for review' : 'Submit task'}
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
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
