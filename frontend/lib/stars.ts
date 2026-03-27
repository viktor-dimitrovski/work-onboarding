/**
 * Star system utilities — client-side calculations mirroring backend logic.
 * Single source of truth for thresholds, labels, colors, and player levels.
 */

// ── Star rating ────────────────────────────────────────────────────────────

export interface StarRating {
  stars: 1 | 2 | 3 | 4 | 5;
  label: string;
  message: string;
  color: string;       // Tailwind text color
  bgColor: string;     // Tailwind bg color (light)
  borderColor: string; // Tailwind border color
}

export function getStarRating(scorePct: number | null | undefined): StarRating {
  const pct = scorePct ?? 0;
  if (pct >= 90) return {
    stars: 5,
    label: 'Mastery!',
    message: '🎉 Perfect performance!',
    color: 'text-amber-500',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-300',
  };
  if (pct >= 75) return {
    stars: 4,
    label: 'Advanced',
    message: 'Really impressive!',
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-300',
  };
  if (pct >= 60) return {
    stars: 3,
    label: 'Skilled',
    message: 'Solid work!',
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-300',
  };
  if (pct >= 40) return {
    stars: 2,
    label: 'Learning',
    message: 'Getting there, keep going!',
    color: 'text-sky-500',
    bgColor: 'bg-sky-50',
    borderColor: 'border-sky-300',
  };
  return {
    stars: 1,
    label: 'Just Starting',
    message: 'You showed up — that counts!',
    color: 'text-slate-500',
    bgColor: 'bg-slate-50',
    borderColor: 'border-slate-300',
  };
}

export function starsFromScore(scorePct: number | null | undefined): 1 | 2 | 3 | 4 | 5 {
  return getStarRating(scorePct).stars;
}

// ── Player levels ─────────────────────────────────────────────────────────

export interface PlayerLevel {
  level: number;
  title: string;
  nextLevelStars: number | null;
  progressPct: number; // 0–100 toward next level
  minStars: number;
}

const LEVEL_THRESHOLDS: Array<[number, number, string]> = [
  [0,    1,  'Beginner'],
  [10,   2,  'Explorer'],
  [30,   3,  'Achiever'],
  [60,   4,  'Skilled'],
  [100,  5,  'Advanced'],
  [200,  6,  'Expert'],
  [350,  7,  'Champion'],
  [500,  8,  'Elite'],
  [750,  9,  'Legend'],
  [1000, 10, 'Master'],
];

export function getPlayerLevel(totalStars: number): PlayerLevel {
  let levelNum = 1;
  let title = 'Beginner';
  let minStars = 0;
  let nextLevelStars: number | null = 10;

  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    const [threshold, num, name] = LEVEL_THRESHOLDS[i];
    if (totalStars >= threshold) {
      levelNum = num;
      title = name;
      minStars = threshold;
      nextLevelStars = LEVEL_THRESHOLDS[i + 1]?.[0] ?? null;
    }
  }

  const progressPct = nextLevelStars
    ? Math.min(100, Math.round(((totalStars - minStars) / (nextLevelStars - minStars)) * 100))
    : 100;

  return { level: levelNum, title, nextLevelStars, progressPct, minStars };
}

// ── Achievement category colors ───────────────────────────────────────────

export const ACHIEVEMENT_CATEGORY_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  stars:   { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200' },
  tests:   { bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200' },
  skill:   { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  streak:  { bg: 'bg-orange-50',  text: 'text-orange-700',  border: 'border-orange-200' },
  special: { bg: 'bg-purple-50',  text: 'text-purple-700',  border: 'border-purple-200' },
};

// ── Star display helpers ──────────────────────────────────────────────────

/** Returns an array of 5 booleans: true = filled star, false = empty */
export function starArray(earned: number): boolean[] {
  return Array.from({ length: 5 }, (_, i) => i < earned);
}

/** Format star rate as a human-readable string */
export function formatStarRate(rate: number): string {
  return rate.toFixed(1);
}
