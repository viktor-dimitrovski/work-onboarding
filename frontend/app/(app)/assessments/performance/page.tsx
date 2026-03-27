'use client';

import React, { useEffect, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { TeamMemberPerformance } from '@/lib/types';
import { getPlayerLevel, formatStarRate, getStarRating, starArray } from '@/lib/stars';
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronRight, HelpCircle, Star, TrendingUp, Users, Download, Calendar, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Helpers ───────────────────────────────────────────────────────────────────

function tenureLabel(months: number): string {
  if (months < 1) return '< 1 mo';
  if (months < 12) return `${months} mo`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem > 0 ? `${years}y ${rem}m` : `${years}y`;
}

function exportCsv(items: TeamMemberPerformance[], period: string) {
  const header = 'Name,Email,Tenure,Total Stars,Tests,Star Rate,Period Stars,Period Tests,Period Rate';
  const rows = items.map(m =>
    [
      `"${m.full_name}"`,
      m.email,
      tenureLabel(m.tenure_months),
      m.total_stars,
      m.tests_completed,
      formatStarRate(m.star_rate),
      m.period_stars,
      m.period_tests,
      formatStarRate(m.period_star_rate),
    ].join(',')
  );
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `team-performance${period ? `-${period}` : ''}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Sort types ────────────────────────────────────────────────────────────────

type SortKey = 'rank' | 'name' | 'tenure' | 'rate' | 'stars' | 'tests' | 'level';
type SortDir = 'asc' | 'desc';

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ArrowUpDown className='ml-1 inline h-3 w-3 opacity-30' />;
  return sortDir === 'asc'
    ? <ArrowUp className='ml-1 inline h-3 w-3 text-primary' />
    : <ArrowDown className='ml-1 inline h-3 w-3 text-primary' />;
}

// ── Row component ─────────────────────────────────────────────────────────────

function MemberRow({ member, rank, hasPeriod, onNavigate }: {
  member: TeamMemberPerformance;
  rank: number;
  hasPeriod: boolean;
  onNavigate: () => void;
}) {
  const level = getPlayerLevel(member.total_stars);
  const rate = hasPeriod ? member.period_star_rate : member.star_rate;
  const stars = hasPeriod ? member.period_stars : member.total_stars;
  const tests = hasPeriod ? member.period_tests : member.tests_completed;
  const starRating = getStarRating((rate / 5) * 100);
  const noActivity = tests === 0;

  const rankBadge = rank <= 3
    ? ['🥇', '🥈', '🥉'][rank - 1]
    : <span className='text-[11px] text-muted-foreground font-mono'>#{rank}</span>;

  return (
    <tr
      className={cn(
        'group border-b last:border-b-0 cursor-pointer transition-colors',
        noActivity ? 'opacity-60 hover:opacity-80 hover:bg-amber-50/40' : 'hover:bg-muted/20',
      )}
      onClick={onNavigate}
      title='View profile'
    >
      {/* Rank */}
      <td className='px-3 py-3 text-center text-lg w-10'>{rankBadge}</td>

      {/* Name + email */}
      <td className='px-3 py-3'>
        <div className='flex items-center gap-2'>
          <div className='min-w-0'>
            <p className='font-semibold text-sm text-foreground truncate max-w-[160px]' title={member.full_name}>{member.full_name}</p>
            <p className='text-[11px] text-muted-foreground truncate max-w-[160px]'>{member.email}</p>
          </div>
          {noActivity && (
            <span className='shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700'>No tests</span>
          )}
        </div>
      </td>

      {/* Tenure */}
      <td className='px-3 py-3 text-xs text-muted-foreground whitespace-nowrap'>
        {tenureLabel(member.tenure_months)}
      </td>

      {/* Star Rate — primary fair metric */}
      <td className='px-3 py-3'>
        {noActivity ? (
          <span className='text-xs text-muted-foreground'>—</span>
        ) : (
          <div className='flex items-center gap-1.5'>
            <div className='flex gap-0.5'>
              {starArray(Math.round(rate)).map((filled, i) => (
                <Star key={i} className={cn('h-3.5 w-3.5', filled ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200')} />
              ))}
            </div>
            <span className={cn('text-sm font-bold', starRating.color)}>{formatStarRate(rate)}</span>
          </div>
        )}
      </td>

      {/* Stars collected */}
      <td className='px-3 py-3'>
        <span className='inline-flex items-center gap-1 text-sm font-semibold text-amber-600'>
          <Star className='h-3.5 w-3.5 fill-amber-400 text-amber-400' />
          {stars}
        </span>
      </td>

      {/* Tests */}
      <td className='px-3 py-3 text-sm text-muted-foreground'>{tests}</td>

      {/* Level (lifetime) */}
      <td className='px-3 py-3'>
        <span className='inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600'>
          Lv {level.level}
          <span className='text-slate-400 hidden sm:inline'>· {level.title}</span>
        </span>
      </td>

      {/* Navigate arrow */}
      <td className='px-2 py-3 w-6 opacity-0 group-hover:opacity-100 transition-opacity'>
        <ChevronRight className='h-3.5 w-3.5 text-muted-foreground' />
      </td>
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const QUICK_PERIODS = [
  { label: 'All time', start: '', end: '' },
  { label: 'This month', start: () => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d.toISOString(); }, end: '' },
  { label: 'Last 30 days', start: () => { const d = new Date(); d.setDate(d.getDate()-30); return d.toISOString(); }, end: '' },
  { label: 'Last 90 days', start: () => { const d = new Date(); d.setDate(d.getDate()-90); return d.toISOString(); }, end: '' },
  { label: 'This year', start: () => { const d = new Date(); d.setMonth(0,1); d.setHours(0,0,0,0); return d.toISOString(); }, end: '' },
];

export default function TeamPerformancePage() {
  const { accessToken } = useAuth();
  const router = useRouter();
  const [members, setMembers] = useState<TeamMemberPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [activeQuick, setActiveQuick] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>('rate');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [infoOpen, setInfoOpen] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);

  // Close info panel when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) setInfoOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const load = (start: string, end: string) => {
    if (!accessToken) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (start) params.set('period_start', start);
    if (end) params.set('period_end', end);
    api
      .get<{ items: TeamMemberPerformance[] }>(`/assessments/performance?${params}`, accessToken)
      .then(r => setMembers(r.items))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(periodStart, periodEnd); }, [accessToken]);

  const applyQuick = (idx: number) => {
    const p = QUICK_PERIODS[idx];
    const start = typeof p.start === 'function' ? p.start() : p.start;
    const end = p.end;
    setPeriodStart(start);
    setPeriodEnd(end);
    setActiveQuick(idx);
    load(start, end);
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const hasPeriod = Boolean(periodStart || periodEnd);

  const sortedMembers = [...members].sort((a, b) => {
    let av = 0, bv = 0;
    switch (sortKey) {
      case 'name':    av = a.full_name.localeCompare(b.full_name); return sortDir === 'asc' ? av : -av;
      case 'tenure':  av = a.tenure_months; bv = b.tenure_months; break;
      case 'rate':    av = hasPeriod ? a.period_star_rate : a.star_rate; bv = hasPeriod ? b.period_star_rate : b.star_rate; break;
      case 'stars':   av = hasPeriod ? a.period_stars : a.total_stars; bv = hasPeriod ? b.period_stars : b.total_stars; break;
      case 'tests':   av = hasPeriod ? a.period_tests : a.tests_completed; bv = hasPeriod ? b.period_tests : b.tests_completed; break;
      case 'level':   av = a.total_stars; bv = b.total_stars; break;
      default: return 0;
    }
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  const filtered = sortedMembers.filter(m =>
    !search || m.full_name.toLowerCase().includes(search.toLowerCase()) || m.email.toLowerCase().includes(search.toLowerCase())
  );

  const totalTeamStars = members.reduce((s, m) => s + (hasPeriod ? m.period_stars : m.total_stars), 0);
  const teamAvgRate = members.length > 0
    ? members.reduce((s, m) => s + (hasPeriod ? m.period_star_rate : m.star_rate), 0) / members.length
    : 0;
  const noActivityCount = members.filter(m => (hasPeriod ? m.period_tests : m.tests_completed) === 0).length;
  const topRate = members.length > 0
    ? Math.max(...members.map(m => hasPeriod ? m.period_star_rate : m.star_rate))
    : 0;

  const th = (key: SortKey, label: React.ReactNode, className = '') => (
    <th
      className={cn('cursor-pointer select-none px-3 py-2.5 font-medium hover:text-foreground transition-colors', className)}
      onClick={() => toggleSort(key)}
    >
      {label}
      <SortIcon col={key} sortKey={sortKey} sortDir={sortDir} />
    </th>
  );

  if (error) return (
    <div className='flex min-h-[40vh] items-center justify-center'>
      <p className='text-sm text-destructive'>{error}</p>
    </div>
  );

  return (
    <div className='space-y-5'>

      {/* ── Header ── */}
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-semibold flex items-center gap-2'>
            <TrendingUp className='h-6 w-6 text-amber-500' />
            Team Performance
            {/* ── Info button ── */}
            <div className='relative' ref={infoRef}>
              <button
                type='button'
                onClick={() => setInfoOpen(v => !v)}
                className='rounded-full p-0.5 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors'
                aria-label='About this page'
              >
                <HelpCircle className='h-5 w-5' />
              </button>
              {infoOpen && (
                <div className='absolute left-0 top-8 z-50 w-80 rounded-xl border bg-white p-4 shadow-xl text-sm font-normal text-foreground'>
                  <div className='flex items-start justify-between gap-2 mb-2'>
                    <p className='font-semibold text-base'>What is this page?</p>
                    <button onClick={() => setInfoOpen(false)} className='text-muted-foreground hover:text-foreground'><X className='h-4 w-4' /></button>
                  </div>
                  <p className='text-muted-foreground text-xs leading-relaxed'>
                    This dashboard shows how your team performs across all assessment tests. It is designed to be <strong>fair for everyone</strong> — a new hire and a 10-year veteran are compared equally.
                  </p>
                  <ul className='mt-3 space-y-2 text-xs text-muted-foreground'>
                    <li className='flex gap-2'>
                      <span className='mt-0.5 shrink-0 rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-700 h-fit'>FAIR</span>
                      <span><strong className='text-foreground'>★ Star Rate</strong> — average stars per test. The primary comparison metric. Equal regardless of tenure, use this for performance reviews.</span>
                    </li>
                    <li className='flex gap-2'>
                      <Star className='mt-0.5 h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400' />
                      <span><strong className='text-foreground'>Total Stars</strong> — cumulative stars collected over time. Honors loyalty and dedication; naturally grows with tenure.</span>
                    </li>
                    <li className='flex gap-2'>
                      <TrendingUp className='mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500' />
                      <span><strong className='text-foreground'>Level</strong> — based on total stars, reflects long-term engagement and growth.</span>
                    </li>
                  </ul>
                  <p className='mt-3 text-[10px] text-muted-foreground border-t pt-2'>Click any row to view that employee&apos;s full star profile.</p>
                </div>
              )}
            </div>
          </h2>
          <p className='text-sm text-muted-foreground mt-0.5'>
            Star Rate is the fair comparison metric — equal for new hires and veterans.
          </p>
        </div>
        <button
          type='button'
          onClick={() => exportCsv(filtered, QUICK_PERIODS[activeQuick].label)}
          className='inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-muted/50'
        >
          <Download className='h-4 w-4' />
          Export CSV
        </button>
      </div>

      {/* ── Summary cards ── */}
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
        <div className='rounded-xl border bg-white p-3 text-center shadow-sm'>
          <Users className='mx-auto h-5 w-5 text-blue-500 mb-1' />
          <p className='text-xl font-extrabold'>{members.length}</p>
          <p className='text-[10px] text-muted-foreground'>Team members</p>
          {noActivityCount > 0 && (
            <p className='mt-0.5 text-[9px] text-amber-600 font-medium'>{noActivityCount} inactive</p>
          )}
        </div>
        <div className='rounded-xl border bg-white p-3 text-center shadow-sm'>
          <Star className='mx-auto h-5 w-5 fill-amber-400 text-amber-400 mb-1' />
          <p className='text-xl font-extrabold text-amber-600'>{totalTeamStars}</p>
          <p className='text-[10px] text-muted-foreground'>{hasPeriod ? 'Period stars' : 'Total stars'}</p>
        </div>
        <div className='rounded-xl border bg-white p-3 text-center shadow-sm'>
          <TrendingUp className='mx-auto h-5 w-5 text-emerald-500 mb-1' />
          <p className='text-xl font-extrabold text-emerald-600'>{formatStarRate(teamAvgRate)}</p>
          <p className='text-[10px] text-muted-foreground'>Avg Star Rate</p>
        </div>
        <div className='rounded-xl border bg-white p-3 text-center shadow-sm'>
          <Star className='mx-auto h-5 w-5 text-slate-400 mb-1' />
          <p className='text-xl font-extrabold'>
            {members.length > 0 ? formatStarRate(topRate) : '—'}
          </p>
          <p className='text-[10px] text-muted-foreground'>Top performer rate</p>
        </div>
      </div>

      {/* ── Fairness callout ── */}
      <div className='flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900'>
        <Star className='mt-0.5 h-4 w-4 shrink-0 fill-amber-400 text-amber-400' />
        <div>
          <p className='font-semibold'>Two lenses, not one</p>
          <p className='text-xs text-amber-700 mt-0.5'>
            <strong>★ Star Rate</strong> (avg stars/test) is the fair performance comparison — equal for new hires and 10-year veterans.
            <strong> Total Stars</strong> honors loyalty and dedication. Click any column header to sort.
          </p>
        </div>
      </div>

      {/* ── Controls ── */}
      <div className='flex flex-wrap items-center gap-3'>
        {/* Quick period selector */}
        <div className='flex items-center gap-1 rounded-xl border bg-white p-1'>
          <Calendar className='h-3.5 w-3.5 text-muted-foreground ml-1.5' />
          {QUICK_PERIODS.map((p, i) => (
            <button
              key={p.label}
              type='button'
              onClick={() => applyQuick(i)}
              className={cn(
                'rounded-lg px-2.5 py-1 text-xs font-medium transition-all',
                activeQuick === i
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className='relative flex-1 min-w-[200px]'>
          <Search className='pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground' />
          <input
            type='text'
            placeholder='Search by name or email…'
            value={search}
            onChange={e => setSearch(e.target.value)}
            className='h-9 w-full rounded-lg border bg-white pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30'
          />
        </div>
      </div>

      {/* ── Table ── */}
      {loading ? (
        <LoadingState label='Loading performance data…' />
      ) : filtered.length === 0 ? (
        <EmptyState title='No data' description='No team members found or no tests have been completed yet.' />
      ) : (
        <div className='overflow-x-auto rounded-xl border bg-white shadow-sm'>
          <table className='w-full min-w-[640px] text-sm'>
            <thead>
              <tr className='border-b bg-muted/40 text-left text-xs text-muted-foreground'>
                {th('rank', '#', 'text-center w-10')}
                {th('name', 'Employee')}
                {th('tenure', 'Tenure')}
                {th('rate', <span>★ Star Rate <span className='rounded bg-amber-100 px-1 text-[9px] text-amber-700 font-semibold'>FAIR</span></span>)}
                {th('stars', hasPeriod ? 'Period Stars' : 'Total Stars')}
                {th('tests', hasPeriod ? 'Period Tests' : 'Tests')}
                {th('level', 'Level')}
                <th className='w-6' />
              </tr>
            </thead>
            <tbody>
              {filtered.map((m, i) => (
                <MemberRow
                  key={m.user_id}
                  member={m}
                  rank={i + 1}
                  hasPeriod={hasPeriod}
                  onNavigate={() => router.push('/assessments/my-profile')}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}
