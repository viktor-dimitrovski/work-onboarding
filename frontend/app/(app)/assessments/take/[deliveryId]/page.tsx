'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AssessmentAttemptStart, AssessmentAttemptQuestion } from '@/lib/types';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, Clock, PlayCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type WizardState = 'loading' | 'start' | 'question' | 'review' | 'result';

export default function TakeTestPage() {
  const { deliveryId } = useParams<{ deliveryId: string }>();
  const { accessToken } = useAuth();
  const router = useRouter();

  const [state, setState] = useState<WizardState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [attemptPayload, setAttemptPayload] = useState<AssessmentAttemptStart | null>(null);
  const [answers, setAnswers] = useState<Record<number, string[]>>({});
  const [currentIdx, setCurrentIdx] = useState(0);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ score: number; max_score: number; score_percent: number; passed: boolean } | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const submittedRef = useRef(false);

  const attemptId = attemptPayload?.attempt.id;
  const questions: AssessmentAttemptQuestion[] = attemptPayload?.questions ?? [];
  const totalQuestions = questions.length;

  const deliveryInfo = useMemo(() => {
    if (!attemptPayload) return null;
    return {
      expiresAt: attemptPayload.attempt.expires_at ? new Date(attemptPayload.attempt.expires_at) : null,
    };
  }, [attemptPayload]);

  const startAttempt = async () => {
    if (!accessToken || !deliveryId) return;
    setState('loading');
    setError(null);
    try {
      const response = await api.post<AssessmentAttemptStart>(
        `/assessments/deliveries/${deliveryId}/attempts/start`,
        {},
        accessToken,
      );
      setAttemptPayload(response);

      if (response.attempt.expires_at) {
        const expiresAt = new Date(response.attempt.expires_at).getTime();
        const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
        setTimeLeft(remaining);
      }

      setAnswers({});
      setCurrentIdx(0);
      setState('question');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start test');
      setState('start');
    }
  };

  useEffect(() => {
    if (!accessToken || !deliveryId) return;
    setState('start');
  }, [accessToken, deliveryId]);

  // Countdown timer
  useEffect(() => {
    if (state !== 'question' && state !== 'review') return;
    if (timeLeft === null) return;

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === null) return null;
        const next = prev - 1;
        if (next <= 0) {
          if (!submittedRef.current) {
            submittedRef.current = true;
            void submitTest();
          }
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state, timeLeft !== null]);

  const autosave = useCallback(
    (newAnswers: Record<number, string[]>) => {
      if (!accessToken || !attemptId) return;
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = setTimeout(async () => {
        const answerList = Object.entries(newAnswers).map(([key, value]) => ({
          question_index: Number(key),
          selected_option_keys: value,
        }));
        try {
          await api.put(`/assessments/attempts/${attemptId}/answers`, { answers: answerList }, accessToken);
        } catch {
          // silent
        }
      }, 500);
    },
    [accessToken, attemptId],
  );

  const selectAnswer = (questionIndex: number, optionKey: string, isMulti: boolean) => {
    setAnswers((prev) => {
      const current = prev[questionIndex] || [];
      let next: string[];
      if (isMulti) {
        next = current.includes(optionKey) ? current.filter((k) => k !== optionKey) : [...current, optionKey];
      } else {
        next = [optionKey];
      }
      const updated = { ...prev, [questionIndex]: next };
      autosave(updated);
      return updated;
    });
  };

  const submitTest = async () => {
    if (!accessToken || !attemptId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await api.post<{ attempt: { score: number; max_score: number; score_percent: number; passed: boolean } }>(
        `/assessments/attempts/${attemptId}/submit`,
        {},
        accessToken,
      );
      setResult(response.attempt);
      setState('result');
      if (timerRef.current) clearInterval(timerRef.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit test');
    } finally {
      setSubmitting(false);
    }
  };

  const answeredCount = Object.keys(answers).length;
  const unanswered = questions.filter((q) => !answers[q.index] || answers[q.index].length === 0);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const timerColorClass = timeLeft !== null && timeLeft > 0
    ? timeLeft <= 60
      ? 'text-red-600 bg-red-50'
      : timeLeft <= 300
        ? 'text-amber-600 bg-amber-50'
        : 'text-muted-foreground bg-muted/30'
    : '';

  // ── START SCREEN ──
  if (state === 'loading') {
    return (
      <div className='flex min-h-[60vh] items-center justify-center'>
        <p className='text-muted-foreground'>Loading...</p>
      </div>
    );
  }

  if (state === 'start') {
    return (
      <div className='mx-auto max-w-lg py-12'>
        <Card>
          <CardHeader className='text-center'>
            <div className='mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10'>
              <PlayCircle className='h-8 w-8 text-primary' />
            </div>
            <CardTitle className='text-2xl'>Ready to begin?</CardTitle>
            <p className='mt-2 text-sm text-muted-foreground'>
              Your test will begin as soon as you click Start. Make sure you have a stable connection.
            </p>
          </CardHeader>
          <CardContent className='space-y-4'>
            {error && <p className='text-sm text-destructive'>{error}</p>}
            <Button className='w-full' size='lg' onClick={startAttempt}>
              <PlayCircle className='mr-2 h-5 w-5' />
              Start Test
            </Button>
            <Button variant='ghost' className='w-full' onClick={() => router.push('/assessments/my-tests')}>
              Back to my tests
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── RESULT SCREEN ──
  if (state === 'result' && result) {
    return (
      <div className='mx-auto max-w-lg py-12'>
        <Card>
          <CardHeader className='text-center'>
            <div className={cn('mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full', result.passed ? 'bg-emerald-100' : 'bg-red-100')}>
              {result.passed ? <CheckCircle2 className='h-10 w-10 text-emerald-600' /> : <XCircle className='h-10 w-10 text-red-600' />}
            </div>
            <CardTitle className='text-3xl'>
              {result.passed ? 'Passed!' : 'Not passed'}
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-6 text-center'>
            <div>
              <p className='text-5xl font-bold tabular-nums'>{Math.round(result.score_percent)}%</p>
              <p className='mt-1 text-sm text-muted-foreground'>
                {result.score} / {result.max_score} points
              </p>
            </div>
            <div className='flex justify-center gap-3'>
              <Button variant='outline' onClick={() => router.push('/assessments/my-tests')}>
                Back to my tests
              </Button>
              <Button variant='outline' onClick={() => router.push('/assessments/results')}>
                View results
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── REVIEW SCREEN ──
  if (state === 'review') {
    return (
      <div className='mx-auto max-w-2xl py-8'>
        <div className='mb-6 flex items-center justify-between'>
          <h2 className='text-xl font-semibold'>Review your answers</h2>
          {timeLeft !== null && timeLeft > 0 && (
            <div className={cn('flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-mono font-semibold', timerColorClass)}>
              <Clock className='h-4 w-4' />
              {formatTime(timeLeft)}
            </div>
          )}
        </div>

        {unanswered.length > 0 && (
          <div className='mb-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800'>
            <AlertTriangle className='h-4 w-4' />
            {unanswered.length} question{unanswered.length !== 1 ? 's' : ''} unanswered
          </div>
        )}

        <div className='space-y-2'>
          {questions.map((q) => {
            const answered = answers[q.index] && answers[q.index].length > 0;
            return (
              <button
                key={q.index}
                type='button'
                className='flex w-full items-center gap-3 rounded-md border bg-white p-3 text-left hover:border-primary/40'
                onClick={() => { setCurrentIdx(q.index); setState('question'); }}
              >
                <span className='flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium'>
                  {q.index + 1}
                </span>
                <p className='min-w-0 flex-1 truncate text-sm'>{q.prompt}</p>
                {answered ? (
                  <Badge variant='secondary' className='shrink-0'><Check className='mr-1 h-3 w-3' />Answered</Badge>
                ) : (
                  <Badge variant='outline' className='shrink-0 text-amber-600 border-amber-300'>Unanswered</Badge>
                )}
              </button>
            );
          })}
        </div>

        <div className='mt-6 flex gap-3'>
          <Button variant='outline' onClick={() => setState('question')}>
            <ArrowLeft className='mr-2 h-4 w-4' />
            Back to questions
          </Button>
          <Button onClick={submitTest} disabled={submitting} className='flex-1'>
            {submitting ? 'Submitting…' : `Submit test (${answeredCount}/${totalQuestions} answered)`}
          </Button>
        </div>

        {error && <p className='mt-3 text-sm text-destructive'>{error}</p>}
      </div>
    );
  }

  // ── QUESTION SCREEN ──
  const question = questions[currentIdx];
  if (!question) return null;

  const isMulti = question.question_type === 'mcq_multi';
  const selectedKeys = answers[question.index] || [];
  const progressPct = totalQuestions > 0 ? ((currentIdx + 1) / totalQuestions) * 100 : 0;

  return (
    <div className='mx-auto max-w-3xl py-8'>
      {/* Top bar */}
      <div className='mb-6 flex items-center justify-between gap-4'>
        <div className='flex items-center gap-3'>
          <span className='text-sm font-medium text-muted-foreground'>
            Question {currentIdx + 1} of {totalQuestions}
          </span>
          <span className='text-xs text-muted-foreground'>{question.points} pt{question.points !== 1 ? 's' : ''}</span>
        </div>
        {timeLeft !== null && timeLeft > 0 && (
          <div className={cn('flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-mono font-semibold', timerColorClass)}>
            <Clock className='h-4 w-4' />
            {formatTime(timeLeft)}
          </div>
        )}
      </div>

      <Progress value={progressPct} className='mb-6 h-1.5' />

      {/* Question */}
      <Card className='mb-6'>
        <CardHeader>
          <CardTitle className='text-lg leading-relaxed'>{question.prompt}</CardTitle>
          {isMulti && <p className='mt-1 text-xs text-muted-foreground'>Select all that apply</p>}
        </CardHeader>
        <CardContent className='space-y-3'>
          {question.options.map((option, optIdx) => {
            const isSelected = selectedKeys.includes(option.key);
            const letter = String.fromCharCode(65 + optIdx);
            return (
              <button
                key={option.key}
                type='button'
                onClick={() => selectAnswer(question.index, option.key, isMulti)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border-2 p-4 text-left transition-all',
                  isSelected
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-transparent bg-muted/30 hover:border-muted-foreground/20 hover:bg-muted/50',
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                    isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {letter}
                </span>
                <span className='text-sm'>{option.text}</span>
              </button>
            );
          })}
        </CardContent>
      </Card>

      {/* Navigation dots */}
      <div className='mb-4 flex flex-wrap justify-center gap-1.5'>
        {questions.map((q, idx) => {
          const answered = answers[q.index] && answers[q.index].length > 0;
          return (
            <button
              key={q.index}
              type='button'
              onClick={() => setCurrentIdx(idx)}
              className={cn(
                'h-3 w-3 rounded-full transition-all',
                idx === currentIdx ? 'ring-2 ring-primary ring-offset-2' : '',
                answered ? 'bg-primary' : 'bg-muted-foreground/20',
              )}
              title={`Question ${idx + 1}`}
            />
          );
        })}
      </div>

      {/* Nav buttons */}
      <div className='flex items-center justify-between gap-3'>
        <Button variant='outline' onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))} disabled={currentIdx === 0}>
          <ArrowLeft className='mr-2 h-4 w-4' />
          Previous
        </Button>
        {currentIdx < totalQuestions - 1 ? (
          <Button onClick={() => setCurrentIdx((i) => Math.min(totalQuestions - 1, i + 1))}>
            Next
            <ArrowRight className='ml-2 h-4 w-4' />
          </Button>
        ) : (
          <Button onClick={() => setState('review')}>
            Review & Submit
            <ArrowRight className='ml-2 h-4 w-4' />
          </Button>
        )}
      </div>

      {error && <p className='mt-3 text-sm text-destructive'>{error}</p>}
    </div>
  );
}
