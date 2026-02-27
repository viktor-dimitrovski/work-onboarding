'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { StatusChip } from '@/components/common/status-chip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import { formatPercent } from '@/lib/constants';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import type { Assignment } from '@/lib/types';
import { cn } from '@/lib/utils';

interface AssignmentListResponse {
  items: Assignment[];
  meta: { page: number; page_size: number; total: number };
}

export default function AssignmentsPage() {
  const { accessToken } = useAuth();
  const { hasModule, hasPermission } = useTenant();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const canCreateAssignment = hasModule('assignments') && hasPermission('assignments:write');

  useEffect(() => {
    const run = async () => {
      if (!accessToken) return;
      setLoading(true);
      try {
        const response = await api.get<AssignmentListResponse>('/assignments?page=1&page_size=100', accessToken);
        setAssignments(response.items);
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [accessToken]);

  if (loading) return <LoadingState label='Loading assignments...' />;

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-2xl font-semibold'>Assignments</h2>
          <p className='text-sm text-muted-foreground'>Track active onboarding instances and statuses.</p>
        </div>
        {canCreateAssignment && (
          <Button asChild>
            <Link href='/assignments/new'>New assignment</Link>
          </Button>
        )}
      </div>

      {assignments.length === 0 ? (
        <EmptyState title='No assignments' description='Assign a published track to an employee to start onboarding.' />
      ) : (
        <Card className='overflow-hidden'>
          <CardContent className='p-0'>
            <div className='divide-y'>
              {assignments.map((assignment) => {
                const isCompleted = assignment.status === 'completed';
                return (
                  <div
                    key={assignment.id}
                    className={cn(
                      'flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors',
                      isCompleted ? 'bg-emerald-50/40' : 'bg-white',
                      'hover:bg-muted/20',
                    )}
                  >
                    <div className='min-w-0 flex-1'>
                      <div className='flex flex-wrap items-center gap-2'>
                        <p className={cn('truncate font-medium', isCompleted && 'text-emerald-900')}>{assignment.title}</p>
                        {assignment.purpose && (
                          <span className='text-xs text-muted-foreground'>• {assignment.purpose}</span>
                        )}
                      </div>
                      <p className='mt-0.5 text-xs text-muted-foreground'>
                        Start {assignment.start_date} • Target {assignment.target_date}
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
                        <Link href={`/assignments/${assignment.id}`}>Open</Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
