'use client';

import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AssessmentAttempt } from '@/lib/types';

interface ResultsResponse {
  items: AssessmentAttempt[];
  summary: {
    delivery_id?: string | null;
    test_id?: string | null;
    user_id?: string | null;
    attempt_count: number;
    average_score_percent?: number | null;
  };
}

export default function AssessmentResultsPage() {
  const { accessToken } = useAuth();
  const [results, setResults] = useState<ResultsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const response = await api.get<ResultsResponse>('/assessments/results', accessToken);
      setResults(response);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accessToken]);

  if (loading) return <LoadingState label='Loading results...' />;
  if (!results || results.items.length === 0) {
    return <EmptyState title='No results yet' description='Assessment attempts will appear here once submitted.' />;
  }

  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-2xl font-semibold'>Results</h2>
        <p className='text-sm text-muted-foreground'>Latest assessment performance.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent className='text-sm text-muted-foreground'>
          <p>Attempts: {results.summary.attempt_count}</p>
          <p>
            Average score:{' '}
            {results.summary.average_score_percent !== null && results.summary.average_score_percent !== undefined
              ? `${Math.round(results.summary.average_score_percent)}%`
              : 'n/a'}
          </p>
        </CardContent>
      </Card>

      <div className='grid gap-4 md:grid-cols-2'>
        {results.items.map((attempt) => (
          <Card key={attempt.id}>
            <CardHeader>
              <CardTitle className='text-base'>Attempt {attempt.attempt_number}</CardTitle>
            </CardHeader>
            <CardContent className='text-xs text-muted-foreground'>
              <p>Status: {attempt.status}</p>
              <p>Score: {attempt.score_percent ? `${Math.round(attempt.score_percent)}%` : 'n/a'}</p>
              <p>Started: {attempt.started_at}</p>
              {attempt.submitted_at && <p>Submitted: {attempt.submitted_at}</p>}
              {attempt.passed && <Badge className='mt-2'>Passed</Badge>}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
