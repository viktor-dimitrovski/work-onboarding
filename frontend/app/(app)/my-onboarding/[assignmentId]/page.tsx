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
import type { Assignment, AssignmentTask } from '@/lib/types';

export default function MyOnboardingPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { accessToken } = useAuth();

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [selectedTask, setSelectedTask] = useState<AssignmentTask | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [fileUrl, setFileUrl] = useState('');
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

  if (loading) return <LoadingState label='Loading onboarding flow...' />;
  if (!assignment) return <EmptyState title='Assignment not found' description='You do not have access to this onboarding assignment.' />;

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
            <CardTitle>Submit selected task</CardTitle>
            <CardDescription>{selectedTask?.title || 'Choose a task from the phase timeline.'}</CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div className='space-y-2'>
              <Label>Response</Label>
              <Textarea
                rows={6}
                placeholder='Describe what you completed, answers, or links to evidence.'
                value={answerText}
                onChange={(event) => setAnswerText(event.target.value)}
              />
            </div>

            <div className='space-y-2'>
              <Label>File URL (optional)</Label>
              <input
                value={fileUrl}
                onChange={(event) => setFileUrl(event.target.value)}
                placeholder='https://files.example.com/...'
                className='h-10 w-full rounded-md border border-input bg-white px-3 text-sm'
              />
            </div>

            {error && <p className='text-sm text-destructive'>{error}</p>}

            <Button onClick={submitTask} disabled={!selectedTask || submitting}>
              {submitting ? 'Submitting...' : 'Submit task'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
