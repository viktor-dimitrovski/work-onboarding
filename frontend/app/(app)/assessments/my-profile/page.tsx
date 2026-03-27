'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { StarProfile, Achievement } from '@/lib/types';
import {
  getPlayerLevel,
  getStarRating,
  starArray,
  formatStarRate,
  ACHIEVEMENT_CATEGORY_STYLE,
} from '@/lib/stars';
import { BookOpen, Star, Trophy, BarChart3, ClipboardList, ChevronRight, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Sub-components ────────────────────────────────────────────────────────────

function StarRow({ count, total = 5, size = 'md' }: { count: number; total?: number; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClass = { sm: 'h-3.5 w-3.5', md: 'h-5 w-5', lg: 'h-7 w-7' }[size];
  return (
    <div className='flex items-center gap-0.5'>
      {Array.from({ length: total }, (_, i) => (
        <Star
          key={i}
          className={cn(sizeClass, i < count ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200')}
        />
      ))}
    </div>
  );
}

function LevelProgressBar({ totalStars }: { totalStars: number }) {
  const level = getPlayerLevel(totalStars);
  const { progressPct, nextLevelStars, minStars, title, level: levelNum } = level;

  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between text-sm'>
        <span className='font-semibold text-foreground'>Level {levelNum} — {title}</span>
        {nextLevelStars ? (
          <span className='text-xs text-muted-foreground'>
            {totalStars - minStars} / {nextLevelStars - minStars} stars to Level {levelNum + 1}
          </span>
        ) : (
          <span className='text-xs text-amber-600 font-semibold'>⭐ Max Level Reached!</span>
        )}
      </div>
      <div className='h-3 w-full rounded-full bg-slate-100 overflow-hidden'>
        <div
          className='h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all duration-700'
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}

function AchievementCard({ a }: { a: Achievement }) {
  const style = ACHIEVEMENT_CATEGORY_STYLE[a.category] ?? ACHIEVEMENT_CATEGORY_STYLE.special;
  return (
    <div
      className={cn(
        'relative flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-all',
        a.unlocked
          ? cn('shadow-sm', style.bg, style.border)
          : 'border-slate-200 bg-slate-50 opacity-50',
      )}
    >
      {!a.unlocked && (
        <Lock className='absolute right-2 top-2 h-3 w-3 text-slate-400' />
      )}
      <span className={cn('text-2xl leading-none', !a.unlocked && 'grayscale')}>{a.icon}</span>
      <p className={cn('text-[11px] font-bold leading-tight', a.unlocked ? style.text : 'text-slate-400')}>
        {a.name}
      </p>
      <p className='text-[10px] text-muted-foreground leading-snug'>{a.description}</p>
      {a.unlocked && a.unlocked_at && (
        <p className='text-[9px] text-muted-foreground mt-0.5'>
          {new Date(a.unlocked_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
      )}
    </div>
  );
}

function StarHistoryBar({ recentStars }: { recentStars: Array<{ stars_earned: number; submitted_at: string | null }> }) {
  if (recentStars.length === 0) return null;
  const maxStars = 5;
  const reversed = [...recentStars].reverse();

  return (
    <div>
      <p className='mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground'>Recent test history</p>
      <div className='flex items-end gap-1 h-12'>
        {reversed.map((r, i) => {
          const h = Math.max(4, Math.round((r.stars_earned / maxStars) * 40));
          const rating = getStarRating((r.stars_earned / maxStars) * 100);
          return (
            <div
              key={i}
              title={`${r.stars_earned} stars — ${r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : ''}`}
              className={cn('flex-1 rounded-t-sm min-w-0 cursor-default transition-all hover:opacity-80', rating.bgColor.replace('bg-', 'bg-'))}
              style={{ height: `${h}px`, backgroundColor: undefined }}
            >
              <div
                className='w-full h-full rounded-t-sm'
                style={{
                  background: r.stars_earned >= 5 ? '#f59e0b' :
                               r.stars_earned >= 4 ? '#10b981' :
                               r.stars_earned >= 3 ? '#3b82f6' :
                               r.stars_earned >= 2 ? '#0ea5e9' : '#94a3b8',
                }}
              />
            </div>
          );
        })}
      </div>
      <div className='flex justify-between mt-1 text-[9px] text-muted-foreground'>
        <span>older</span>
        <span>recent</span>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  stars: '⭐ Star Milestones',
  tests: '📋 Test Completion',
  skill: '💯 Performance',
  streak: '🔥 Streaks',
  special: '🦅 Special',
};

export default function MyStarProfilePage() {
  const { accessToken, user } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<StarProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'achievements'>('overview');

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    api
      .get<StarProfile>('/assessments/my-profile', accessToken)
      .then(setProfile)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load profile'))
      .finally(() => setLoading(false));
  }, [accessToken]);

  if (loading) return <LoadingState label='Loading your star profile…' />;
  if (error) return (
    <div className='flex min-h-[40vh] items-center justify-center'>
      <p className='text-sm text-destructive'>{error}</p>
    </div>
  );
  if (!profile) return null;

  const level = getPlayerLevel(profile.total_stars);

  // Group achievements by category
  const byCategory: Record<string, Achievement[]> = {};
  for (const a of profile.achievements) {
    if (!byCategory[a.category]) byCategory[a.category] = [];
    byCategory[a.category].push(a);
  }

  const unlockedAchievements = profile.achievements.filter(a => a.unlocked);
  const recentUnlocked = unlockedAchievements
    .sort((a, b) => (b.unlocked_at ?? '').localeCompare(a.unlocked_at ?? ''))
    .slice(0, 4);

  return (
    <div className='mx-auto max-w-2xl space-y-5'>

      {/* ── Page header ── */}
      <div className='flex items-center justify-between gap-3'>
        <h2 className='text-xl font-extrabold tracking-tight flex items-center gap-2'>
          <Star className='h-5 w-5 fill-amber-400 text-amber-400' />
          My Star Profile
        </h2>
        <button
          type='button'
          onClick={() => router.push('/assessments/guide')}
          className='inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 hover:border-amber-300 transition-all'
        >
          <BookOpen className='h-3.5 w-3.5' />
          How it works
        </button>
      </div>

      {/* ── Profile hero card ── */}
      <div className='rounded-2xl border bg-gradient-to-br from-amber-50 via-white to-white shadow-sm overflow-hidden'>
        <div className='px-5 pt-5 pb-4'>
          <div className='flex items-start gap-4'>
            {/* Avatar / level badge */}
            <div className='flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-amber-100 border-2 border-amber-200'>
              <Star className='h-7 w-7 fill-amber-400 text-amber-400' />
              <p className='text-[10px] font-bold text-amber-700 mt-0.5'>LVL {level.level}</p>
            </div>

            <div className='flex-1 min-w-0'>
              <h1 className='text-xl font-extrabold text-foreground truncate'>
                {user?.full_name || user?.email || 'Your Profile'}
              </h1>
              <p className='text-sm text-amber-600 font-semibold mt-0.5'>{level.title}</p>
              <div className='mt-2 flex flex-wrap gap-3'>
                <span className='inline-flex items-center gap-1 text-sm font-semibold text-foreground'>
                  <Star className='h-4 w-4 fill-amber-400 text-amber-400' />
                  {profile.total_stars} stars
                </span>
                <span className='text-sm text-muted-foreground'>·</span>
                <span className='text-sm font-semibold text-foreground'>
                  ★ {formatStarRate(profile.star_rate)} rate
                </span>
                <span className='text-sm text-muted-foreground'>·</span>
                <span className='text-sm text-muted-foreground'>
                  {profile.tests_completed} tests
                </span>
              </div>
            </div>
          </div>

          {/* Level progress */}
          <div className='mt-4'>
            <LevelProgressBar totalStars={profile.total_stars} />
          </div>
        </div>

        {/* Stat strip */}
        <div className='grid grid-cols-3 divide-x border-t'>
          <div className='px-3 py-3 text-center'>
            <p className='text-xl font-extrabold text-amber-500'>{profile.total_stars}</p>
            <p className='text-[10px] font-medium text-muted-foreground'>Total Stars</p>
          </div>
          <div className='px-3 py-3 text-center'>
            <p className='text-xl font-extrabold'>{formatStarRate(profile.star_rate)}</p>
            <p className='text-[10px] font-medium text-muted-foreground'>★ Star Rate</p>
          </div>
          <div className='px-3 py-3 text-center'>
            <p className='text-xl font-extrabold text-emerald-600'>{profile.unlocked_count}</p>
            <p className='text-[10px] font-medium text-muted-foreground'>Achievements</p>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className='flex rounded-xl border bg-muted/40 p-1 gap-1'>
        {(['overview', 'achievements'] as const).map((tab) => (
          <button
            key={tab}
            type='button'
            onClick={() => setActiveTab(tab)}
            className={cn(
              'flex-1 rounded-lg py-2 text-sm font-semibold transition-all',
              activeTab === tab
                ? 'bg-white shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab === 'overview' ? '📊 Overview' : '🏆 Achievements'}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <>
          {/* Star history */}
          {profile.recent_attempt_stars.length > 0 && (
            <div className='rounded-2xl border bg-white p-4 shadow-sm'>
              <StarHistoryBar recentStars={profile.recent_attempt_stars} />
            </div>
          )}

          {/* Recent achievements */}
          {recentUnlocked.length > 0 && (
            <div className='rounded-2xl border bg-white p-4 shadow-sm space-y-3'>
              <div className='flex items-center justify-between'>
                <p className='font-semibold text-sm'>Recent achievements</p>
                <button
                  type='button'
                  onClick={() => setActiveTab('achievements')}
                  className='inline-flex items-center gap-0.5 text-xs text-primary hover:underline'
                >
                  View all <ChevronRight className='h-3.5 w-3.5' />
                </button>
              </div>
              <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                {recentUnlocked.map(a => <AchievementCard key={a.code} a={a} />)}
              </div>
            </div>
          )}

          {/* Empty state for new users */}
          {profile.total_stars === 0 && (
            <div className='rounded-2xl border border-dashed bg-white p-8 text-center'>
              <Star className='mx-auto h-10 w-10 text-amber-300 fill-amber-100 mb-3' />
              <p className='font-semibold text-foreground'>Start collecting stars!</p>
              <p className='mt-1 text-sm text-muted-foreground'>
                Complete any test to earn your first star and begin your journey.
              </p>
              <div className='mt-4 flex flex-wrap items-center justify-center gap-2'>
                <button
                  type='button'
                  onClick={() => router.push('/assessments/my-tests')}
                  className='inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90'
                >
                  <ClipboardList className='h-4 w-4' />
                  Go to My Tests
                </button>
                <button
                  type='button'
                  onClick={() => router.push('/assessments/guide')}
                  className='inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100'
                >
                  <BookOpen className='h-4 w-4' />
                  How it works
                </button>
              </div>
            </div>
          )}

          {/* Quick stats */}
          {profile.tests_completed > 0 && (
            <div className='grid grid-cols-2 gap-3'>
              <div className='rounded-xl border bg-white p-4 shadow-sm'>
                <p className='text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1'>Best performance</p>
                <div className='flex items-center gap-2'>
                  <StarRow count={5} size='sm' />
                  <span className='text-sm text-muted-foreground'>5 ⭐ Mastery</span>
                </div>
                <p className='mt-1 text-xs text-muted-foreground'>
                  {profile.achievements.find(a => a.code === 'perfect_score')?.unlocked
                    ? '✅ Achieved'
                    : 'Keep pushing for 90%+'}
                </p>
              </div>
              <div className='rounded-xl border bg-white p-4 shadow-sm'>
                <p className='text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1'>Consistency</p>
                <p className='text-2xl font-extrabold text-foreground'>{formatStarRate(profile.star_rate)}</p>
                <p className='mt-0.5 text-xs text-muted-foreground'>avg stars per test</p>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'achievements' && (
        <div className='space-y-5'>
          <div className='flex items-center gap-2 text-sm text-muted-foreground'>
            <Trophy className='h-4 w-4' />
            <span>{profile.unlocked_count} / {profile.total_achievement_count} achievements unlocked</span>
          </div>

          {Object.entries(CATEGORY_LABELS).map(([cat, label]) => {
            const items = byCategory[cat] ?? [];
            if (items.length === 0) return null;
            const unlockedInCat = items.filter(a => a.unlocked).length;
            return (
              <div key={cat} className='space-y-2'>
                <div className='flex items-center justify-between'>
                  <p className='font-semibold text-sm'>{label}</p>
                  <span className='text-xs text-muted-foreground'>{unlockedInCat}/{items.length}</span>
                </div>
                <div className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
                  {items.map(a => <AchievementCard key={a.code} a={a} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
