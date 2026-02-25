'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { StatusChip } from '@/components/common/status-chip';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import { formatPercent } from '@/lib/constants';
import { useAuth } from '@/lib/auth-context';
import type { Assignment } from '@/lib/types';

export default function AssignmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { accessToken, user } = useAuth();

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [workingTaskId, setWorkingTaskId] = useState<string | null>(null);

  const canReview = useMemo(
    () => !!user?.roles.some((role) => ['mentor', 'admin', 'super_admin', 'reviewer'].includes(role)),
    [user?.roles],
  );

  const load = async () => {
    if (!accessToken || !id) return;
    setLoading(true);
    try {
      setAssignment(await api.get<Assignment>(`/assignments/${id}`, accessToken));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accessToken, id]);

  const reviewTask = async (taskId: string, decision: 'approve' | 'reject' | 'revision_requested') => {
    if (!accessToken || !id) return;
    setWorkingTaskId(taskId);
    try {
      await api.post(`/progress/assignments/${id}/tasks/${taskId}/review`, {
        decision,
        comment:
          decision === 'approve'
            ? 'Approved by mentor in assignment review panel.'
            : decision === 'reject'
              ? 'Rejected. Please revise and resubmit.'
              : 'Revision requested. Address comments and retry.',
      }, accessToken);
      await load();
    } finally {
      setWorkingTaskId(null);
    }
  };

  if (loading) return <LoadingState label='Loading assignment...' />;
  if (!assignment) return <EmptyState title='Assignment not found' description='This onboarding assignment does not exist.' />;

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <div>
              <CardTitle>{assignment.title}</CardTitle>
              <CardDescription>
                Start {assignment.start_date} • Target {assignment.target_date}
              </CardDescription>
            </div>
            <StatusChip status={assignment.status} />
          </div>
        </CardHeader>
        <CardContent>
          <div className='flex items-center gap-3'>
            <Progress value={assignment.progress_percent} className='flex-1' />
            <span className='w-12 text-right text-xs text-muted-foreground'>
              {formatPercent(assignment.progress_percent)}
            </span>
            <Button variant='outline' asChild>
              <Link href={`/my-onboarding/${assignment.id}`}>Employee flow</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Phase timeline</CardTitle>
          <CardDescription>Task execution and mentor review workflow.</CardDescription>
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
                      <p className='text-xs text-muted-foreground'>
                        {phase.tasks.length} tasks • {formatPercent(phase.progress_percent)} complete
                      </p>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className='space-y-2'>
                      {phase.tasks
                        .slice()
                        .sort((a, b) => a.order_index - b.order_index)
                        .map((task) => (
                          <div key={task.id} className='rounded-md border bg-muted/30 p-3'>
                            <div className='flex flex-wrap items-center justify-between gap-3'>
                              <div>
                                <p className='font-medium'>{task.title}</p>
                                <p className='text-xs text-muted-foreground'>
                                  {task.task_type} • due {task.due_date || 'n/a'}
                                </p>
                              </div>
                              <StatusChip status={task.status} />
                            </div>

                            {canReview && task.status === 'pending_review' && (
                              <div className='mt-3 flex flex-wrap gap-2'>
                                <Button
                                  size='sm'
                                  onClick={() => {
                                    void reviewTask(task.id, 'approve');
                                  }}
                                  disabled={workingTaskId === task.id}
                                >
                                  Approve
                                </Button>
                                <Button
                                  size='sm'
                                  variant='secondary'
                                  onClick={() => {
                                    void reviewTask(task.id, 'revision_requested');
                                  }}
                                  disabled={workingTaskId === task.id}
                                >
                                  Request revision
                                </Button>
                                <Button
                                  size='sm'
                                  variant='destructive'
                                  onClick={() => {
                                    void reviewTask(task.id, 'reject');
                                  }}
                                  disabled={workingTaskId === task.id}
                                >
                                  Reject
                                </Button>
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
