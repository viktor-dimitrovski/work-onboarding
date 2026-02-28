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
import { formatPercent } from '@/lib/constants';
import { useAuth } from '@/lib/auth-context';
import type { Assignment } from '@/lib/types';

export default function MyOnboardingListPage() {
  const { accessToken } = useAuth();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      if (!accessToken) return;
      setLoading(true);
      try {
        const response = await api.get<Assignment[]>('/assignments/my', accessToken);
        setAssignments(response || []);
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [accessToken]);

  const { pending, completed } = useMemo(() => {
    const pendingItems = assignments.filter((assignment) => assignment.status !== 'completed');
    const completedItems = assignments.filter((assignment) => assignment.status === 'completed');
    return { pending: pendingItems, completed: completedItems };
  }, [assignments]);

  if (loading) return <LoadingState label='Loading your onboarding tracks...' />;

  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-2xl font-semibold'>My onboarding</h2>
        <p className='text-sm text-muted-foreground'>Your assigned tracks and current progress.</p>
      </div>

      {assignments.length === 0 ? (
        <EmptyState
          title='No onboarding tracks yet'
          description='Once a track is assigned to you, it will appear here.'
        />
      ) : (
        <div className='space-y-6'>
          <Card>
            <CardHeader>
              <CardTitle>Pending</CardTitle>
              <CardDescription>Continue where you left off.</CardDescription>
            </CardHeader>
            <CardContent className='space-y-3'>
              {pending.length === 0 ? (
                <p className='text-sm text-muted-foreground'>No pending tracks.</p>
              ) : (
                pending.map((assignment) => (
                  <div key={assignment.id} className='rounded-md border bg-white p-3'>
                    <div className='flex flex-wrap items-start justify-between gap-3'>
                      <div className='min-w-0 flex-1'>
                        <p className='truncate text-sm font-medium'>{assignment.title}</p>
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
                        <Button size='sm' asChild>
                          <Link href={`/my-onboarding/${assignment.id}`}>Continue</Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Completed</CardTitle>
              <CardDescription>Finished tracks.</CardDescription>
            </CardHeader>
            <CardContent className='space-y-3'>
              {completed.length === 0 ? (
                <p className='text-sm text-muted-foreground'>No completed tracks yet.</p>
              ) : (
                completed.map((assignment) => (
                  <div key={assignment.id} className='rounded-md border bg-white p-3'>
                    <div className='flex flex-wrap items-start justify-between gap-3'>
                      <div className='min-w-0 flex-1'>
                        <p className='truncate text-sm font-medium'>{assignment.title}</p>
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
                          <Link href={`/my-onboarding/${assignment.id}`}>View</Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

