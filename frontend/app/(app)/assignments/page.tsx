'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { StatusChip } from '@/components/common/status-chip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import { formatDateTime, formatPercent, shortId } from '@/lib/constants';
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateId = searchParams.get('template_id');
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const canCreateAssignment = hasModule('assignments') && hasPermission('assignments:write');

  const filteredAssignments = assignments.filter((assignment) => {
    if (templateId && assignment.template_id !== templateId) {
      return false;
    }
    if (statusFilter && assignment.status !== statusFilter) {
      return false;
    }
    if (!query.trim()) {
      return true;
    }
    const needle = query.trim().toLowerCase();
    return (
      assignment.title.toLowerCase().includes(needle) ||
      (assignment.created_by_name || '').toLowerCase().includes(needle) ||
      (assignment.purpose || '').toLowerCase().includes(needle)
    );
  });

  const templateFilterLabel = useMemo(() => (templateId ? shortId(templateId) : null), [templateId]);

  useEffect(() => {
    const run = async () => {
      if (!accessToken) return;
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('page', '1');
        params.set('page_size', '100');
        if (statusFilter) {
          params.set('status', statusFilter);
        }
        const response = await api.get<AssignmentListResponse>(`/assignments?${params.toString()}`, accessToken);
        setAssignments(response.items);
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [accessToken, statusFilter]);

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

      <div className='flex flex-wrap items-center gap-2'>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder='Search by assignment, purpose, or creator...'
          className='max-w-sm'
        />
        {templateId ? (
          <div className='flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm'>
            <span className='text-xs text-muted-foreground'>Track:</span>
            <span className='text-xs font-medium'>{templateFilterLabel}</span>
            <Button
              type='button'
              size='sm'
              variant='ghost'
              onClick={() => router.push('/assignments')}
              className='h-7 px-2'
            >
              Clear
            </Button>
          </div>
        ) : null}
        <select
          className='h-10 rounded-md border border-input bg-white px-3 text-sm'
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value=''>All statuses</option>
          <option value='not_started'>Not started</option>
          <option value='in_progress'>In progress</option>
          <option value='blocked'>Blocked</option>
          <option value='overdue'>Overdue</option>
          <option value='completed'>Completed</option>
          <option value='archived'>Archived</option>
        </select>
        {(query || statusFilter) && (
          <Button
            type='button'
            variant='ghost'
            onClick={() => {
              setQuery('');
              setStatusFilter('');
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {filteredAssignments.length === 0 ? (
        <EmptyState title='No assignments' description='Assign a published track to an employee to start onboarding.' />
      ) : (
        <Card className='overflow-hidden'>
          <CardContent className='p-0'>
            <div className='divide-y'>
              {filteredAssignments.map((assignment) => {
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
                      <p className='mt-0.5 text-xs text-muted-foreground'>
                        Created {formatDateTime(assignment.created_at)} • By{' '}
                        {assignment.created_by_email || assignment.created_by_name || shortId(assignment.created_by)} •
                        Phases {assignment.phases?.length ?? 0} • Tasks{' '}
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
