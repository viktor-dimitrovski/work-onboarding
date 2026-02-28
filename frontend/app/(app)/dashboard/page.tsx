'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { StatusChip } from '@/components/common/status-chip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import { formatDateTime, formatPercent, shortId } from '@/lib/constants';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import type {
  AdminDashboardReport,
  Assignment,
  EmployeeDashboardReport,
  MentorDashboardReport,
} from '@/lib/types';

interface AssignmentListResponse {
  items: Assignment[];
  meta: { page: number; page_size: number; total: number };
}

interface NextTaskResponse {
  assignment_id: string;
  task: {
    id: string;
    title: string;
    status: string;
  } | null;
}

export default function DashboardPage() {
  const { accessToken } = useAuth();
  const { context: tenantContext } = useTenant();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [reportData, setReportData] = useState<
    AdminDashboardReport | EmployeeDashboardReport | MentorDashboardReport | null
  >(null);
  const [nextTask, setNextTask] = useState<NextTaskResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const primaryRole = useMemo(() => {
    const role = tenantContext?.role;
    if (role === 'tenant_admin' || role === 'manager') return 'admin';
    if (role === 'mentor') return 'mentor';
    return 'employee';
  }, [tenantContext?.role]);

  useEffect(() => {
    const run = async () => {
      if (!accessToken) {
        return;
      }
      setLoading(true);

      try {
        const assignmentResponse = await api.get<AssignmentListResponse>('/assignments?page=1&page_size=5', accessToken);
        setAssignments(assignmentResponse.items);

        if (primaryRole === 'admin') {
          setReportData(await api.get<AdminDashboardReport>('/reports/admin-dashboard', accessToken));
        } else if (primaryRole === 'mentor') {
          setReportData(await api.get<MentorDashboardReport>('/reports/mentor-dashboard', accessToken));
        } else {
          setReportData(await api.get<EmployeeDashboardReport>('/reports/employee-dashboard', accessToken));
        }

        if (primaryRole === 'employee' && assignmentResponse.items[0]) {
          setNextTask(
            await api.get<NextTaskResponse>(
              `/progress/assignments/${assignmentResponse.items[0].id}/next-task`,
              accessToken,
            ),
          );
        }
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [accessToken, primaryRole]);

  if (loading) {
    return <LoadingState label='Loading dashboard...' />;
  }

  return (
    <div className='space-y-6'>
      <section className='grid gap-4 md:grid-cols-4'>
        {primaryRole === 'admin' && reportData && 'active_onboardings' in reportData && (
          <>
            <MetricCard title='Active onboardings' value={String(reportData.active_onboardings)} />
            <MetricCard title='Completion rate' value={`${reportData.completion_rate_percent.toFixed(1)}%`} />
            <MetricCard title='Overdue tasks' value={String(reportData.overdue_tasks)} />
            <MetricCard title='Approval queue' value={String(reportData.mentor_approval_queue)} />
          </>
        )}

        {primaryRole === 'mentor' && reportData && 'mentee_count' in reportData && (
          <>
            <MetricCard title='Assigned mentees' value={String(reportData.mentee_count)} />
            <MetricCard title='Pending reviews' value={String(reportData.pending_reviews)} />
            <MetricCard title='Recent feedback' value={String(reportData.recent_feedback)} />
            <PendingApprovalHint count={reportData.pending_reviews} />
          </>
        )}

        {primaryRole === 'employee' && reportData && 'assignment_count' in reportData && (
          <>
            <MetricCard title='Assigned tracks' value={String(reportData.assignment_count)} />
            <MetricCard title='Upcoming tasks' value={String(reportData.upcoming_tasks)} />
            <MetricCard title='Overdue tasks' value={String(reportData.overdue_tasks)} />
            <MetricCard
              title='Avg progress'
              value={`${reportData.average_progress_percent.toFixed(1)}%`}
            />
          </>
        )}
      </section>

      {primaryRole === 'employee' && (
        <Card>
          <CardHeader>
            <CardTitle>Next task</CardTitle>
            <CardDescription>Your recommended next step in the onboarding flow.</CardDescription>
          </CardHeader>
          <CardContent>
            {nextTask?.task ? (
              <div className='flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3'>
                <div>
                  <p className='font-medium'>{nextTask.task.title}</p>
                  <p className='text-xs text-muted-foreground'>Task ID: {nextTask.task.id}</p>
                </div>
                <div className='flex items-center gap-3'>
                  <StatusChip status={nextTask.task.status} />
                  <Button asChild>
                    <Link href={`/my-onboarding/${nextTask.assignment_id}`}>Open flow</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <EmptyState title='No pending tasks' description='Your onboarding tasks are complete or not started yet.' />
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent assignments</CardTitle>
          <CardDescription>Latest onboarding assignments visible to your role.</CardDescription>
        </CardHeader>
        <CardContent>
          {assignments.length === 0 ? (
            <EmptyState title='No assignments yet' description='Create or assign a published track to get started.' />
          ) : (
            <div className='overflow-hidden rounded-md border bg-white'>
              <div className='divide-y'>
                {assignments.map((assignment) => (
                  <div
                    key={assignment.id}
                    className='flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/20'
                  >
                    <div className='min-w-0 flex-1'>
                      <p className='truncate font-medium'>{assignment.title}</p>
                      <p className='mt-0.5 text-xs text-muted-foreground'>
                        Start {assignment.start_date} • Target {assignment.target_date}
                      </p>
                      <p className='mt-0.5 text-xs text-muted-foreground'>
                        Created {formatDateTime(assignment.created_at)} • By{' '}
                        {assignment.created_by_name || shortId(assignment.created_by)} • Phases{' '}
                        {assignment.phases?.length ?? 0} • Tasks{' '}
                        {assignment.phases?.reduce((sum, phase) => sum + (phase.tasks?.length ?? 0), 0) ?? 0}
                      </p>
                      <div className='mt-2 flex items-center gap-3'>
                        <Progress value={assignment.progress_percent} className='h-2 flex-1' />
                        <span className='w-12 text-right text-xs text-muted-foreground'>
                          {formatPercent(assignment.progress_percent)}
                        </span>
                      </div>
                    </div>
                    <div className='flex items-center gap-2'>
                      <StatusChip status={assignment.status} />
                      <Button variant='outline' size='sm' asChild>
                        <Link href={`/assignments/${assignment.id}`}>View</Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className='text-2xl'>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function PendingApprovalHint({ count }: { count: number }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>Pending approvals</CardDescription>
        <CardTitle className='text-lg'>{count} tasks waiting for review</CardTitle>
      </CardHeader>
    </Card>
  );
}
