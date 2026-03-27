# Plan: Star System & Achievements — Gamified Assessments

> Replaces the binary "Pass / Fail" system with a **star-based game mechanic**.
> Every completed test earns stars. Stars unlock achievements (badges).
> Each person has a visible profile with their total stars, badges, and history.
> Managers get the same data as structured performance insight.
> Works equally well for corporate teams and school students.

---

## Core Concept

```
Every question has a weight (Easy=1, Medium=2, Hard=3)
Every correct answer earns weighted star-points
Attempt score = weighted_correct / weighted_total → 1–5 ⭐
Stars accumulate on your profile → 🏆 Achievements unlock
Profile shows two metrics: Total Stars (journey) + Star Rate (performance)
```

---

## Star Design: Two Separate Metrics

This is the key to making the system **fair for everyone** — new hires, veterans,
high-position starters, and long-tenured staff alike.

### Metric 1 — Total Stars ⭐ (Personal Journey)
- Accumulates forever, never resets
- Used for: player levels, personal achievements, motivation, showing dedication
- **Not** used for cross-employee comparison
- A 10-year employee naturally has more — this is a feature, not a bug.
  It shows loyalty and experience. Think of it as their "all-time high score".

### Metric 2 — Star Rate ★ (Performance Quality)
- `star_rate = total_stars / tests_completed` → a number between 1.0 and 5.0
- **Directly comparable across all employees regardless of tenure or test count**
- New hire who scores ⭐⭐⭐⭐⭐ on every test = Star Rate 5.0
  Veteran who averages ⭐⭐⭐ across hundreds of tests = Star Rate 3.0
  The new hire is immediately visible as a high-performer.
- Used for: team comparison, manager dashboard, performance reviews

### Metric 3 — Category Coverage 🗺️ (Breadth)
- Count of distinct categories where employee has earned ≥ 4 stars at least once
- Also tenure-neutral — a new expert in 3 areas ranks alongside a veteran in 3 areas
- Shows knowledge breadth, not just raw quantity

### Summary table

| Metric         | What it shows              | Fair for comparison? | Resets? |
|----------------|----------------------------|----------------------|---------|
| Total Stars    | Dedication, journey, tenure| No (intentionally)   | Never   |
| Star Rate      | Performance quality         | ✅ Yes               | Never   |
| Category Coverage | Knowledge breadth        | ✅ Yes               | Never   |
| Player Level   | Recognition tier (from stars)| No (intentionally) | Never   |

---

## Per-Question Star Weighting

Each question has a `difficulty` field already in the database:
`easy` = weight **1**, `medium` = weight **2**, `hard` = weight **3**

### How attempt stars are calculated

```
weighted_total   = sum of weight for all questions in attempt
weighted_correct = sum of weight for each correctly answered question

weighted_score_pct = (weighted_correct / weighted_total) × 100

stars_earned = star threshold table below
```

### Star thresholds (from weighted score)

| Weighted Score | Stars | Label          | Message                           |
|----------------|-------|----------------|-----------------------------------|
| 0 – 39%        | ⭐    | Just Starting  | "You showed up — that counts!"    |
| 40 – 59%       | ⭐⭐   | Learning       | "Getting there, keep going!"      |
| 60 – 74%       | ⭐⭐⭐  | Skilled        | "Solid work!"                     |
| 75 – 89%       | ⭐⭐⭐⭐ | Advanced       | "Really impressive!"              |
| 90 – 100%      | ⭐⭐⭐⭐⭐| Mastery!       | "🎉 Perfect performance!"         |

> **Design principle**: completing any test always earns at least 1 star.
> Nobody finishes a test feeling like they got zero — this keeps engagement high.

> **Weighted scoring example**:
> Test has 5 easy + 3 hard questions. All easy correct, all hard wrong.
> `weighted_correct = 5×1 = 5`, `weighted_total = 5×1 + 3×3 = 14`
> `weighted_score = 35.7%` → ⭐ (1 star)
> Simple flat scoring would show 62.5% → ⭐⭐⭐ (3 stars) — misleading!
> Weighting reveals the real mastery picture.

---

## Phase 1 — Weighted Star Rating on Every Attempt
> Frontend + small backend change. No DB migration. ~1–2 day effort.

### What changes visually
- Replace "Passed!" / "Not passed" heading with **star burst animation** + star count + label
- Replace green/red "Pass/Fail" badges everywhere with **star badge** (⭐⭐⭐ Skilled)
- The result screen shows: stars earned this attempt + running total

### Files to create
- `frontend/lib/stars.ts`
  — `getStarRating(weightedScorePct): { stars: 1|2|3|4|5, label: string, color: string }`
  — `StarDisplay` component (filled/empty star icons with optional burst animation)

### Files to change (frontend)
- `frontend/app/(app)/assessments/take/[deliveryId]/page.tsx`
  — Replace result heading/icon with animated star burst + label
- `frontend/app/(app)/assessments/review/[attemptId]/page.tsx`
  — Replace Pass/Fail badge with star badge
- `frontend/app/(app)/assessments/my-results/page.tsx`
  — Replace Pass/Fail column & summary cards with star ratings + Star Rate display
- `frontend/app/(app)/assessments/results/page.tsx` *(manager view)*
  — Replace Pass/Fail badges with star badges

### Backend change (no migration)
- In scoring function: compute `weighted_score_pct` from question difficulty weights,
  then derive `stars_earned` (1–5). Store in `assessment_attempts.stars_earned` (added in Phase 2).
- `AssessmentAttemptOut` schema: add `stars_earned`, `weighted_score_pct`
- The existing `score_percent` stays for backward compatibility (it becomes the flat score).

---

## Phase 2 — Cumulative Stars in the Database
> Requires 1 DB migration. Stars accumulate per user. ~1 day effort.

### DB migration: `0047_star_system`
```sql
-- Lifetime stars earned (never decreases)
ALTER TABLE tenant_memberships ADD COLUMN total_stars   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenant_memberships ADD COLUMN tests_completed INTEGER NOT NULL DEFAULT 0;
-- star_rate is computed: total_stars / NULLIF(tests_completed, 0)

-- Stars awarded per attempt (1–5, set when attempt is scored)
ALTER TABLE assessment_attempts ADD COLUMN stars_earned      SMALLINT NULL;
ALTER TABLE assessment_attempts ADD COLUMN weighted_score_pct FLOAT    NULL;
```

### Backend changes
- In attempt scoring:
  1. Compute `weighted_correct` and `weighted_total` from question difficulty
  2. Set `attempt.weighted_score_pct`
  3. Set `attempt.stars_earned` from thresholds
  4. `UPDATE tenant_memberships SET total_stars = total_stars + stars_earned, tests_completed = tests_completed + 1`
- `GET /users/me/stars` → `{ total_stars, tests_completed, star_rate, category_coverage }`
- Add `stars_earned`, `weighted_score_pct` to `AssessmentAttemptOut`
- Add `total_stars`, `star_rate`, `tests_completed` to `MyResultsResponse`

### Frontend changes
- `take/page.tsx` — show "+3 ⭐ earned!" on result screen with animation
- `my-results/page.tsx` — add star hero widget:
  "You have collected 47 ⭐  |  Star Rate: ★ 3.8 / 5  |  12 tests completed"

---

## Phase 3 — Personal Star Profile Page
> Requires Phase 2. New page. ~2 days effort.

### New page: `/assessments/my-profile`

```
┌──────────────────────────────────────────────────────┐
│  🌟  Alex Johnson                Level 6 — Expert     │
│                                                       │
│  ⭐ 247 Total Stars               ★ 4.1 Star Rate    │
│  📋 38 Tests completed            🗺️ 5 Categories    │
│                                                       │
│  ▓▓▓▓▓▓▓░░░  247 / 300 stars to Level 7             │
└──────────────────────────────────────────────────────┘
│  Achievements (12 unlocked / 28 total)                │
│  ⭐ First Star   📚 10 Tests   🔥 On a Roll   💯 Perfect │
│  [ View all achievements ]                            │
└──────────────────────────────────────────────────────┘
│  Star history — last 90 days (bar chart)              │
│  ▁▃▅▂▇▄▃▆▂▅▇▃  (stars earned per week)              │
└──────────────────────────────────────────────────────┘
│  Category breakdown                                   │
│  History   ⭐⭐⭐⭐ avg  (8 tests)                     │
│  Biology   ⭐⭐⭐  avg   (4 tests)                     │
│  Safety    ⭐⭐⭐⭐⭐ avg (3 tests) ✅ Expert            │
└──────────────────────────────────────────────────────┘
```

### Player Levels (from Total Stars — recognition, not comparison)

| Stars      | Level | Title    |
|------------|-------|----------|
| 0 – 9      | 1     | Beginner |
| 10 – 29    | 2     | Explorer |
| 30 – 59    | 3     | Achiever |
| 60 – 99    | 4     | Skilled  |
| 100 – 199  | 5     | Advanced |
| 200 – 349  | 6     | Expert   |
| 350 – 499  | 7     | Champion |
| 500 – 749  | 8     | Elite    |
| 750 – 999  | 9     | Legend   |
| 1000+      | 10    | Master   |

> Player Level is a **recognition and loyalty honor**, not a performance comparison.
> Use Star Rate for performance comparison between employees.

### Files to create
- `frontend/app/(app)/assessments/my-profile/page.tsx`
- `frontend/lib/player-level.ts` — `getPlayerLevel(totalStars)`

### Files to change
- `frontend/components/layout/app-shell.tsx` — add "My Profile ⭐" nav link

---

## Phase 4 — Achievements & Badges
> Requires Phase 2. ~2–3 days effort. Requires 1 DB migration.

### DB migration: `0048_achievements`
```sql
CREATE TABLE assessment_achievements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  icon        TEXT NOT NULL,
  category    TEXT NOT NULL  -- 'stars'|'tests'|'streak'|'skill'|'special'
);

CREATE TABLE user_achievements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  user_id         UUID NOT NULL,
  achievement_id  UUID NOT NULL REFERENCES assessment_achievements(id),
  unlocked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, achievement_id)
);
```

### Achievement catalog (seeded at startup)

**⭐ Star Milestones** (personal journey)
| Code        | Icon | Name           | Requirement             |
|-------------|------|----------------|-------------------------|
| `stars_1`   | ⭐   | First Star     | Earn your first star    |
| `stars_10`  | 🌟   | Star Collector | Collect 10 stars        |
| `stars_50`  | 💫   | Star Hoarder   | Collect 50 stars        |
| `stars_100` | 🌠   | Centurion      | Collect 100 stars       |
| `stars_250` | 🎆   | Rising Star    | Collect 250 stars       |
| `stars_500` | 🌌   | Galaxy Brain   | Collect 500 stars       |
| `stars_1000`| 🏆   | Legend         | Collect 1000 stars      |

**📋 Test Completion** (effort & consistency)
| Code        | Icon | Name       | Requirement           |
|-------------|------|------------|-----------------------|
| `tests_1`   | 📝   | First Step | Complete first test   |
| `tests_10`  | 📚   | Bookworm   | Complete 10 tests     |
| `tests_25`  | 🎓   | Graduate   | Complete 25 tests     |
| `tests_50`  | 🔬   | Researcher | Complete 50 tests     |
| `tests_100` | 🧠   | Scholar    | Complete 100 tests    |

**💯 Performance** (quality, not quantity — fair for everyone)
| Code            | Icon | Name            | Requirement                      |
|-----------------|------|-----------------|----------------------------------|
| `perfect_score` | 💯   | Perfect!        | Score 5 stars on any test        |
| `perfect_3`     | 🎯   | Sharpshooter    | 5 stars 3 tests in a row         |
| `five_star_10`  | ✨   | Excellence Club | 5 stars on 10 different tests    |
| `hard_taker`    | 💪   | Challenge Seeker| Complete 5 tests with hard questions |
| `rate_4`        | ★    | High Achiever   | Maintain ★ 4.0+ Star Rate over 10 tests |
| `rate_5`        | ★★   | Elite Performer | Maintain ★ 4.5+ Star Rate over 10 tests |

**🔥 Streaks** (consistency)
| Code             | Icon | Name        | Requirement                           |
|------------------|------|-------------|---------------------------------------|
| `week_streak_2`  | 🔥   | On a Roll   | 1+ test/week for 2 consecutive weeks  |
| `week_streak_4`  | 🔥🔥 | Hot Streak  | 4-week streak                         |
| `week_streak_8`  | ⚡   | Unstoppable | 8-week streak                         |

**🗺️ Knowledge Breadth** (coverage — fair for all)
| Code              | Icon | Name           | Requirement                                    |
|-------------------|------|----------------|------------------------------------------------|
| `categories_3`    | 🗺️  | Well-Rounded   | Earn 4+ stars in 3 different categories        |
| `categories_5`    | 🌍  | Generalist     | Earn 4+ stars in 5 different categories        |
| `cat_expert`      | 🎖️  | Category Expert| Earn 4+ stars on 5+ tests in same category     |

**📈 Improvement** (rewarding growth, not starting point)
| Code          | Icon | Name          | Requirement                               |
|---------------|------|---------------|-------------------------------------------|
| `improver`    | 📈   | Most Improved | Improve by 2+ stars on a re-take          |
| `comeback`    | 🦅   | Comeback      | Score 5 stars after a 1-star attempt      |
| `consistent`  | 🎵   | Consistent    | Never score below 3 stars across 10 tests |

**🐦 Special** (fun extras)
| Code          | Icon | Name       | Requirement                   |
|---------------|------|------------|-------------------------------|
| `early_bird`  | 🐦   | Early Bird | Complete a test before 8am    |
| `night_owl`   | 🦉   | Night Owl  | Complete a test after 10pm    |
| `weekend`     | 🏄   | Overachiever| Complete a test on weekend   |

### Backend changes
- Seed `assessment_achievements` on startup or migration
- After each attempt is scored: evaluate all achievement conditions, insert new `user_achievements`
- `GET /users/me/achievements` — returns `{ unlocked: [...], locked: [...] }`
- `GET /assessments/achievements` — full catalog

### Frontend changes
- `my-profile/page.tsx` — achievement grid: unlocked (color + glow), locked (grey, description visible)
- `take/page.tsx` — toast popup for newly unlocked achievement after scoring

---

## Phase 5 — Manager Performance Dashboard (Stars Edition)
> Requires Phase 2. ~2 days effort. Requires 1 DB migration.

### What managers see (two lenses, clearly separated)

```
┌──────────────────────────────────────────────────────────────────┐
│  Team Performance Dashboard     Period: Q1 2026 ▼   Export CSV  │
├──────────────────────────┬──────────┬────────┬──────────┬───────┤
│ Employee                 │ ★ Rate   │ Tests  │ Coverage │ Stars │
├──────────────────────────┼──────────┼────────┼──────────┼───────┤
│ Maria Smith   (3 mo.)    │ ★ 4.8   │  12    │ 3 cats   │  53   │
│ Alex Johnson  (5 yr.)    │ ★ 3.9   │  84    │ 7 cats   │ 312   │
│ Tom Lee       (10 yr.)   │ ★ 4.1   │ 210    │ 9 cats   │ 847   │
└──────────────────────────┴──────────┴────────┴──────────┴───────┘
  ↑ Star Rate column makes Maria directly comparable to Tom.
  ↑ Total Stars column shows Tom's journey and loyalty.
  Both are visible. Neither hides the other.
```

> **Fair comparison design**: the default sort is by **Star Rate**, not Total Stars.
> This means a talented new hire naturally surfaces near the top immediately.
> Total Stars is shown but clearly labeled as a "journey" metric, not performance.

### DB migration: `0049_review_periods`
- Table `assessment_review_periods`: `id`, `tenant_id`, `name`, `start_date`, `end_date`

### Files to create
- `frontend/app/(app)/assessments/performance/page.tsx`

### Backend
- `GET /assessments/review-periods` + `POST /assessments/review-periods`
- `GET /assessments/review-periods/{id}/scores`
  — per-employee: `star_rate`, `tests_completed`, `total_stars`, `category_coverage`, `tenure_months`

---

## Phase 6 — Onboarding Track
> Requires Phase 2. ~1–2 days effort. Requires 1 DB migration.

### DB migration: `0050_onboarding_track`
```sql
ALTER TABLE tenant_memberships ADD COLUMN onboarding_ends_at TIMESTAMPTZ NULL;
-- Set automatically = joined_at + 90 days when a new member is created
```

### What it does
- New employees are measured **within their cohort** during their first 90 days
- Manager can filter the performance dashboard to "In onboarding" tab
- A new hire's Star Rate is compared to **other new hires**, not 10-year veterans
- After 90 days, they graduate to the main leaderboard — with a 🎓 "Graduate" badge
- Psychologically critical: removes the "I can never catch up" feeling

---

## Build order & effort

| Phase | Description                          | Effort     | DB migration |
|-------|--------------------------------------|------------|--------------|
| 1     | Weighted star ratings on every attempt | ~1–2 days | No           |
| 2     | Cumulative stars in DB + Star Rate   | ~1 day     | Yes (0047)   |
| 3     | Personal Star Profile page           | ~2 days    | No           |
| 4     | Achievements & Badges                | ~2–3 days  | Yes (0048)   |
| 5     | Manager Performance Dashboard        | ~2 days    | Yes (0049)   |
| 6     | Onboarding Track                     | ~1–2 days  | Yes (0050)   |

> **Recommended start**: Phase 1 + 2 together (~3 days, immediate visual impact).
> Then Phase 3 + 4 — these make it feel like a real game.

---

## Why this is fair for everyone

| Who                        | What they see                                             |
|----------------------------|-----------------------------------------------------------|
| **New talented hire**      | High Star Rate immediately visible. Earns achievement badges from day 1. Compared to peers in onboarding cohort. |
| **Long-tenured employee**  | High Total Stars + Player Level as recognition of loyalty. Star Rate shows consistent performance. |
| **Manager**                | Star Rate for cross-employee comparison. Total Stars for recognition. Tenure shown as context, not evaluation. |
| **Student / school use**   | Same system — stars per test, achievements, profile. No "fail" word ever appears. |

The two metrics intentionally serve different purposes and are presented together
so neither story is hidden — loyalty is honored, performance is measured fairly.

---

## How to use this file

Tell the AI: **"Build Phase 1"**, **"Build Phase 2"**, etc.
Each phase is self-contained and can be built in order.
Phases with DB migrations need `python -m alembic upgrade head` on the server.
