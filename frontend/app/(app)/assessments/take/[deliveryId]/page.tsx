'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AssessmentAttemptStart, AssessmentAttemptQuestion } from '@/lib/types';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  Clock,
  PlayCircle,
  Star,
  User,
} from 'lucide-react';
import { getStarRating, starArray } from '@/lib/stars';
import { cn } from '@/lib/utils';

type WizardState = 'loading' | 'start' | 'question' | 'review' | 'result';

// ─────────────────────────────────────────────────────────────────────────────
// Full-height shell: header (status) + scrollable body + footer (nav)
// Used for the question and review screens.
// ─────────────────────────────────────────────────────────────────────────────
function ScreenShell({
  header,
  footer,
  children,
}: {
  header: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className='flex h-full min-h-0 flex-col overflow-hidden bg-background'>
      {/* Status header — pinned at top of the layout column */}
      <div className='flex-none'>{header}</div>

      {/* Scrollable body — min-h-0 prevents flex item from exceeding parent height */}
      <div className='min-h-0 flex-1 overflow-y-auto pb-24'>
        {children}
      </div>

      {/* Nav footer — fixed to viewport bottom, immune to any overflow/flex issues */}
      <div className='fixed bottom-0 inset-x-0 z-50'>
        {footer}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Centred scrollable wrapper for start / result screens
// ─────────────────────────────────────────────────────────────────────────────
function CentreScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex h-full flex-col overflow-y-auto'>
      <div className='mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-4 py-8'>
        {children}
      </div>
    </div>
  );
}

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
  const [result, setResult] = useState<{
    score: number;
    max_score: number;
    score_percent: number;
    passed: boolean;
    stars_earned?: number | null;
  } | null>(null);
  const [newAchievements, setNewAchievements] = useState<Array<{ code: string; name: string; icon: string; description: string }>>([]);

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const submittedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const attemptId = attemptPayload?.attempt.id;
  const questions: AssessmentAttemptQuestion[] = attemptPayload?.questions ?? [];
  const totalQuestions = questions.length;

  // ── Derived ────────────────────────────────────────────────────────────────
  const answeredCount = Object.keys(answers).length;
  const unanswered = questions.filter(
    (q) => !answers[q.index] || answers[q.index].length === 0,
  );

  // ── Helpers ────────────────────────────────────────────────────────────────
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const timerCls =
    timeLeft === null || timeLeft <= 0
      ? ''
      : timeLeft <= 60
        ? 'text-red-600 bg-red-50 border border-red-200'
        : timeLeft <= 300
          ? 'text-amber-600 bg-amber-50 border border-amber-200'
          : 'text-slate-600 bg-slate-100';

  // ── Side effects ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!accessToken || !deliveryId) return;
    setState('start');
  }, [accessToken, deliveryId]);

  // Scroll to top when question changes
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [currentIdx]);

  // Countdown
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, timeLeft !== null]);

  // ── API calls ──────────────────────────────────────────────────────────────
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
          await api.put(
            `/assessments/attempts/${attemptId}/answers`,
            { answers: answerList },
            accessToken,
          );
        } catch {
          // silent autosave failure
        }
      }, 500);
    },
    [accessToken, attemptId],
  );

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
        setTimeLeft(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));
      }
      setAnswers({});
      setCurrentIdx(0);
      setState('question');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start test');
      setState('start');
    }
  };

  const submitTest = async () => {
    if (!accessToken || !attemptId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await api.post<{
        attempt: { score: number; max_score: number; score_percent: number; passed: boolean; stars_earned?: number | null };
        stars_earned?: number | null;
        new_achievements?: Array<{ code: string; name: string; icon: string; description: string }>;
      }>(`/assessments/attempts/${attemptId}/submit`, {}, accessToken);
      setResult({ ...response.attempt, stars_earned: response.stars_earned ?? response.attempt.stars_earned });
      setNewAchievements(response.new_achievements ?? []);
      setState('result');
      if (timerRef.current) clearInterval(timerRef.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit test');
    } finally {
      setSubmitting(false);
    }
  };

  const selectAnswer = (questionIndex: number, optionKey: string, isMulti: boolean) => {
    setAnswers((prev) => {
      const current = prev[questionIndex] || [];
      const next = isMulti
        ? current.includes(optionKey)
          ? current.filter((k) => k !== optionKey)
          : [...current, optionKey]
        : [optionKey];
      const updated = { ...prev, [questionIndex]: next };
      autosave(updated);
      return updated;
    });
  };

  // ── LOADING ────────────────────────────────────────────────────────────────
  if (state === 'loading') {
    return (
      <div className='flex h-full items-center justify-center'>
        <div className='flex flex-col items-center gap-3'>
          <div className='h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent' />
          <p className='text-sm text-muted-foreground'>Loading test…</p>
        </div>
      </div>
    );
  }

  // ── START ──────────────────────────────────────────────────────────────────
  if (state === 'start') {
    return (
      <CentreScreen>
        <div className='w-full rounded-2xl border bg-white p-6 shadow-sm sm:p-8'>
          <div className='mb-6 flex flex-col items-center text-center'>
            <div className='mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10'>
              <PlayCircle className='h-8 w-8 text-primary' />
            </div>
            <h1 className='text-xl font-bold sm:text-2xl'>Ready to begin?</h1>
            <p className='mt-2 text-sm text-muted-foreground'>
              Your test will begin immediately. Make sure you have a stable connection.
            </p>
          </div>
          {error && (
            <p className='mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-destructive'>{error}</p>
          )}
          <div className='space-y-3'>
            <Button className='h-12 w-full text-base' onClick={startAttempt}>
              <PlayCircle className='mr-2 h-5 w-5' />
              Start Test
            </Button>
            <Button
              variant='ghost'
              className='w-full'
              onClick={() => router.push('/assessments/my-tests')}
            >
              Back to my tests
            </Button>
          </div>
        </div>
      </CentreScreen>
    );
  }

  // ── RESULT ─────────────────────────────────────────────────────────────────
  if (state === 'result' && result) {
    const stars = result.stars_earned ?? getStarRating(result.score_percent).stars;
    const rating = getStarRating(result.score_percent);
    const starsArr = starArray(stars);

    return (
      <CentreScreen>
        <div className='w-full rounded-2xl border bg-white shadow-sm overflow-hidden'>
          {/* Colored header band */}
          <div className={cn('px-6 pt-8 pb-6 text-center', rating.bgColor)}>
            {/* Animated star row */}
            <div className='flex items-center justify-center gap-2 mb-3'>
              {starsArr.map((filled, i) => (
                <Star
                  key={i}
                  className={cn(
                    'h-10 w-10 transition-all',
                    filled
                      ? cn('fill-current drop-shadow-md', rating.color, 'animate-[star-pop_0.4s_ease-out_both]')
                      : 'text-slate-200 fill-current',
                  )}
                  style={{ animationDelay: `${i * 120}ms` }}
                />
              ))}
            </div>
            <h1 className={cn('text-2xl font-extrabold', rating.color)}>{rating.label}</h1>
            <p className='mt-1 text-sm text-muted-foreground'>{rating.message}</p>
          </div>

          <div className='px-6 py-5 text-center'>
            {/* Big score */}
            <p className='text-5xl font-extrabold tabular-nums sm:text-6xl'>
              {Math.round(result.score_percent)}%
            </p>
            <p className='mt-1.5 text-sm text-muted-foreground'>
              {result.score} / {result.max_score} points
            </p>

            {/* Stars earned badge */}
            <div className={cn('mx-auto mt-4 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold', rating.bgColor, rating.borderColor, rating.color)}>
              <Star className='h-4 w-4 fill-current' />
              +{stars} star{stars !== 1 ? 's' : ''} earned!
            </div>

            {/* Newly unlocked achievements */}
            {newAchievements.length > 0 && (
              <div className='mt-4 space-y-2'>
                <p className='text-[11px] font-bold uppercase tracking-wider text-muted-foreground'>Achievement{newAchievements.length > 1 ? 's' : ''} unlocked!</p>
                {newAchievements.map((a) => (
                  <div key={a.code} className='flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm'>
                    <span className='text-xl'>{a.icon}</span>
                    <div className='text-left'>
                      <p className='font-semibold text-amber-900'>{a.name}</p>
                      <p className='text-[11px] text-amber-700'>{a.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Action buttons */}
            <div className='mt-6 flex flex-col gap-3'>
              <Button
                className='h-12 w-full text-base'
                onClick={() => router.push(`/assessments/review/${attemptId}`)}
              >
                Review answers
              </Button>
              <div className='grid grid-cols-3 gap-2'>
                <Button
                  variant='outline'
                  className='h-10 text-xs'
                  onClick={() => router.push('/assessments/my-tests')}
                >
                  My tests
                </Button>
                <Button
                  variant='outline'
                  className='h-10 text-xs'
                  onClick={() => router.push('/assessments/my-profile')}
                >
                  <Star className='mr-1 h-3.5 w-3.5' />
                  My profile
                </Button>
                <Button
                  variant='outline'
                  className='h-10 text-xs'
                  onClick={() => router.push('/assessments/my-results')}
                >
                  <BarChart3 className='mr-1 h-3.5 w-3.5' />
                  Results
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* CSS animation for star pop */}
        <style>{`
          @keyframes star-pop {
            0%   { transform: scale(0) rotate(-20deg); opacity: 0; }
            60%  { transform: scale(1.3) rotate(5deg); opacity: 1; }
            100% { transform: scale(1) rotate(0deg); opacity: 1; }
          }
        `}</style>
      </CentreScreen>
    );
  }

  // ── REVIEW ─────────────────────────────────────────────────────────────────
  if (state === 'review') {
    return (
      <ScreenShell
        header={
          <div className='border-b bg-white px-4 py-3 shadow-sm'>
            <div className='mx-auto flex max-w-2xl items-center justify-between gap-3'>
              <div>
                <p className='text-[16px] font-bold text-foreground'>Review your answers</p>
                <p className='text-[13px] text-muted-foreground'>
                  <span className='font-semibold text-foreground'>{answeredCount}</span>
                  /{totalQuestions} answered
                  {unanswered.length > 0 && (
                    <span className='ml-2 font-semibold text-amber-600'>
                      · {unanswered.length} unanswered
                    </span>
                  )}
                </p>
              </div>
              <div className='flex items-center gap-2'>
                {timeLeft !== null && timeLeft > 0 && (
                  <span
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-mono font-bold',
                      timerCls,
                    )}
                  >
                    <Clock className='h-4 w-4' />
                    {formatTime(timeLeft)}
                  </span>
                )}
              </div>
            </div>
          </div>
        }
        footer={
          <div
            className='border-t bg-white px-4 pt-3'
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
          >
            <div className='mx-auto max-w-2xl space-y-2'>
              {/* Primary CTA — visually dominant */}
              <Button
                className={cn(
                  'h-14 w-full text-[17px] font-bold tracking-wide shadow-md',
                  unanswered.length > 0
                    ? 'bg-amber-500 hover:bg-amber-600 text-white'
                    : 'bg-primary hover:bg-primary/90',
                )}
                onClick={submitTest}
                disabled={submitting}
              >
                {submitting ? (
                  <span className='flex items-center gap-2'>
                    <span className='h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent' />
                    Submitting…
                  </span>
                ) : unanswered.length > 0 ? (
                  `Submit anyway · ${unanswered.length} unanswered`
                ) : (
                  `Submit test · ${answeredCount}/${totalQuestions} answered`
                )}
              </Button>

              {/* Secondary — go back */}
              <Button
                variant='ghost'
                className='h-10 w-full text-[14px] text-muted-foreground'
                onClick={() => setState('question')}
              >
                <ArrowLeft className='mr-2 h-4 w-4' />
                Back to questions
              </Button>
            </div>
            {error && <p className='mt-2 text-center text-sm text-destructive'>{error}</p>}
          </div>
        }
      >
        <div className='mx-auto max-w-2xl px-4 py-4'>
          {unanswered.length > 0 && (
            <div className='mb-4 flex items-center gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-amber-800'>
              <AlertTriangle className='h-5 w-5 shrink-0 text-amber-500' />
              <div>
                <p className='text-[14px] font-bold'>
                  {unanswered.length} question{unanswered.length !== 1 ? 's' : ''} unanswered
                </p>
                <p className='text-[12px] text-amber-700'>
                  Tap any question below to go back and answer it.
                </p>
              </div>
            </div>
          )}
          <div className='space-y-2.5'>
            {questions.map((q) => {
              const answered = answers[q.index] && answers[q.index].length > 0;
              return (
                <button
                  key={q.index}
                  type='button'
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border-2 px-3.5 py-3.5 text-left transition-all active:scale-[0.99]',
                    answered
                      ? 'border-primary/25 bg-primary/5 hover:border-primary/50'
                      : 'border-amber-300 bg-amber-50 hover:border-amber-400',
                  )}
                  onClick={() => {
                    setCurrentIdx(q.index);
                    setState('question');
                  }}
                >
                  {/* Number circle */}
                  <span
                    className={cn(
                      'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                      answered
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-amber-400 text-white',
                    )}
                  >
                    {q.index + 1}
                  </span>

                  {/* Question text — 2-line clamp, larger font */}
                  <p className='min-w-0 flex-1 text-[15px] leading-snug [-webkit-line-clamp:2] [display:-webkit-box] [-webkit-box-orient:vertical] overflow-hidden'>
                    {q.prompt}
                  </p>

                  {/* Status indicator */}
                  {answered ? (
                    <span className='mt-0.5 shrink-0 rounded-full bg-primary/10 p-1 text-primary'>
                      <Check className='h-4 w-4' />
                    </span>
                  ) : (
                    <span className='mt-1 shrink-0 rounded-md bg-amber-100 px-2 py-0.5 text-[12px] font-bold text-amber-700'>
                      Skip
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </ScreenShell>
    );
  }

  // ── QUESTION ───────────────────────────────────────────────────────────────
  const question = questions[currentIdx];
  if (!question) return null;

  const isMulti = question.question_type === 'mcq_multi';
  const selectedKeys = answers[question.index] || [];
  const progressPct = totalQuestions > 0 ? ((currentIdx + 1) / totalQuestions) * 100 : 0;
  const isLast = currentIdx === totalQuestions - 1;

  return (
    <ScreenShell
      header={
        /* ── Status bar: always visible ── */
        <div className='border-b bg-white px-4 py-2.5 shadow-sm'>
          <div className='mx-auto max-w-2xl'>
            <div className='flex items-center justify-between gap-2'>
              {/* Left: question counter + points */}
              <div className='flex items-center gap-2'>
                <span className='text-[13px] font-bold text-foreground'>
                  Q {currentIdx + 1}
                  <span className='font-normal text-muted-foreground'>/{totalQuestions}</span>
                </span>
                <span className='h-3.5 w-px bg-slate-200' />
                <span className='text-[12px] font-medium text-muted-foreground'>
                  {question.points} pt{question.points !== 1 ? 's' : ''}
                </span>
                {isMulti && (
                  <>
                    <span className='h-3.5 w-px bg-slate-200' />
                    <span className='text-[11px] font-semibold uppercase tracking-wide text-primary'>
                      Multi
                    </span>
                  </>
                )}
              </div>
              {/* Right: timer */}
              {timeLeft !== null && timeLeft > 0 && (
                <span
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[13px] font-mono font-bold',
                    timerCls,
                  )}
                >
                  <Clock className='h-3.5 w-3.5' />
                  {formatTime(timeLeft)}
                </span>
              )}
            </div>
            {/* Progress bar */}
            <Progress value={progressPct} className='mt-2 h-1.5 rounded-full' />
          </div>
        </div>
      }
      footer={
        /* ── Navigation bar: always visible ── */
        <div
          className='border-t bg-white px-4 py-3'
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
        >
          <div className='mx-auto flex max-w-2xl items-center gap-3'>
            {/* Prev */}
            <Button
              variant='outline'
              className='h-12 flex-1 text-[15px] font-semibold'
              onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
              disabled={currentIdx === 0}
            >
              <ArrowLeft className='mr-2 h-4 w-4' />
              Prev
            </Button>
            {/* Next / Review */}
            {!isLast ? (
              <Button
                className='h-12 flex-1 text-[15px] font-semibold'
                onClick={() => setCurrentIdx((i) => Math.min(totalQuestions - 1, i + 1))}
              >
                Next
                <ArrowRight className='ml-2 h-4 w-4' />
              </Button>
            ) : (
              <Button
                className='h-12 flex-1 text-[15px] font-semibold'
                onClick={() => setState('review')}
              >
                Review
                <ArrowRight className='ml-2 h-4 w-4' />
              </Button>
            )}
          </div>
          {error && <p className='mt-2 text-center text-sm text-destructive'>{error}</p>}
        </div>
      }
    >
      {/* ── Scrollable question + answers ── */}
      <div ref={scrollRef} className='mx-auto max-w-2xl px-4 py-4 sm:py-6'>

        {/* Question text */}
        <p className='mb-4 text-[18px] font-semibold leading-[1.5] text-foreground sm:text-xl sm:leading-relaxed'>
          {question.prompt}
        </p>
        {isMulti && (
          <p className='mb-3 text-[12px] font-semibold uppercase tracking-wider text-primary'>
            Select all that apply
          </p>
        )}

        {/* Answer options */}
        <div className='space-y-2.5'>
          {question.options.map((option, optIdx) => {
            const isSelected = selectedKeys.includes(option.key);
            const letter = String.fromCharCode(65 + optIdx);
            return (
              <button
                key={option.key}
                type='button'
                onClick={() => selectAnswer(question.index, option.key, isMulti)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border-2 px-3 py-3 text-left transition-all duration-150 active:scale-[0.99]',
                  isSelected
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-primary/40 hover:bg-slate-50',
                )}
              >
                {/* Letter badge */}
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                    isSelected
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-slate-200 bg-slate-50 text-slate-500',
                  )}
                >
                  {letter}
                </span>
                {/* Option text — vertically centered via parent items-center */}
                <span className='flex-1 text-[16px] leading-snug sm:text-[17px]'>
                  {option.text}
                </span>
                {/* Check indicator */}
                {isSelected && (
                  <span className='shrink-0 text-primary'>
                    <Check className='h-4 w-4' />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Question progress dots */}
        <div className='mt-5 flex flex-wrap justify-center gap-1.5'>
          {questions.map((q, idx) => {
            const answered = answers[q.index] && answers[q.index].length > 0;
            const isCurrent = idx === currentIdx;
            return (
              <button
                key={q.index}
                type='button'
                onClick={() => setCurrentIdx(idx)}
                title={`Q${idx + 1}`}
                className={cn(
                  'rounded-full transition-all duration-150',
                  isCurrent
                    ? 'h-2.5 w-2.5 bg-primary ring-2 ring-primary ring-offset-2'
                    : answered
                      ? 'h-2 w-2 bg-primary/60'
                      : 'h-2 w-2 bg-slate-200 hover:bg-slate-300',
                )}
              />
            );
          })}
        </div>

      </div>
    </ScreenShell>
  );
}
