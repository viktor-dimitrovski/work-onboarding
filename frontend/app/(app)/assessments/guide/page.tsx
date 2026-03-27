'use client';

import React from 'react';
import { useRouter } from 'next/navigation';

import { starArray } from '@/lib/stars';
import { cn } from '@/lib/utils';
import { ArrowLeft, Star, Zap, Target, Trophy, Flame, Shield, ChevronRight } from 'lucide-react';

// ── Static data ───────────────────────────────────────────────────────────────

const STAR_TIERS = [
  { min: 90, max: 100, stars: 5, label: 'Mastery!',     message: 'You nailed it. Pure excellence.',        color: '#f59e0b', bg: '#fffbeb', border: '#fcd34d' },
  { min: 75, max:  89, stars: 4, label: 'Advanced',      message: 'Seriously impressive. Keep that up.',    color: '#10b981', bg: '#ecfdf5', border: '#6ee7b7' },
  { min: 60, max:  74, stars: 3, label: 'Skilled',       message: 'Solid work. You know your stuff.',       color: '#3b82f6', bg: '#eff6ff', border: '#93c5fd' },
  { min: 40, max:  59, stars: 2, label: 'Learning',      message: 'Getting better every time.',             color: '#0ea5e9', bg: '#f0f9ff', border: '#7dd3fc' },
  { min:  0, max:  39, stars: 1, label: 'Just Starting', message: 'You showed up. That already counts.',    color: '#94a3b8', bg: '#f8fafc', border: '#cbd5e1' },
];

const LEVELS = [
  { level: 1,  title: 'Beginner',  min: 0,    next: 10,   emoji: '🌱', desc: 'Every legend starts here.' },
  { level: 2,  title: 'Explorer',  min: 10,   next: 30,   emoji: '🔍', desc: 'You\'re figuring things out.' },
  { level: 3,  title: 'Achiever',  min: 30,   next: 60,   emoji: '🎯', desc: 'You mean business now.' },
  { level: 4,  title: 'Skilled',   min: 60,   next: 100,  emoji: '⚡', desc: 'People are noticing.' },
  { level: 5,  title: 'Advanced',  min: 100,  next: 200,  emoji: '🚀', desc: 'You\'re ahead of the curve.' },
  { level: 6,  title: 'Expert',    min: 200,  next: 350,  emoji: '🔥', desc: 'Top 20% of performers.' },
  { level: 7,  title: 'Champion',  min: 350,  next: 500,  emoji: '🏅', desc: 'You inspire others.' },
  { level: 8,  title: 'Elite',     min: 500,  next: 750,  emoji: '💎', desc: 'Few ever get here.' },
  { level: 9,  title: 'Legend',    min: 750,  next: 1000, emoji: '🌠', desc: 'You\'re the benchmark.' },
  { level: 10, title: 'Master',    min: 1000, next: null, emoji: '👑', desc: 'The highest honour.' },
];

const ACHIEVEMENTS = [
  // Stars
  { icon: '⭐', name: 'First Star',      category: 'stars',   how: 'Complete any test and earn at least 1 star. Your journey begins.',             rare: false },
  { icon: '🌟', name: 'Star Collector',  category: 'stars',   how: 'Accumulate 10 stars across all your tests. A strong start.',                  rare: false },
  { icon: '💫', name: 'Star Hoarder',    category: 'stars',   how: 'Reach 50 total stars. You\'re playing for real now.',                         rare: false },
  { icon: '🌠', name: 'Centurion',       category: 'stars',   how: 'Hit 100 total stars. Triple digits — elite territory.',                        rare: false },
  { icon: '🎆', name: 'Rising Star',     category: 'stars',   how: 'Collect 250 stars. You\'re on a trajectory most never reach.',                 rare: true  },
  { icon: '🌌', name: 'Galaxy Brain',    category: 'stars',   how: 'Earn 500 stars total. You\'ve outpaced 95% of learners.',                     rare: true  },
  { icon: '🏆', name: 'Legend',          category: 'stars',   how: 'Reach 1 000 stars. The absolute summit. Very few get here.',                  rare: true  },
  // Tests
  { icon: '📝', name: 'First Step',      category: 'tests',   how: 'Submit your very first test. The hardest step is always the first.',           rare: false },
  { icon: '📚', name: 'Bookworm',        category: 'tests',   how: 'Complete 10 tests. You\'re building a habit — that\'s everything.',           rare: false },
  { icon: '🎓', name: 'Graduate',        category: 'tests',   how: 'Finish 25 tests. This is commitment. Real commitment.',                        rare: false },
  { icon: '🔬', name: 'Researcher',      category: 'tests',   how: 'Complete 50 tests. You don\'t just learn — you study.',                       rare: true  },
  { icon: '🧠', name: 'Scholar',         category: 'tests',   how: '100 tests done. You are the knowledge.',                                       rare: true  },
  // Skill
  { icon: '💯', name: 'Perfect!',        category: 'skill',   how: 'Score 90%+ on any test for a 5-star Mastery rating. Once is enough.',         rare: false },
  { icon: '🎯', name: 'Sharpshooter',    category: 'skill',   how: 'Hit 5 stars three tests in a row. Consistency at the highest level.',          rare: true  },
  { icon: '✨', name: 'Excellence Club', category: 'skill',   how: 'Earn 5 stars on 10 different attempts. Not luck — pure mastery.',              rare: true  },
  { icon: '★',  name: 'High Achiever',   category: 'skill',   how: 'Maintain a Star Rate of 4.0+ across 10+ tests. You deliver every time.',      rare: true  },
  { icon: '★★', name: 'Elite Performer', category: 'skill',   how: 'Hold a 4.5+ Star Rate over 10+ tests. Near-perfect, consistently.',           rare: true  },
  // Streaks
  { icon: '🔥', name: 'On a Roll',       category: 'streak',  how: 'Take at least one test per week for 2 weeks running. Momentum matters.',       rare: false },
  { icon: '🔥', name: 'Hot Streak',      category: 'streak',  how: 'Keep your weekly streak alive for 4 weeks. You\'ve made it a lifestyle.',     rare: true  },
  { icon: '⚡', name: 'Unstoppable',     category: 'streak',  how: '8 consecutive weeks with a test completed. Absolute machine.',                 rare: true  },
  // Special
  { icon: '📈', name: 'Most Improved',   category: 'special', how: 'Score 2+ more stars on a re-take than your first attempt. Growth is real.',   rare: false },
  { icon: '🦅', name: 'Comeback',        category: 'special', how: 'Score 5 stars after a 1-star attempt on the same test. From zero to hero.',   rare: true  },
  { icon: '🎵', name: 'Consistent',      category: 'special', how: 'Never score below 3 stars across 10 tests. Cool, calm, collected.',            rare: true  },
];

const CATEGORY_META: Record<string, { label: string; icon: React.ReactNode; color: string; border: string; bg: string }> = {
  stars:   { label: 'Star Milestones',   icon: <Star className='h-4 w-4' />,   color: 'text-amber-700',   border: 'border-amber-300', bg: 'bg-amber-50'   },
  tests:   { label: 'Test Completion',   icon: <Target className='h-4 w-4' />, color: 'text-blue-700',    border: 'border-blue-300',  bg: 'bg-blue-50'    },
  skill:   { label: 'Performance',       icon: <Zap className='h-4 w-4' />,    color: 'text-emerald-700', border: 'border-emerald-300',bg: 'bg-emerald-50' },
  streak:  { label: 'Streaks',           icon: <Flame className='h-4 w-4' />,  color: 'text-orange-700',  border: 'border-orange-300',bg: 'bg-orange-50'  },
  special: { label: 'Special',           icon: <Shield className='h-4 w-4' />, color: 'text-purple-700',  border: 'border-purple-300',bg: 'bg-purple-50'  },
};

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ id, title, icon, accent, children }: {
  id: string;
  title: string;
  icon: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className='scroll-mt-6'>
      <div className={cn('mb-4 flex items-center gap-3 rounded-2xl px-5 py-3', accent)}>
        <span className='text-2xl'>{icon}</span>
        <h2 className='text-lg font-extrabold tracking-tight text-white'>{title}</h2>
      </div>
      {children}
    </section>
  );
}

// ── Star visual ───────────────────────────────────────────────────────────────

function StarDisplay({ count, size = 'md' }: { count: number; size?: 'sm' | 'md' | 'lg' }) {
  const s = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-7 w-7' }[size];
  return (
    <div className='flex gap-0.5'>
      {starArray(count).map((filled, i) => (
        <Star key={i} className={cn(s, filled ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200')} />
      ))}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function StarGuidePage() {
  const router = useRouter();
  const SECTIONS = [
    { id: 'stars',        label: '⭐ Stars',        },
    { id: 'weight',       label: '⚖️ Question Weight' },
    { id: 'starrate',     label: '📊 Star Rate'      },
    { id: 'levels',       label: '🚀 Levels'          },
    { id: 'achievements', label: '🏆 Achievements'    },
    { id: 'strategy',     label: '🎮 Strategy'        },
  ];

  return (
    <div className='mx-auto max-w-3xl space-y-10 pb-16'>

      {/* ── Back ── */}
      <button
        type='button'
        onClick={() => router.push('/assessments/my-profile')}
        className='inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors'
      >
        <ArrowLeft className='h-4 w-4' /> Back to my profile
      </button>

      {/* ── Hero ── */}
      <div className='relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 px-8 py-12 text-center shadow-2xl'>
        {/* decorative stars */}
        <div className='pointer-events-none absolute inset-0 overflow-hidden' aria-hidden>
          {['top-4 left-6', 'top-8 right-10', 'top-2 left-1/2', 'top-12 left-1/3', 'top-6 right-1/4'].map((pos, i) => (
            <Star key={i} className={cn('absolute h-4 w-4 fill-amber-400/20 text-amber-400/20', pos)} />
          ))}
          {['bottom-4 left-8', 'bottom-8 right-6', 'bottom-2 right-1/3', 'bottom-12 left-1/4'].map((pos, i) => (
            <Star key={i} className={cn('absolute h-3 w-3 fill-amber-300/15 text-amber-300/15', pos)} />
          ))}
        </div>
        <div className='relative'>
          <div className='mb-4 flex justify-center gap-1'>
            {[1,2,3,4,5].map(i => (
              <Star key={i} className='h-8 w-8 fill-amber-400 text-amber-400 drop-shadow-lg' />
            ))}
          </div>
          <h1 className='text-3xl font-black tracking-tight text-white sm:text-4xl'>
            How the Star System Works
          </h1>
          <p className='mt-3 text-base text-indigo-200 max-w-lg mx-auto leading-relaxed'>
            Every question you answer, every test you complete, every week you keep going — it all adds up.
            This is your guide to mastering the game.
          </p>
        </div>
      </div>

      {/* ── Quick nav ── */}
      <nav className='flex flex-wrap gap-2'>
        {SECTIONS.map(s => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className='rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:border-amber-400 hover:bg-amber-50 hover:text-amber-700 transition-all'
          >
            {s.label}
          </a>
        ))}
      </nav>

      {/* ══════════════════════════════════════════════════
          SECTION 1 — HOW STARS ARE EARNED
      ══════════════════════════════════════════════════ */}
      <Section id='stars' title='How Stars Are Earned' icon='⭐' accent='bg-gradient-to-r from-amber-500 to-amber-400'>
        <p className='mb-5 text-sm text-muted-foreground leading-relaxed'>
          When you finish a test, your score turns into <strong>1 to 5 stars</strong>. Think of it like a game rating screen —
          you always get at least 1 star just for showing up, and the more you know, the more stars you earn.
        </p>

        <div className='space-y-3'>
          {STAR_TIERS.map(tier => (
            <div
              key={tier.stars}
              className='flex items-center gap-4 rounded-2xl border px-5 py-4 shadow-sm transition-all hover:shadow-md'
              style={{ borderColor: tier.border, background: tier.bg }}
            >
              {/* Stars visual */}
              <div className='shrink-0'>
                <StarDisplay count={tier.stars} size='md' />
              </div>
              {/* Score range */}
              <div className='shrink-0 w-24 text-center'>
                <p className='text-lg font-black' style={{ color: tier.color }}>
                  {tier.min}–{tier.max}%
                </p>
                <p className='text-[10px] text-muted-foreground'>score</p>
              </div>
              {/* Label + message */}
              <div className='min-w-0'>
                <p className='font-extrabold text-sm' style={{ color: tier.color }}>{tier.label}</p>
                <p className='text-xs text-muted-foreground'>{tier.message}</p>
              </div>
              {/* Star count badge */}
              <div className='ml-auto shrink-0 rounded-full px-3 py-1 text-xs font-black' style={{ background: tier.color + '22', color: tier.color }}>
                +{tier.stars} ★
              </div>
            </div>
          ))}
        </div>

        <div className='mt-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm'>
          <span className='text-xl shrink-0'>💡</span>
          <p className='text-amber-800'>
            <strong>Stars stack up permanently.</strong> Every star you earn is added to your Total Stars forever.
            They never expire, never reset. Your collection is yours.
          </p>
        </div>
      </Section>

      {/* ══════════════════════════════════════════════════
          SECTION 2 — QUESTION WEIGHT
      ══════════════════════════════════════════════════ */}
      <Section id='weight' title='Question Weight & Difficulty' icon='⚖️' accent='bg-gradient-to-r from-violet-600 to-purple-500'>
        <p className='mb-5 text-sm text-muted-foreground leading-relaxed'>
          Not all questions are worth the same. Harder questions are weighted more — answer them correctly and
          your score jumps more than an easy question would.
          This makes the system fair and rewards real knowledge.
        </p>

        <div className='grid grid-cols-3 gap-3 mb-6'>
          {[
            { diff: 'Easy',   weight: '×1', emoji: '🟢', desc: 'Standard questions. Get these right — they\'re the foundation.' },
            { diff: 'Medium', weight: '×2', emoji: '🟡', desc: 'Worth double. Answering these correctly gives you a real boost.' },
            { diff: 'Hard',   weight: '×3', emoji: '🔴', desc: 'Worth triple. These separate the good from the great.' },
          ].map(d => (
            <div key={d.diff} className='rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm'>
              <div className='text-2xl mb-2'>{d.emoji}</div>
              <p className='font-black text-sm text-foreground'>{d.diff}</p>
              <p className='text-2xl font-black text-violet-600 my-1'>{d.weight}</p>
              <p className='text-[10px] text-muted-foreground leading-snug'>{d.desc}</p>
            </div>
          ))}
        </div>

        <div className='rounded-2xl border border-violet-200 bg-violet-50 p-5'>
          <p className='text-xs font-bold text-violet-800 uppercase tracking-wider mb-3'>How your score is calculated</p>
          <div className='rounded-xl bg-white border border-violet-100 px-5 py-4 text-center'>
            <p className='text-sm text-slate-500 mb-1'>Your weighted score</p>
            <div className='flex items-center justify-center gap-3 text-base font-black text-slate-800'>
              <span className='rounded-lg bg-emerald-100 px-3 py-1 text-emerald-700'>Σ correct weights</span>
              <span className='text-slate-400'>÷</span>
              <span className='rounded-lg bg-slate-100 px-3 py-1'>Σ all weights</span>
              <span className='text-slate-400'>×</span>
              <span className='rounded-lg bg-amber-100 px-3 py-1 text-amber-700'>100</span>
            </div>
          </div>
          <p className='mt-3 text-[11px] text-violet-700 leading-relaxed'>
            <strong>Example:</strong> A test has 3 questions — Easy (×1), Medium (×2), Hard (×3). Total weight = 6.
            If you get the Medium and Hard right, you scored 5/6 = <strong>83%</strong> → that&apos;s 4 stars! ⭐⭐⭐⭐
          </p>
        </div>
      </Section>

      {/* ══════════════════════════════════════════════════
          SECTION 3 — STAR RATE
      ══════════════════════════════════════════════════ */}
      <Section id='starrate' title='Star Rate — The Fair Metric' icon='📊' accent='bg-gradient-to-r from-emerald-600 to-teal-500'>
        <p className='mb-5 text-sm text-muted-foreground leading-relaxed'>
          Total Stars show your journey — but they grow naturally with time. A person who&apos;s been here 5 years
          will always have more Total Stars than someone who just joined. That&apos;s <em>not fair</em> for comparison.
        </p>
        <p className='mb-5 text-sm text-muted-foreground leading-relaxed'>
          <strong className='text-foreground'>Star Rate solves this.</strong> It&apos;s your <em>average stars per test</em>. It doesn&apos;t matter
          if you&apos;ve taken 3 tests or 300 — Star Rate tells the truth about how good you actually are.
        </p>

        <div className='rounded-2xl border border-emerald-200 bg-emerald-50 p-5 mb-5'>
          <p className='text-xs font-bold text-emerald-800 uppercase tracking-wider mb-3'>The formula</p>
          <div className='flex items-center justify-center gap-4 rounded-xl bg-white border border-emerald-100 px-6 py-5'>
            <div className='text-center'>
              <p className='text-3xl font-black text-emerald-600'>★ Rate</p>
            </div>
            <span className='text-2xl text-slate-400'>=</span>
            <div className='text-center'>
              <p className='text-base font-bold text-foreground border-b-2 border-slate-300 pb-1 mb-1'>Total Stars</p>
              <p className='text-base font-bold text-muted-foreground'>Total Tests</p>
            </div>
          </div>
          <p className='mt-3 text-[11px] text-emerald-700'>
            <strong>Example:</strong> You&apos;ve taken 8 tests and earned 28 stars total → Star Rate = 28 ÷ 8 = <strong>3.5 ★</strong>
          </p>
        </div>

        <div className='grid grid-cols-2 gap-3'>
          {[
            { rate: '1.0 – 1.9', label: 'Just Starting', color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200', tip: 'Showing up. Every rep counts.' },
            { rate: '2.0 – 2.9', label: 'Learning',       color: 'text-sky-600',   bg: 'bg-sky-50',   border: 'border-sky-200',   tip: 'You\'re getting it. Keep pushing.' },
            { rate: '3.0 – 3.9', label: 'Skilled',        color: 'text-blue-600',  bg: 'bg-blue-50',  border: 'border-blue-200',  tip: 'Solid performer. Above average.' },
            { rate: '4.0 – 4.4', label: 'Advanced',       color: 'text-emerald-600',bg: 'bg-emerald-50',border: 'border-emerald-200',tip: 'Elite tier. High Achiever badge awaits.' },
            { rate: '4.5 – 4.9', label: 'Master Class',   color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', tip: 'Elite Performer achievement territory.' },
            { rate: '5.0',       label: 'Perfect',         color: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-300', tip: '5/5 every single time. Theoretical ceiling.' },
          ].map(r => (
            <div key={r.rate} className={cn('rounded-xl border p-3', r.bg, r.border)}>
              <p className={cn('text-lg font-black', r.color)}>{r.rate} ★</p>
              <p className={cn('text-xs font-bold', r.color)}>{r.label}</p>
              <p className='text-[10px] text-muted-foreground mt-0.5'>{r.tip}</p>
            </div>
          ))}
        </div>

        <div className='mt-4 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm'>
          <span className='text-xl shrink-0'>⚖️</span>
          <p className='text-emerald-800 text-xs leading-relaxed'>
            New hires and veterans are on equal footing.
          </p>
        </div>
      </Section>

      {/* ══════════════════════════════════════════════════
          SECTION 4 — LEVELS
      ══════════════════════════════════════════════════ */}
      <Section id='levels' title='Levels — Your Growth Journey' icon='🚀' accent='bg-gradient-to-r from-blue-600 to-indigo-500'>
        <p className='mb-5 text-sm text-muted-foreground leading-relaxed'>
          Levels are based on your <strong>Total Stars</strong> — the full history of your effort and dedication.
          Unlike Star Rate (which stays flat when you perform consistently), your Level always grows.
          It&apos;s a permanent record of how far you&apos;ve come.
        </p>

        <div className='space-y-2'>
          {LEVELS.map((lv, i) => {
            const isMax = lv.next === null;
            const progressExample = isMax ? 100 : 60;
            return (
              <div
                key={lv.level}
                className={cn(
                  'flex items-center gap-4 rounded-2xl border px-4 py-3 transition-all',
                  i < 3 ? 'border-slate-200 bg-white' :
                  i < 6 ? 'border-blue-100 bg-blue-50/50' :
                  i < 9 ? 'border-indigo-100 bg-indigo-50/50' :
                  'border-amber-200 bg-amber-50',
                )}
              >
                {/* Emoji + level number */}
                <div className='shrink-0 flex flex-col items-center w-10'>
                  <span className='text-xl'>{lv.emoji}</span>
                  <span className='text-[10px] font-black text-muted-foreground'>Lv {lv.level}</span>
                </div>
                {/* Title + desc */}
                <div className='flex-1 min-w-0'>
                  <p className={cn('font-extrabold text-sm', isMax ? 'text-amber-600' : 'text-foreground')}>{lv.title}</p>
                  <p className='text-[10px] text-muted-foreground'>{lv.desc}</p>
                </div>
                {/* Stars required */}
                <div className='shrink-0 text-right'>
                  <p className='text-sm font-black text-amber-600'>{lv.min.toLocaleString()} ★</p>
                  {lv.next && <p className='text-[10px] text-muted-foreground'>next: {lv.next.toLocaleString()}</p>}
                  {isMax && <p className='text-[10px] text-amber-600 font-bold'>MAX ✓</p>}
                </div>
                {/* Fake progress bar width as visual differentiation */}
                <div className='shrink-0 hidden sm:block w-16'>
                  <div className='h-1.5 rounded-full bg-slate-100 overflow-hidden'>
                    <div className='h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500'
                      style={{ width: `${Math.round((lv.level / 10) * 100)}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className='mt-4 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4'>
          <span className='text-xl shrink-0'>🎮</span>
          <p className='text-blue-800 text-xs leading-relaxed'>
            <strong>Levels never decrease.</strong> You can&apos;t lose a level. Once you reach Champion,
            you stay Champion. Your growth is permanent and visible to your whole team.
          </p>
        </div>
      </Section>

      {/* ══════════════════════════════════════════════════
          SECTION 5 — ACHIEVEMENTS
      ══════════════════════════════════════════════════ */}
      <Section id='achievements' title='Achievements — The Exciting Part 🎉' icon='🏆' accent='bg-gradient-to-r from-rose-500 to-pink-500'>
        <p className='mb-2 text-sm text-muted-foreground leading-relaxed'>
          Achievements are badges you unlock by hitting special milestones. They&apos;re not automatic —
          you have to <em>earn</em> them. Some are easy. Some will take months. A few are so rare,
          most people never get them.
        </p>
        <p className='mb-6 text-sm text-muted-foreground'>
          <span className='inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-600'>
            💎 RARE
          </span>
          {' '}badges mark achievements only the best manage to unlock.
        </p>

        {Object.entries(CATEGORY_META).map(([cat, meta]) => {
          const list = ACHIEVEMENTS.filter(a => a.category === cat);
          return (
            <div key={cat} className='mb-8'>
              <div className={cn('flex items-center gap-2 mb-3 rounded-xl border px-3 py-2', meta.bg, meta.border)}>
                <span className={meta.color}>{meta.icon}</span>
                <p className={cn('text-sm font-extrabold', meta.color)}>{meta.label}</p>
                <span className={cn('ml-auto text-[10px] font-bold', meta.color)}>{list.length} achievements</span>
              </div>
              <div className='space-y-2'>
                {list.map(a => (
                  <div
                    key={a.name}
                    className={cn(
                      'flex items-start gap-4 rounded-xl border px-4 py-3',
                      meta.bg, meta.border,
                    )}
                  >
                    <span className='text-2xl shrink-0 mt-0.5'>{a.icon}</span>
                    <div className='flex-1 min-w-0'>
                      <div className='flex items-center gap-2 flex-wrap'>
                        <p className={cn('font-extrabold text-sm', meta.color)}>{a.name}</p>
                        {a.rare && (
                          <span className='rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[9px] font-black text-rose-600 shrink-0'>
                            💎 RARE
                          </span>
                        )}
                      </div>
                      <p className='text-[11px] text-muted-foreground mt-0.5 leading-relaxed'>{a.how}</p>
                    </div>
                    <ChevronRight className={cn('h-4 w-4 shrink-0 mt-1 opacity-30', meta.color)} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </Section>

      {/* ══════════════════════════════════════════════════
          SECTION 6 — STRATEGY TIPS
      ══════════════════════════════════════════════════ */}
      <Section id='strategy' title='Strategy — How to Play Smart' icon='🎮' accent='bg-gradient-to-r from-slate-700 to-slate-600'>
        <div className='grid gap-4 sm:grid-cols-2'>
          {[
            {
              emoji: '🔄',
              title:  'Retake and improve',
              body:   'Got a bad score? Retake the test. If you jump 2 or more stars, you unlock Most Improved. Going from 1★ to 5★ earns you the legendary Comeback badge.',
              color:  'border-blue-200 bg-blue-50',
              text:   'text-blue-800',
            },
            {
              emoji: '📅',
              title:  'Show up every week',
              body:   'Even one test per week is enough to build your streak. Consistency beats intensity. On a Roll, Hot Streak, Unstoppable — they\'re all waiting for you.',
              color:  'border-orange-200 bg-orange-50',
              text:   'text-orange-800',
            },
            {
              emoji: '🎯',
              title:  'Target hard questions',
              body:   'Hard questions (×3 weight) move your score dramatically. One correct hard answer beats three correct easy ones. Know the material and go for it.',
              color:  'border-violet-200 bg-violet-50',
              text:   'text-violet-800',
            },
            {
              emoji: '📈',
              title:  'Protect your Star Rate',
              body:   'Star Rate is a running average. A single 1-star test drags it down. If you\'re tired or unprepared — it\'s OK to wait. Quality over quantity for rate.',
              color:  'border-emerald-200 bg-emerald-50',
              text:   'text-emerald-800',
            },
            {
              emoji: '🌠',
              title:  'Chase milestones in order',
              body:   'Star milestones from ⭐ to 🏆 stack sequentially. You don\'t need to do anything special — just keep completing tests and they\'ll unlock naturally.',
              color:  'border-amber-200 bg-amber-50',
              text:   'text-amber-800',
            },
            {
              emoji: '💯',
              title:  'Go for Perfect runs',
              body:   'Hit 90%+ and earn 5 stars. Three 5-star tests in a row unlocks Sharpshooter. Ten 5-star attempts earns Excellence Club. Aim high, always.',
              color:  'border-rose-200 bg-rose-50',
              text:   'text-rose-800',
            },
          ].map(tip => (
            <div key={tip.title} className={cn('rounded-2xl border p-4', tip.color)}>
              <div className='flex items-center gap-2 mb-2'>
                <span className='text-xl'>{tip.emoji}</span>
                <p className={cn('font-extrabold text-sm', tip.text)}>{tip.title}</p>
              </div>
              <p className={cn('text-xs leading-relaxed', tip.text.replace('800', '700'))}>{tip.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── CTA ── */}
      <div className='relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 px-8 py-10 text-center'>
        <div className='pointer-events-none absolute inset-0' aria-hidden>
          {[1,2,3,4,5].map(i => (
            <Star key={i} className='absolute h-3 w-3 fill-amber-400/10 text-amber-400/10'
              style={{ top: `${10 + i * 15}%`, left: `${5 + i * 18}%` }} />
          ))}
        </div>
        <p className='relative text-2xl font-black text-white mb-2'>You know the rules.<br />Now go earn those stars. 🌟</p>
        <p className='relative text-sm text-indigo-300 mb-6'>Every test is a chance to grow. Every star is proof you did.</p>
        <button
          type='button'
          onClick={() => router.push('/assessments/my-profile')}
          className='inline-flex items-center gap-2 rounded-full bg-amber-400 px-6 py-3 text-sm font-black text-slate-900 shadow-lg hover:bg-amber-300 transition-colors'
        >
          <Star className='h-4 w-4 fill-slate-900 text-slate-900' />
          View My Profile
        </button>
      </div>

    </div>
  );
}
