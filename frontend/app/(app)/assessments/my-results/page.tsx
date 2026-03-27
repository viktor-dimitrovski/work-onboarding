'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { MyResultAttempt, MyResultsResponse, AssessmentSectionScore } from '@/lib/types';
import {
  ChevronDown,
  ChevronRight,
  Star,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getStarRating, starArray, formatStarRate } from '@/lib/stars';

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(pct: number) {
  if (pct >= 80) return 'text-emerald-600';
  if (pct >= 50) return 'text-amber-600';
  return 'text-red-600';
}

function scoreBg(pct: number) {
  if (pct >= 80) return 'bg-emerald-50 border-emerald-200';
  if (pct >= 50) return 'bg-amber-50 border-amber-200';
  return 'bg-red-50 border-red-200';
}

function formatDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatTime(d?: string | null) {
  if (!d) return '';
  return new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function duration(start?: string | null, end?: string | null) {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms <= 0) return null;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ── Summary stats strip ───────────────────────────────────────────────────────

// ── Attempt card ──────────────────────────────────────────────────────────────

function AttemptCard({ item }: { item: MyResultAttempt }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  const pct = item.score_percent != null ? Math.round(item.score_percent) : null;
  const dur = duration(item.started_at, item.submitted_at);
  const hasSections = item.section_scores && Object.keys(item.section_scores).length > 0;
  const isScored = item.status === 'scored';
  const starRating = getStarRating(item.score_percent);

  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border-2 bg-white shadow-sm transition-shadow',
        item.passed && isScored ? 'border-emerald-200' : isScored ? 'border-red-200' : 'border-slate-200',
      )}
    >
      {/* ── Main row ── */}
      <div className='px-4 py-4'>
        {/* Top row: test name + score pill */}
        <div className='flex items-start gap-3'>
          <div className='min-w-0 flex-1'>
            <p className='text-[15px] font-bold leading-snug text-foreground'>
              {item.test_title}
            </p>
            <p className='mt-0.5 text-[12px] text-muted-foreground'>
              Attempt #{item.attempt_number}
              {dur && <span> · {dur}</span>}
              <span> · {formatDate(item.submitted_at ?? item.started_at)}</span>
              {item.submitted_at && (
                <span> at {formatTime(item.submitted_at)}</span>
              )}
            </p>
          </div>

          {/* Star rating pill */}
          {pct != null ? (
            <div className={cn('shrink-0 flex flex-col items-center justify-center rounded-xl border px-2.5 py-1.5 text-center', starRating.bgColor, starRating.borderColor)}>
              <div className='flex gap-0.5'>
                {starArray(starRating.stars).map((filled, i) => (
                  <Star key={i} className={cn('h-3 w-3', filled ? cn('fill-current', starRating.color) : 'fill-current text-slate-200')} />
                ))}
              </div>
              <p className={cn('mt-0.5 text-[11px] font-extrabold leading-none', starRating.color)}>{pct}%</p>
            </div>
          ) : (
            <span className='rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500'>
              {item.status}
            </span>
          )}
        </div>

        {/* Points + pass/fail + expand */}
        <div className='mt-3 flex items-center gap-2'>
          {isScored && (
            <>
              <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold', starRating.bgColor, starRating.color)}>
                <Star className='h-3.5 w-3.5 fill-current' />
                {item.stars_earned != null ? `${item.stars_earned} star${item.stars_earned !== 1 ? 's' : ''}` : starRating.label}
              </span>

              {item.score != null && item.max_score != null && (
                <span className='text-[12px] text-muted-foreground'>
                  {item.score}/{item.max_score} pts
                </span>
              )}
            </>
          )}

          <div className='ml-auto flex items-center gap-2'>
            {hasSections && (
              <button
                type='button'
                onClick={() => setExpanded((v) => !v)}
                className='flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-medium text-muted-foreground hover:bg-muted/50'
              >
                {expanded ? <ChevronDown className='h-3.5 w-3.5' /> : <ChevronRight className='h-3.5 w-3.5' />}
                Breakdown
              </button>
            )}

            {isScored && (
              <Button
                size='sm'
                className='h-8 px-3 text-[13px]'
                onClick={() => router.push(`/assessments/review/${item.attempt_id}`)}
              >
                Review
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── Section breakdown (expandable) ── */}
      {expanded && hasSections && item.section_scores && (
        <div className='border-t bg-slate-50 px-4 py-3'>
          <p className='mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground'>
            Score by section
          </p>
          <div className='space-y-1.5'>
            {Object.entries(item.section_scores)
              .sort((a, b) => b[1].percent - a[1].percent)
              .map(([section, s]: [string, AssessmentSectionScore]) => {
                const spct = Math.round(s.percent);
                return (
                  <div key={section} className='flex items-center gap-2'>
                    <p className='min-w-0 flex-1 truncate text-[13px] font-medium'>{section}</p>
                    <span className='shrink-0 text-[12px] text-muted-foreground'>
                      {s.correct}/{s.total_questions}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[12px] font-bold',
                        spct >= 80
                          ? 'bg-emerald-100 text-emerald-700'
                          : spct >= 50
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-red-100 text-red-700',
                      )}
                    >
                      {spct}%
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MyResultsPage() {
  const { accessToken } = useAuth();
  const [data, setData] = useState<MyResultsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    api
      .get<MyResultsResponse>('/assessments/my-results', accessToken)
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load results'),
      )
      .finally(() => setLoading(false));
  }, [accessToken]);

  if (loading) return <LoadingState label='Loading your results…' />;

  if (error) {
    return (
      <div className='flex min-h-[40vh] items-center justify-center'>
        <p className='text-sm text-destructive'>{error}</p>
      </div>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        title='No results yet'
        description="You haven't completed any tests yet. Your results will appear here once you finish a test."
      />
    );
  }

  const avg = data.average_score_percent != null ? Math.round(data.average_score_percent) : null;

  return (
    <div className='mx-auto max-w-2xl space-y-5'>

      {/* ── Page title ── */}
      <div>
        <h1 className='text-[20px] font-bold text-foreground sm:text-2xl'>My Results</h1>
        <p className='mt-0.5 text-[13px] text-muted-foreground'>
          Your personal test history and scores
        </p>
      </div>

      {/* ── Star hero widget ── */}
      <div className='rounded-2xl border bg-gradient-to-br from-amber-50 to-white p-4 shadow-sm'>
        <div className='flex items-center gap-4'>
          <div className='flex flex-col items-center justify-center rounded-xl bg-amber-100 px-4 py-3 text-amber-700'>
            <Star className='h-7 w-7 fill-current mb-1' />
            <p className='text-2xl font-extrabold leading-none'>{data.total_stars}</p>
            <p className='mt-0.5 text-[10px] font-semibold uppercase tracking-wide'>Total Stars</p>
          </div>
          <div className='flex-1 grid grid-cols-2 gap-2'>
            <div className='rounded-lg bg-white border px-3 py-2 text-center'>
              <p className='text-lg font-bold text-amber-600'>{formatStarRate(data.star_rate)}</p>
              <p className='text-[10px] text-muted-foreground font-medium'>★ Star Rate</p>
            </div>
            <div className='rounded-lg bg-white border px-3 py-2 text-center'>
              <p className='text-lg font-bold'>{data.total_attempts}</p>
              <p className='text-[10px] text-muted-foreground font-medium'>Tests done</p>
            </div>
            <div className='rounded-lg bg-white border px-3 py-2 text-center'>
              <p className='text-lg font-bold text-emerald-600'>{data.pass_count}</p>
              <p className='text-[10px] text-muted-foreground font-medium'>Passed</p>
            </div>
            <div className='rounded-lg bg-white border px-3 py-2 text-center'>
              <p className='text-lg font-bold'>{avg != null ? `${avg}%` : '—'}</p>
              <p className='text-[10px] text-muted-foreground font-medium'>Avg score</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Attempt list ── */}
      <div className='space-y-3'>
        {data.items.map((item) => (
          <AttemptCard key={item.attempt_id} item={item} />
        ))}
      </div>

    </div>
  );
}
