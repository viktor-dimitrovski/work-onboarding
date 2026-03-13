'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Clock, FileQuestion, PlayCircle, RotateCcw } from 'lucide-react';

interface AvailableTest {
  delivery_id: string;
  title: string;
  description?: string | null;
  test_title: string;
  audience_type: string;
  starts_at?: string | null;
  ends_at?: string | null;
  due_date?: string | null;
  duration_minutes?: number | null;
  attempts_allowed: number;
  attempts_used: number;
  attempt_status: 'not_started' | 'in_progress' | 'completed' | 'passed';
  latest_score_percent?: number | null;
  passed: boolean;
  question_count: number;
  passing_score?: number | null;
  in_progress_attempt_id?: string | null;
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'muted' }> = {
  not_started: { label: 'Not started', variant: 'outline' },
  in_progress: { label: 'In progress', variant: 'secondary' },
  completed: { label: 'Completed', variant: 'default' },
  passed: { label: 'Passed', variant: 'default' },
};

const formatDate = (d?: string | null) => {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return d;
  }
};

export default function MyTestsPage() {
  const { accessToken } = useAuth();
  const [tests, setTests] = useState<AvailableTest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    api.get<{ items: AvailableTest[] }>('/assessments/available', accessToken)
      .then((res) => setTests(res.items))
      .finally(() => setLoading(false));
  }, [accessToken]);

  if (loading) return <LoadingState label='Loading available tests...' />;
  if (tests.length === 0) return <EmptyState title='No tests available' description='There are no assessment tests assigned to you at this time.' />;

  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-2xl font-semibold'>My Tests</h2>
        <p className='text-sm text-muted-foreground'>Assessment tests available to you.</p>
      </div>

      <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
        {tests.map((test) => {
          const status = statusConfig[test.attempt_status] ?? statusConfig.not_started;
          const attemptsLeft = test.attempts_allowed - test.attempts_used;
          const canStart = test.attempt_status !== 'passed' && attemptsLeft > 0;
          const isOverdue = test.due_date && new Date(test.due_date) < new Date();

          return (
            <Card key={test.delivery_id} className='flex flex-col'>
              <CardHeader className='pb-3'>
                <div className='flex items-start justify-between gap-2'>
                  <CardTitle className='text-base leading-snug'>{test.test_title}</CardTitle>
                  <Badge variant={status.variant} className='shrink-0'>{status.label}</Badge>
                </div>
                {test.description && <p className='mt-1 text-xs text-muted-foreground line-clamp-2'>{test.description}</p>}
              </CardHeader>
              <CardContent className='flex flex-1 flex-col'>
                <div className='flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground'>
                  <span className='flex items-center gap-1'>
                    <FileQuestion className='h-3.5 w-3.5' />
                    {test.question_count} questions
                  </span>
                  {test.duration_minutes && (
                    <span className='flex items-center gap-1'>
                      <Clock className='h-3.5 w-3.5' />
                      {test.duration_minutes} min
                    </span>
                  )}
                  {test.passing_score && (
                    <span>Pass: {test.passing_score}%</span>
                  )}
                  <span>{test.attempts_used} / {test.attempts_allowed} attempts used</span>
                </div>

                {test.due_date && (
                  <p className={`mt-2 text-xs ${isOverdue ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
                    Due: {formatDate(test.due_date)}
                  </p>
                )}

                {test.ends_at && (
                  <p className='text-xs text-muted-foreground'>
                    Available until: {formatDate(test.ends_at)}
                  </p>
                )}

                {test.latest_score_percent != null && (
                  <div className='mt-2 flex items-center gap-2'>
                    <span className='text-sm font-semibold'>{Math.round(test.latest_score_percent)}%</span>
                    <Badge variant={test.passed ? 'default' : 'outline'} className={`text-[10px] ${!test.passed ? 'border-red-300 text-red-700' : ''}`}>
                      {test.passed ? 'Passed' : 'Failed'}
                    </Badge>
                  </div>
                )}

                <div className='mt-auto pt-4'>
                  {test.attempt_status === 'in_progress' && test.in_progress_attempt_id ? (
                    <Button asChild className='w-full'>
                      <Link href={`/assessments/take/${test.delivery_id}`}>
                        <PlayCircle className='mr-2 h-4 w-4' />
                        Continue test
                      </Link>
                    </Button>
                  ) : canStart ? (
                    <Button asChild className='w-full'>
                      <Link href={`/assessments/take/${test.delivery_id}`}>
                        {test.attempts_used > 0 ? (
                          <><RotateCcw className='mr-2 h-4 w-4' />Retake test</>
                        ) : (
                          <><PlayCircle className='mr-2 h-4 w-4' />Start test</>
                        )}
                      </Link>
                    </Button>
                  ) : (
                    <Button disabled className='w-full'>No attempts remaining</Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
