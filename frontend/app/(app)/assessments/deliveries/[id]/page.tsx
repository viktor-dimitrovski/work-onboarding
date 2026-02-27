'use client';

import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AssessmentAttemptStart } from '@/lib/types';

export default function AssessmentDeliveryAttemptPage() {
  const { id } = useParams<{ id: string }>();
  const { accessToken } = useAuth();

  const [loading, setLoading] = useState(true);
  const [attemptPayload, setAttemptPayload] = useState<AssessmentAttemptStart | null>(null);
  const [answers, setAnswers] = useState<Record<number, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ score: number; maxScore: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const attemptId = attemptPayload?.attempt.id;

  const load = async () => {
    if (!accessToken || !id) return;
    setLoading(true);
    try {
      const response = await api.post<AssessmentAttemptStart>(`/assessments/deliveries/${id}/attempts/start`, {}, accessToken);
      setAttemptPayload(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start assessment');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accessToken, id]);

  const answerList = useMemo(() => {
    return Object.entries(answers).map(([key, value]) => ({
      question_index: Number(key),
      selected_option_keys: value,
    }));
  }, [answers]);

  useEffect(() => {
    if (!attemptId || answerList.length === 0) return;
    const handler = setTimeout(async () => {
      if (!accessToken) return;
      setSaving(true);
      try {
        await api.put(`/assessments/attempts/${attemptId}/answers`, { answers: answerList }, accessToken);
      } finally {
        setSaving(false);
      }
    }, 700);

    return () => clearTimeout(handler);
  }, [attemptId, answerList, accessToken]);

  if (loading) return <LoadingState label='Loading assessment...' />;
  if (!attemptPayload) return <EmptyState title='Assessment unavailable' description={error || 'No assessment found.'} />;

  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-2xl font-semibold'>Assessment</h2>
        <p className='text-sm text-muted-foreground'>Attempt {attemptPayload.attempt.attempt_number}</p>
      </div>

      {error && <p className='text-sm text-destructive'>{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent className='text-sm text-muted-foreground'>
          <p>State: {attemptPayload.attempt.status}</p>
          {attemptPayload.attempt.expires_at && <p>Expires: {attemptPayload.attempt.expires_at}</p>}
          {saving && <p>Saving answers…</p>}
          {submitResult && (
            <p>
              Score: {Math.round((submitResult.score / submitResult.maxScore) * 100)}% ({submitResult.score}/
              {submitResult.maxScore})
            </p>
          )}
        </CardContent>
      </Card>

      <div className='space-y-4'>
        {attemptPayload.questions.map((question) => (
          <Card key={question.index}>
            <CardHeader>
              <CardTitle className='text-base'>
                {question.index + 1}. {question.prompt}
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-2'>
              {question.options.map((option) => {
                const selected = answers[question.index] || [];
                const isMulti = question.question_type === 'mcq_multi';
                const checked = selected.includes(option.key);
                return (
                  <label key={option.key} className='flex items-center gap-2 text-sm'>
                    <input
                      type={isMulti ? 'checkbox' : 'radio'}
                      checked={checked}
                      name={`question-${question.index}`}
                      onChange={(event) => {
                        setAnswers((prev) => {
                          const current = prev[question.index] || [];
                          if (isMulti) {
                            if (event.target.checked) {
                              return { ...prev, [question.index]: [...current, option.key] };
                            }
                            return {
                              ...prev,
                              [question.index]: current.filter((key) => key !== option.key),
                            };
                          }
                          return { ...prev, [question.index]: [option.key] };
                        });
                      }}
                    />
                    {option.text}
                  </label>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className='flex flex-wrap gap-2'>
        <Button
          onClick={async () => {
            if (!attemptId || !accessToken) return;
            setSubmitting(true);
            setError(null);
            try {
              const response = await api.post<{ attempt: { score: number; max_score: number } }>(
                `/assessments/attempts/${attemptId}/submit`,
                {},
                accessToken,
              );
              setSubmitResult({
                score: response.attempt.score,
                maxScore: response.attempt.max_score,
              });
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Failed to submit');
            } finally {
              setSubmitting(false);
            }
          }}
          disabled={submitting}
        >
          {submitting ? 'Submitting…' : 'Submit assessment'}
        </Button>
      </div>
    </div>
  );
}
