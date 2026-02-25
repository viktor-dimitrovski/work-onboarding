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
import type { Assignment } from '@/lib/types';

interface AssignmentListResponse {
  items: Assignment[];
  meta: { page: number; page_size: number; total: number };
}

export default function AssignmentsPage() {
  const { accessToken } = useAuth();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);

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
        <Button asChild>
          <Link href='/assignments/new'>New assignment</Link>
        </Button>
      </div>

      {assignments.length === 0 ? (
        <EmptyState title='No assignments' description='Assign a published track to an employee to start onboarding.' />
      ) : (
        <div className='space-y-3'>
          {assignments.map((assignment) => (
            <Card key={assignment.id}>
              <CardHeader>
                <div className='flex items-center justify-between'>
                  <CardTitle>{assignment.title}</CardTitle>
                  <StatusChip status={assignment.status} />
                </div>
                <CardDescription>
                  Start {assignment.start_date} • Target {assignment.target_date}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className='flex items-center gap-3'>
                  <Progress value={assignment.progress_percent} className='flex-1' />
                  <span className='w-12 text-right text-xs text-muted-foreground'>
                    {formatPercent(assignment.progress_percent)}
                  </span>
                  <Button variant='outline' asChild>
                    <Link href={`/assignments/${assignment.id}`}>Open</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
