'use client';

import { useEffect, useState } from 'react';

import { useSearchParams } from 'next/navigation';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AssessmentAttempt, AssessmentSectionScore } from '@/lib/types';
import { BarChart3, CheckCircle2, ClipboardList, Star, User } from 'lucide-react';
import { getStarRating, starArray } from '@/lib/stars';
import { useRouter } from 'next/navigation';

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

function SectionScorePill({ percent }: { percent: number }) {
  const pct = Math.round(percent);
  const color =
    pct >= 80 ? 'bg-emerald-100 text-emerald-800' :
    pct >= 50 ? 'bg-amber-100 text-amber-800' :
                'bg-red-100 text-red-700';
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${color}`}>
      {pct}%
    </span>
  );
}

const formatDate = (d?: string | null) => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return d;
  }
};

const durationText = (start?: string | null, end?: string | null) => {
  if (!start || !end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms <= 0) return '—';
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

export default function AssessmentResultsPage() {
  const { accessToken } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const deliveryId = searchParams.get('delivery_id');
  const testId = searchParams.get('test_id');
  const userId = searchParams.get('user_id');

  const [results, setResults] = useState<ResultsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<AssessmentAttempt | null>(null);

  const load = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (deliveryId) params.set('delivery_id', deliveryId);
      if (testId) params.set('test_id', testId);
      if (userId) params.set('user_id', userId);
      const qs = params.toString();
      const response = await api.get<ResultsResponse>(`/assessments/results${qs ? `?${qs}` : ''}`, accessToken);
      setResults(response);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accessToken, deliveryId, testId, userId]);

  if (loading) return <LoadingState label='Loading results...' />;

  const filterLabel = deliveryId
    ? 'Filtered by delivery'
    : testId
      ? 'Filtered by test'
      : null;

  if (!results || results.items.length === 0) {
    return (
      <div className='space-y-4'>
        {filterLabel && (
          <p className='text-xs text-muted-foreground'>{filterLabel} — <a href='/assessments/results' className='underline underline-offset-2'>Clear filter</a></p>
        )}
        <EmptyState title='No results yet' description='Assessment results will appear here after completing a test.' />
      </div>
    );
  }

  const items = results.items;
  const avg = results.summary.average_score_percent;
  const passCount = items.filter((a) => a.passed).length;
  const failCount = items.filter((a) => !a.passed && a.status === 'scored').length;
  const totalStars = items.reduce((s, a) => s + (a.stars_earned ?? 0), 0);
  const starsCompleted = items.filter(a => a.stars_earned != null && a.status === 'scored').length;
  const avgStarRate = starsCompleted > 0 ? (totalStars / starsCompleted).toFixed(1) : '—';

  return (
    <div className='space-y-6'>
      {filterLabel && (
        <div className='flex items-center justify-between'>
          <p className='text-xs text-muted-foreground'>{filterLabel}</p>
          <a href='/assessments/results' className='text-xs text-primary underline underline-offset-2'>Clear filter</a>
        </div>
      )}

      {/* Summary cards */}
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        <Card>
          <CardContent className='flex items-center gap-3 py-4'>
            <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50'>
              <BarChart3 className='h-5 w-5 text-blue-600' />
            </div>
            <div>
              <p className='text-2xl font-bold'>{results.summary.attempt_count}</p>
              <p className='text-xs text-muted-foreground'>Total attempts</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className='flex items-center gap-3 py-4'>
            <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50'>
              <Star className='h-5 w-5 fill-current text-amber-500' />
            </div>
            <div>
              <p className='text-2xl font-bold'>{totalStars}</p>
              <p className='text-xs text-muted-foreground'>Total Stars</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className='flex items-center gap-3 py-4'>
            <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50'>
              <CheckCircle2 className='h-5 w-5 text-emerald-600' />
            </div>
            <div>
              <p className='text-2xl font-bold'>{avgStarRate}</p>
              <p className='text-xs text-muted-foreground'>Avg Star Rate</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className='flex items-center gap-3 py-4'>
            <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50'>
              <BarChart3 className='h-5 w-5 text-amber-600' />
            </div>
            <div>
              <p className='text-2xl font-bold'>{avg != null ? `${Math.round(avg)}%` : '—'}</p>
              <p className='text-xs text-muted-foreground'>Average score</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Results table */}
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Attempt history</CardTitle>
        </CardHeader>
        <CardContent className='p-0'>
          <div className='overflow-x-auto'>
            <table className='w-full min-w-[700px] text-sm'>
              <thead>
                <tr className='border-b bg-muted/40 text-left text-xs text-muted-foreground'>
                  <th className='px-4 py-2.5 font-medium'>#</th>
                  {items.some(a => a.user_name || a.user_email) && (
                    <th className='px-4 py-2.5 font-medium'>Employee</th>
                  )}
                  {items.some(a => a.test_title) && (
                    <th className='px-4 py-2.5 font-medium'>Test</th>
                  )}
                  <th className='px-4 py-2.5 font-medium'>Status</th>
                  <th className='px-4 py-2.5 font-medium'>Score</th>
                  <th className='px-4 py-2.5 font-medium'>Result</th>
                  <th className='px-4 py-2.5 font-medium'>Started</th>
                  <th className='px-4 py-2.5 font-medium'>Duration</th>
                  <th className='px-4 py-2.5' />
                </tr>
              </thead>
              <tbody className='divide-y'>
                {items.map((attempt) => {
                  const hasEnrichment = attempt.user_name || attempt.user_email || attempt.test_title;
                  return (
                    <tr key={attempt.id} className='hover:bg-muted/20 transition-colors'>
                      <td className='px-4 py-3 font-mono text-xs text-muted-foreground'>#{attempt.attempt_number}</td>

                      {/* Employee — only rendered when enrichment data is present */}
                      {items.some(a => a.user_name || a.user_email) && (
                        <td className='px-4 py-3'>
                          {(attempt.user_name || attempt.user_email) ? (
                            <div className='flex items-center gap-1.5'>
                              <User className='h-3.5 w-3.5 shrink-0 text-slate-400' />
                              <div className='min-w-0'>
                                <p className='truncate text-xs font-semibold text-foreground max-w-[140px]'>
                                  {attempt.user_name ?? attempt.user_email}
                                </p>
                                {attempt.user_name && attempt.user_email && (
                                  <p className='truncate text-[10px] text-muted-foreground max-w-[140px]'>
                                    {attempt.user_email}
                                  </p>
                                )}
                              </div>
                            </div>
                          ) : <span className='text-xs text-muted-foreground'>—</span>}
                        </td>
                      )}

                      {/* Test title */}
                      {items.some(a => a.test_title) && (
                        <td className='px-4 py-3'>
                          {attempt.test_title ? (
                            <p className='truncate text-xs font-medium text-foreground max-w-[160px]' title={attempt.test_title}>
                              {attempt.test_title}
                            </p>
                          ) : <span className='text-xs text-muted-foreground'>—</span>}
                        </td>
                      )}

                      <td className='px-4 py-3'>
                        <Badge variant='outline' className='capitalize text-[11px]'>{attempt.status}</Badge>
                      </td>
                      <td className='px-4 py-3 tabular-nums'>
                        {attempt.score_percent != null ? (
                          <span className='font-semibold'>{Math.round(attempt.score_percent)}%</span>
                        ) : '—'}
                        {attempt.score != null && attempt.max_score != null && (
                          <span className='ml-1 text-[11px] text-muted-foreground'>
                            ({attempt.score}/{attempt.max_score})
                          </span>
                        )}
                      </td>
                      <td className='px-4 py-3'>
                        {(attempt.status === 'scored' || attempt.status === 'submitted') && attempt.score_percent != null ? (
                          (() => {
                            const r = getStarRating(attempt.score_percent);
                            return (
                              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${r.bgColor} ${r.borderColor} ${r.color}`}>
                                {starArray(r.stars).filter(Boolean).length}
                                <Star className='h-3 w-3 fill-current' />
                                {r.label}
                              </span>
                            );
                          })()
                        ) : '—'}
                      </td>
                      <td className='px-4 py-3 text-xs text-muted-foreground whitespace-nowrap'>{formatDate(attempt.started_at)}</td>
                      <td className='px-4 py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap'>
                        {durationText(attempt.started_at, attempt.submitted_at)}
                      </td>
                      <td className='px-4 py-3'>
                        <div className='flex items-center gap-1'>
                          <Button variant='ghost' size='sm' className='h-7 text-xs' onClick={() => setDetail(attempt)}>
                            Details
                          </Button>
                          {(attempt.status === 'scored' || attempt.status === 'submitted') && (
                            <Button
                              variant='ghost'
                              size='sm'
                              className='h-7 text-xs text-primary hover:text-primary'
                              onClick={() => router.push(`/assessments/review/${attempt.id}`)}
                            >
                              <ClipboardList className='mr-1 h-3.5 w-3.5' />
                              Review
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Detail slide-over */}
      <Sheet open={!!detail} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <SheetContent side='right' className='flex h-full flex-col sm:max-w-lg'>
          <SheetHeader>
            <SheetTitle>Attempt #{detail?.attempt_number} details</SheetTitle>
            {(detail?.test_title || detail?.user_name || detail?.user_email) && (
              <div className='mt-1 space-y-0.5'>
                {detail.test_title && (
                  <p className='text-sm font-semibold text-foreground'>{detail.test_title}</p>
                )}
                {(detail.user_name || detail.user_email) && (
                  <p className='flex items-center gap-1 text-xs text-muted-foreground'>
                    <User className='h-3 w-3' />
                    {detail.user_name ?? detail.user_email}
                    {detail.user_name && detail.user_email && ` · ${detail.user_email}`}
                  </p>
                )}
              </div>
            )}
          </SheetHeader>
          {detail && (
            <div className='flex-1 overflow-auto mt-4 space-y-5'>
              {/* Top stats */}
              <div className='grid grid-cols-2 gap-3'>
                <div className='rounded-md border p-3'>
                  <p className='text-xs text-muted-foreground'>Score</p>
                  <p className='text-lg font-bold'>
                    {detail.score_percent != null ? `${Math.round(detail.score_percent)}%` : '—'}
                  </p>
                </div>
                <div className='rounded-md border p-3'>
                  <p className='text-xs text-muted-foreground'>Points</p>
                  <p className='text-lg font-bold'>{detail.score ?? 0} / {detail.max_score ?? 0}</p>
                </div>
                <div className='rounded-md border p-3'>
                  <p className='text-xs text-muted-foreground'>Stars</p>
                  {detail.score_percent != null ? (
                    <div className='flex items-center gap-1 mt-1'>
                      {starArray(getStarRating(detail.score_percent).stars).map((filled, i) => (
                        <Star key={i} className={`h-4 w-4 ${filled ? `fill-current ${getStarRating(detail.score_percent!).color}` : 'fill-current text-slate-200'}`} />
                      ))}
                    </div>
                  ) : <p className='text-lg font-bold'>—</p>}
                </div>
                <div className='rounded-md border p-3'>
                  <p className='text-xs text-muted-foreground'>Duration</p>
                  <p className='text-lg font-bold'>{durationText(detail.started_at, detail.submitted_at)}</p>
                </div>
              </div>

              {/* Section scorecard */}
              {detail.section_scores && Object.keys(detail.section_scores).length > 0 && (
                <div>
                  <p className='mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                    Score by section
                  </p>
                  <div className='overflow-x-auto rounded-lg border'>
                    <table className='w-full min-w-[320px] text-sm'>
                      <thead>
                        <tr className='border-b bg-muted/40 text-xs text-muted-foreground'>
                          <th className='px-3 py-2 text-left font-medium'>Section</th>
                          <th className='px-3 py-2 text-right font-medium'>Correct</th>
                          <th className='px-3 py-2 text-right font-medium'>Points</th>
                          <th className='px-3 py-2 text-right font-medium'>Score</th>
                        </tr>
                      </thead>
                      <tbody className='divide-y'>
                        {Object.entries(detail.section_scores)
                          .sort((a, b) => b[1].percent - a[1].percent)
                          .map(([section, s]: [string, AssessmentSectionScore]) => (
                            <tr key={section} className='hover:bg-muted/20'>
                              <td className='px-3 py-2 font-medium'>{section}</td>
                              <td className='px-3 py-2 text-right text-xs text-muted-foreground tabular-nums'>
                                {s.correct}/{s.total_questions}
                              </td>
                              <td className='px-3 py-2 text-right text-xs text-muted-foreground tabular-nums'>
                                {s.earned}/{s.total}
                              </td>
                              <td className='px-3 py-2 text-right tabular-nums'>
                                <SectionScorePill percent={s.percent} />
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Meta */}
              <div className='space-y-1.5 text-sm'>
                <p><span className='text-muted-foreground'>Status:</span> {detail.status}</p>
                <p><span className='text-muted-foreground'>Started:</span> {formatDate(detail.started_at)}</p>
                {detail.submitted_at && <p><span className='text-muted-foreground'>Submitted:</span> {formatDate(detail.submitted_at)}</p>}
              </div>

              {/* Review CTA */}
              {(detail.status === 'scored' || detail.status === 'submitted') && (
                <Button
                  className='mt-2 w-full'
                  onClick={() => router.push(`/assessments/review/${detail.id}`)}
                >
                  <ClipboardList className='mr-2 h-4 w-4' />
                  Review answers (right &amp; wrong)
                </Button>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
