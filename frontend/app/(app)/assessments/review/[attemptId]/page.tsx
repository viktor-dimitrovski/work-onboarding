'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AttemptReview, AttemptReviewQuestion } from '@/lib/types';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  X,
  XCircle,
  Lightbulb,
  Minus,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Option status helpers ────────────────────────────────────────────────────

type OptionState =
  | 'correct-selected'    // user picked it and it's correct  ✓ green
  | 'correct-missed'      // correct but user didn't pick it  → amber hint
  | 'wrong-selected'      // user picked it but it's wrong    ✗ red
  | 'neutral';            // not selected, not correct

function optionState(
  key: string,
  isCorrect: boolean,
  selectedKeys: string[],
): OptionState {
  const selected = selectedKeys.includes(key);
  if (selected && isCorrect) return 'correct-selected';
  if (!selected && isCorrect) return 'correct-missed';
  if (selected && !isCorrect) return 'wrong-selected';
  return 'neutral';
}

// ── Single question review card ──────────────────────────────────────────────

function QuestionCard({ q, number }: { q: AttemptReviewQuestion; number: number }) {
  const isSkipped = q.selected_keys.length === 0;
  const correct = q.is_correct === true;
  const wrong = q.is_correct === false;

  return (
    <div
      className={cn(
        'rounded-2xl border-2 p-4 sm:p-5',
        correct
          ? 'border-emerald-200 bg-emerald-50/40'
          : wrong
            ? 'border-red-200 bg-red-50/40'
            : 'border-slate-200 bg-white',
      )}
    >
      {/* Question header */}
      <div className='mb-3 flex items-start gap-3'>
        {/* Number bubble */}
        <span
          className={cn(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
            correct
              ? 'bg-emerald-500 text-white'
              : wrong
                ? 'bg-red-500 text-white'
                : 'bg-slate-300 text-slate-700',
          )}
        >
          {number}
        </span>

        <div className='min-w-0 flex-1'>
          {/* Result badge */}
          <div className='mb-1.5 flex flex-wrap items-center gap-2'>
            {correct && (
              <span className='inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700'>
                <Check className='h-3 w-3' />
                Correct
              </span>
            )}
            {wrong && (
              <span className='inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-red-700'>
                <X className='h-3 w-3' />
                {isSkipped ? 'Skipped' : 'Incorrect'}
              </span>
            )}
            {q.section && (
              <span className='rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500'>
                {q.section}
              </span>
            )}
            <span className='ml-auto text-[11px] text-muted-foreground'>
              {q.earned_points}/{q.points} pt{q.points !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Prompt */}
          <p className='text-[16px] font-semibold leading-snug text-foreground sm:text-[17px]'>
            {q.prompt}
          </p>
        </div>
      </div>

      {/* Options */}
      <div className='space-y-2 pl-0 sm:pl-10'>
        {q.options.map((opt, optIdx) => {
          const state = optionState(opt.key, opt.is_correct, q.selected_keys);
          const letter = String.fromCharCode(65 + optIdx);

          return (
            <div
              key={opt.key}
              className={cn(
                'flex items-center gap-3 rounded-xl border-2 px-3 py-2.5',
                state === 'correct-selected' &&
                  'border-emerald-400 bg-emerald-50',
                state === 'correct-missed' &&
                  'border-amber-300 bg-amber-50',
                state === 'wrong-selected' &&
                  'border-red-400 bg-red-50',
                state === 'neutral' &&
                  'border-slate-100 bg-slate-50 opacity-60',
              )}
            >
              {/* Letter badge */}
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                  state === 'correct-selected' && 'bg-emerald-500 text-white',
                  state === 'correct-missed'   && 'bg-amber-400 text-white',
                  state === 'wrong-selected'   && 'bg-red-500 text-white',
                  state === 'neutral'          && 'bg-slate-200 text-slate-500',
                )}
              >
                {letter}
              </span>

              {/* Text */}
              <span
                className={cn(
                  'flex-1 text-[15px] leading-snug',
                  state === 'correct-selected' && 'font-semibold text-emerald-800',
                  state === 'correct-missed'   && 'font-semibold text-amber-800',
                  state === 'wrong-selected'   && 'font-semibold text-red-800',
                  state === 'neutral'          && 'text-slate-500',
                )}
              >
                {opt.text}
              </span>

              {/* Icon */}
              <span className='shrink-0'>
                {state === 'correct-selected' && <Check className='h-4 w-4 text-emerald-600' />}
                {state === 'correct-missed'   && <Minus className='h-4 w-4 text-amber-500' />}
                {state === 'wrong-selected'   && <X className='h-4 w-4 text-red-600' />}
              </span>
            </div>
          );
        })}
      </div>

      {/* Explanation */}
      {q.explanation && (
        <div className='mt-3 flex gap-2 rounded-xl bg-blue-50 px-3 py-2.5 text-[13px] text-blue-800 sm:ml-10'>
          <Lightbulb className='mt-0.5 h-4 w-4 shrink-0 text-blue-500' />
          <span>{q.explanation}</span>
        </div>
      )}

      {/* Missed answer hint (if wrong and not skipped) */}
      {wrong && !isSkipped && q.is_correct === false && (
        <p className='mt-2 text-[12px] text-amber-700 sm:pl-10'>
          Highlighted in amber: the correct answer{q.options.filter((o) => o.is_correct).length > 1 ? 's' : ''} you missed.
        </p>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AttemptReviewPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const { accessToken } = useAuth();
  const router = useRouter();

  const [review, setReview] = useState<AttemptReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken || !attemptId) return;
    setLoading(true);
    api
      .get<AttemptReview>(`/assessments/attempts/${attemptId}/review`, accessToken)
      .then(setReview)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load review'))
      .finally(() => setLoading(false));
  }, [accessToken, attemptId]);

  if (loading) {
    return (
      <div className='flex min-h-[60vh] items-center justify-center'>
        <div className='flex flex-col items-center gap-3'>
          <div className='h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent' />
          <p className='text-sm text-muted-foreground'>Loading review…</p>
        </div>
      </div>
    );
  }

  if (error || !review) {
    return (
      <div className='flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4'>
        <p className='text-sm text-destructive'>{error ?? 'Review not available.'}</p>
        <Button variant='outline' onClick={() => router.back()}>
          <ArrowLeft className='mr-2 h-4 w-4' />
          Go back
        </Button>
      </div>
    );
  }

  const scorePct = review.score_percent != null ? Math.round(review.score_percent) : null;
  const correctCount = review.questions.filter((q) => q.is_correct === true).length;
  const wrongCount = review.questions.filter((q) => q.is_correct === false).length;
  const total = review.questions.length;

  return (
    <div className='mx-auto max-w-2xl px-4 py-6 sm:px-0 sm:py-8'>
      {/* ── Summary header ── */}
      <div className='mb-6 rounded-2xl border bg-white p-5 shadow-sm'>
        <div className='flex items-center gap-3'>
          <div
            className={cn(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-full',
              review.passed ? 'bg-emerald-100' : 'bg-red-100',
            )}
          >
            {review.passed ? (
              <CheckCircle2 className='h-6 w-6 text-emerald-600' />
            ) : (
              <XCircle className='h-6 w-6 text-red-600' />
            )}
          </div>

          <div className='min-w-0 flex-1'>
            <p className='text-xl font-bold'>
              {scorePct != null ? `${scorePct}%` : '—'}
              <span
                className={cn(
                  'ml-2 text-sm font-semibold',
                  review.passed ? 'text-emerald-600' : 'text-red-600',
                )}
              >
                {review.passed ? 'Passed' : 'Failed'}
              </span>
            </p>
            <p className='text-[13px] text-muted-foreground'>
              {review.score ?? 0} / {review.max_score ?? 0} points
              {' · '}
              <span className='text-emerald-700'>{correctCount} correct</span>
              {' · '}
              <span className='text-red-600'>{wrongCount} wrong</span>
            </p>
          </div>

          <Button variant='outline' size='sm' onClick={() => router.back()}>
            <ArrowLeft className='mr-1.5 h-3.5 w-3.5' />
            Back
          </Button>
        </div>

        {/* Overall progress bar */}
        {total > 0 && (
          <div className='mt-4'>
            <Progress value={(correctCount / total) * 100} className='h-2 rounded-full' />
            <div className='mt-1.5 flex justify-between text-[11px] text-muted-foreground'>
              <span>{correctCount}/{total} correct</span>
              <span>{wrongCount}/{total} incorrect</span>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className='mt-4 flex flex-wrap gap-4 border-t pt-3 text-[12px]'>
          <span className='flex items-center gap-1.5'>
            <span className='h-3 w-3 rounded-sm bg-emerald-400' />
            <span className='text-muted-foreground'>Your answer — correct</span>
          </span>
          <span className='flex items-center gap-1.5'>
            <span className='h-3 w-3 rounded-sm bg-red-400' />
            <span className='text-muted-foreground'>Your answer — wrong</span>
          </span>
          <span className='flex items-center gap-1.5'>
            <span className='h-3 w-3 rounded-sm bg-amber-400' />
            <span className='text-muted-foreground'>Correct answer you missed</span>
          </span>
        </div>
      </div>

      {/* ── Question list ── */}
      <div className='space-y-4'>
        {review.questions.map((q) => (
          <QuestionCard key={q.index} q={q} number={q.index + 1} />
        ))}
      </div>

      {/* ── Bottom back button ── */}
      <div className='mt-8 flex justify-center'>
        <Button variant='outline' onClick={() => router.back()}>
          <ArrowLeft className='mr-2 h-4 w-4' />
          Back
        </Button>
      </div>
    </div>
  );
}
