"""Star system service.

Responsibilities:
- Compute stars_earned from score_percent (weighted scoring is already baked
  into score_percent by the submission logic, so stars map directly to it).
- After an attempt is scored, award stars to the user's membership counter
  and evaluate which achievements were just unlocked.
- Return newly unlocked AchievementCatalog rows so the API can include them
  in the submit response (for frontend toast notifications).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.assessment import AchievementCatalog, AssessmentAttempt, UserAchievement
from app.models.rbac import User
from app.models.tenant import TenantMembership

if TYPE_CHECKING:
    pass

UTC = timezone.utc


# ─────────────────────────────────────────────────────────────────────────────
# Star thresholds
# ─────────────────────────────────────────────────────────────────────────────

def compute_stars(score_percent: float) -> int:
    """Return 1–5 stars from a weighted score percentage.

    Completing any test always earns at least 1 star — no zero scores.
    """
    if score_percent >= 90:
        return 5
    if score_percent >= 75:
        return 4
    if score_percent >= 60:
        return 3
    if score_percent >= 40:
        return 2
    return 1


STAR_LABEL: dict[int, str] = {
    1: "Just Starting",
    2: "Learning",
    3: "Skilled",
    4: "Advanced",
    5: "Mastery!",
}

STAR_MESSAGE: dict[int, str] = {
    1: "You showed up — that counts!",
    2: "Getting there, keep going!",
    3: "Solid work!",
    4: "Really impressive!",
    5: "🎉 Perfect performance!",
}


# ─────────────────────────────────────────────────────────────────────────────
# Player levels
# ─────────────────────────────────────────────────────────────────────────────

PLAYER_LEVELS = [
    (0,    1, "Beginner"),
    (10,   2, "Explorer"),
    (30,   3, "Achiever"),
    (60,   4, "Skilled"),
    (100,  5, "Advanced"),
    (200,  6, "Expert"),
    (350,  7, "Champion"),
    (500,  8, "Elite"),
    (750,  9, "Legend"),
    (1000, 10, "Master"),
]


def get_player_level(total_stars: int) -> dict:
    level_num = 1
    title = "Beginner"
    next_threshold = 10
    for threshold, num, name in PLAYER_LEVELS:
        if total_stars >= threshold:
            level_num = num
            title = name
    # Compute next threshold
    for threshold, num, name in PLAYER_LEVELS:
        if threshold > total_stars:
            next_threshold = threshold
            break
    else:
        next_threshold = None  # Master — no next level
    return {
        "level": level_num,
        "title": title,
        "next_level_stars": next_threshold,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Award stars to membership
# ─────────────────────────────────────────────────────────────────────────────

def award_stars(
    db: Session,
    *,
    user_id: uuid.UUID,
    tenant_id: uuid.UUID,
    stars: int,
) -> TenantMembership:
    """Atomically increment total_stars and tests_completed on the membership row."""
    membership = db.scalar(
        select(TenantMembership).where(
            TenantMembership.user_id == user_id,
            TenantMembership.tenant_id == tenant_id,
        )
    )
    if membership:
        membership.total_stars += stars
        membership.tests_completed += 1
    return membership


# ─────────────────────────────────────────────────────────────────────────────
# Achievement checks
# ─────────────────────────────────────────────────────────────────────────────

def check_and_unlock_achievements(
    db: Session,
    *,
    user_id: uuid.UUID,
    tenant_id: uuid.UUID,
    attempt: AssessmentAttempt,
    total_stars: int,
    tests_completed: int,
) -> list[AchievementCatalog]:
    """Evaluate all achievement conditions for this user and unlock new ones.

    Returns the list of AchievementCatalog rows that were *just* unlocked by
    this attempt (so the frontend can display toast notifications).
    """
    stars = attempt.stars_earned or 0

    # ── Already-unlocked codes (fast set lookup) ──────────────────────────────
    already_unlocked: set[str] = set(
        db.scalars(
            select(AchievementCatalog.code)
            .join(UserAchievement, UserAchievement.achievement_id == AchievementCatalog.id)
            .where(
                UserAchievement.user_id == user_id,
                UserAchievement.tenant_id == tenant_id,
            )
        ).all()
    )

    # ── Full catalog (keyed by code) ──────────────────────────────────────────
    catalog: dict[str, AchievementCatalog] = {
        a.code: a
        for a in db.scalars(select(AchievementCatalog)).all()
    }

    to_unlock: list[str] = []

    def _maybe(code: str) -> None:
        if code in catalog and code not in already_unlocked:
            to_unlock.append(code)

    # ── Star milestones ───────────────────────────────────────────────────────
    if total_stars >= 1:
        _maybe("first_star")
    for threshold, code in [(10, "stars_10"), (50, "stars_50"), (100, "stars_100"),
                             (250, "stars_250"), (500, "stars_500"), (1000, "stars_1000")]:
        if total_stars >= threshold:
            _maybe(code)

    # ── Test completion milestones ────────────────────────────────────────────
    for threshold, code in [(1, "tests_1"), (10, "tests_10"), (25, "tests_25"),
                             (50, "tests_50"), (100, "tests_100")]:
        if tests_completed >= threshold:
            _maybe(code)

    # ── Performance achievements ──────────────────────────────────────────────
    if stars == 5:
        _maybe("perfect_score")

    # Perfect 3 in a row — check last 3 scored attempts
    if stars == 5 and "perfect_3" not in already_unlocked and "perfect_3" in catalog:
        last3 = db.scalars(
            select(AssessmentAttempt.stars_earned)
            .where(
                AssessmentAttempt.user_id == user_id,
                AssessmentAttempt.status == "scored",
                AssessmentAttempt.stars_earned.isnot(None),
            )
            .order_by(AssessmentAttempt.submitted_at.desc())
            .limit(3)
        ).all()
        if len(last3) == 3 and all(s == 5 for s in last3):
            _maybe("perfect_3")

    # Five-star on 10 different attempts
    if stars == 5 and "five_star_10" not in already_unlocked and "five_star_10" in catalog:
        five_star_count = db.scalar(
            select(func.count())
            .where(
                AssessmentAttempt.user_id == user_id,
                AssessmentAttempt.stars_earned == 5,
                AssessmentAttempt.status == "scored",
            )
        ) or 0
        if five_star_count >= 10:
            _maybe("five_star_10")

    # High Star Rate over 10+ tests
    if tests_completed >= 10:
        star_rate = total_stars / tests_completed
        if star_rate >= 4.0:
            _maybe("rate_4")
        if star_rate >= 4.5:
            _maybe("rate_45")

    # Consistent — never below 3 stars across 10+ tests
    if tests_completed >= 10 and "consistent" not in already_unlocked and "consistent" in catalog:
        low_count = db.scalar(
            select(func.count())
            .where(
                AssessmentAttempt.user_id == user_id,
                AssessmentAttempt.stars_earned < 3,
                AssessmentAttempt.status == "scored",
            )
        ) or 0
        if low_count == 0:
            _maybe("consistent")

    # ── Streak achievements ───────────────────────────────────────────────────
    _check_streaks(db, user_id=user_id, already_unlocked=already_unlocked, catalog=catalog,
                   to_unlock=to_unlock)

    # ── Improvement achievements ──────────────────────────────────────────────
    _check_improvement(db, user_id=user_id, attempt=attempt,
                       already_unlocked=already_unlocked, catalog=catalog, to_unlock=to_unlock)

    # ── Unlock new achievements ───────────────────────────────────────────────
    newly_unlocked: list[AchievementCatalog] = []
    now = datetime.now(UTC)
    for code in to_unlock:
        achievement = catalog[code]
        ua = UserAchievement(
            tenant_id=tenant_id,
            user_id=user_id,
            achievement_id=achievement.id,
            unlocked_at=now,
        )
        db.add(ua)
        newly_unlocked.append(achievement)

    return newly_unlocked


def _check_streaks(
    db: Session,
    user_id: uuid.UUID,
    already_unlocked: set[str],
    catalog: dict[str, AchievementCatalog],
    to_unlock: list[str],
) -> None:
    """Check consecutive week streaks — needs at most one query."""
    needed_weeks = 0
    if "week_streak_8" not in already_unlocked and "week_streak_8" in catalog:
        needed_weeks = 8
    elif "week_streak_4" not in already_unlocked and "week_streak_4" in catalog:
        needed_weeks = 4
    elif "week_streak_2" not in already_unlocked and "week_streak_2" in catalog:
        needed_weeks = 2

    if needed_weeks == 0:
        return

    # Fetch submitted_at for last needed_weeks+1 weeks of scored attempts
    since = datetime.now(UTC) - timedelta(weeks=needed_weeks + 1)
    dates = db.scalars(
        select(AssessmentAttempt.submitted_at)
        .where(
            AssessmentAttempt.user_id == user_id,
            AssessmentAttempt.status == "scored",
            AssessmentAttempt.submitted_at >= since,
        )
        .order_by(AssessmentAttempt.submitted_at.desc())
    ).all()

    if not dates:
        return

    # Build set of ISO year-week strings that have at least one attempt
    weeks_with_attempt: set[str] = set()
    for dt in dates:
        if dt:
            iso = dt.isocalendar()
            weeks_with_attempt.add(f"{iso.year}-{iso.week:02d}")

    # Check if there are N consecutive weeks ending at the current week
    now = datetime.now(UTC)
    consecutive = 0
    check_date = now
    for _ in range(needed_weeks):
        iso = check_date.isocalendar()
        key = f"{iso.year}-{iso.week:02d}"
        if key in weeks_with_attempt:
            consecutive += 1
            check_date -= timedelta(weeks=1)
        else:
            break

    if consecutive >= 2 and "week_streak_2" not in already_unlocked:
        to_unlock.append("week_streak_2") if "week_streak_2" in catalog else None
    if consecutive >= 4 and "week_streak_4" not in already_unlocked:
        to_unlock.append("week_streak_4") if "week_streak_4" in catalog else None
    if consecutive >= 8 and "week_streak_8" not in already_unlocked:
        to_unlock.append("week_streak_8") if "week_streak_8" in catalog else None


def _check_improvement(
    db: Session,
    user_id: uuid.UUID,
    attempt: AssessmentAttempt,
    already_unlocked: set[str],
    catalog: dict[str, AchievementCatalog],
    to_unlock: list[str],
) -> None:
    """Check improver + comeback achievements against previous attempt on same delivery."""
    if attempt.stars_earned is None:
        return

    # Get previous scored attempt on the same delivery by the same user
    previous = db.scalar(
        select(AssessmentAttempt)
        .where(
            AssessmentAttempt.delivery_id == attempt.delivery_id,
            AssessmentAttempt.user_id == user_id,
            AssessmentAttempt.id != attempt.id,
            AssessmentAttempt.status == "scored",
            AssessmentAttempt.stars_earned.isnot(None),
        )
        .order_by(AssessmentAttempt.submitted_at.desc())
        .limit(1)
    )
    if not previous or previous.stars_earned is None:
        return

    if "improver" not in already_unlocked and "improver" in catalog:
        if attempt.stars_earned - previous.stars_earned >= 2:
            to_unlock.append("improver")

    if "comeback" not in already_unlocked and "comeback" in catalog:
        if previous.stars_earned == 1 and attempt.stars_earned == 5:
            to_unlock.append("comeback")


# ─────────────────────────────────────────────────────────────────────────────
# Profile data helpers
# ─────────────────────────────────────────────────────────────────────────────

def get_user_star_profile(
    db: Session,
    *,
    user_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> dict:
    """Return the full star profile for a user: stars, level, achievements."""
    membership = db.scalar(
        select(TenantMembership).where(
            TenantMembership.user_id == user_id,
            TenantMembership.tenant_id == tenant_id,
        )
    )
    total_stars = membership.total_stars if membership else 0
    tests_completed = membership.tests_completed if membership else 0
    star_rate = round(total_stars / tests_completed, 2) if tests_completed > 0 else 0.0
    level_info = get_player_level(total_stars)

    # All achievements with unlocked status
    unlocked_map: dict[uuid.UUID, datetime] = {}
    for ua in db.scalars(
        select(UserAchievement)
        .where(UserAchievement.user_id == user_id, UserAchievement.tenant_id == tenant_id)
        .options()
    ).all():
        unlocked_map[ua.achievement_id] = ua.unlocked_at

    all_achievements = db.scalars(
        select(AchievementCatalog).order_by(AchievementCatalog.sort_order)
    ).all()

    achievements_out = []
    for a in all_achievements:
        unlocked_at = unlocked_map.get(a.id)
        achievements_out.append({
            "code": a.code,
            "name": a.name,
            "description": a.description,
            "icon": a.icon,
            "category": a.category,
            "sort_order": a.sort_order,
            "unlocked": unlocked_at is not None,
            "unlocked_at": unlocked_at.isoformat() if unlocked_at else None,
        })

    # Recent test history with stars (last 20)
    recent_attempts = db.scalars(
        select(AssessmentAttempt)
        .where(
            AssessmentAttempt.user_id == user_id,
            AssessmentAttempt.status == "scored",
            AssessmentAttempt.stars_earned.isnot(None),
        )
        .order_by(AssessmentAttempt.submitted_at.desc())
        .limit(20)
    ).all()

    return {
        "total_stars": total_stars,
        "tests_completed": tests_completed,
        "star_rate": star_rate,
        "player_level": level_info["level"],
        "player_title": level_info["title"],
        "next_level_stars": level_info["next_level_stars"],
        "achievements": achievements_out,
        "unlocked_count": len(unlocked_map),
        "total_achievement_count": len(all_achievements),
        "recent_attempt_stars": [
            {
                "attempt_id": str(a.id),
                "stars_earned": a.stars_earned,
                "submitted_at": a.submitted_at.isoformat() if a.submitted_at else None,
            }
            for a in recent_attempts
        ],
    }


def get_team_performance(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    period_start: datetime | None = None,
    period_end: datetime | None = None,
) -> list[dict]:
    """Return per-member star performance stats for the tenant (manager view)."""
    memberships = db.scalars(
        select(TenantMembership).where(
            TenantMembership.tenant_id == tenant_id,
            TenantMembership.status == "active",
        )
    ).all()

    user_ids = [m.user_id for m in memberships]
    membership_map = {m.user_id: m for m in memberships}

    users = db.scalars(select(User).where(User.id.in_(user_ids))).all()
    user_map = {u.id: u for u in users}

    # Period-specific attempt counts if filters are provided
    if period_start or period_end:
        attempt_filter = [
            AssessmentAttempt.user_id.in_(user_ids),
            AssessmentAttempt.status == "scored",
            AssessmentAttempt.stars_earned.isnot(None),
        ]
        if period_start:
            attempt_filter.append(AssessmentAttempt.submitted_at >= period_start)
        if period_end:
            attempt_filter.append(AssessmentAttempt.submitted_at <= period_end)

        from sqlalchemy import and_
        from app.models.assessment import AssessmentDelivery

        rows = db.execute(
            select(
                AssessmentAttempt.user_id,
                func.count().label("period_tests"),
                func.sum(AssessmentAttempt.stars_earned).label("period_stars"),
            )
            .where(*attempt_filter)
            .group_by(AssessmentAttempt.user_id)
        ).all()
        period_map = {r.user_id: {"period_tests": r.period_tests, "period_stars": r.period_stars} for r in rows}
    else:
        period_map = {}

    result = []
    for m in memberships:
        u = user_map.get(m.user_id)
        if not u:
            continue
        period_data = period_map.get(m.user_id, {"period_tests": 0, "period_stars": 0})
        tests = period_data["period_tests"] if period_start or period_end else m.tests_completed
        stars = period_data["period_stars"] if period_start or period_end else m.total_stars
        rate = round(stars / tests, 2) if tests > 0 else 0.0

        # Tenure in months
        now = datetime.now(UTC)
        joined = m.created_at.replace(tzinfo=UTC) if m.created_at and m.created_at.tzinfo is None else (m.created_at or now)
        tenure_months = max(0, int((now - joined).days / 30.44))

        result.append({
            "user_id": str(m.user_id),
            "full_name": u.full_name or u.email,
            "email": u.email,
            "total_stars": m.total_stars,
            "tests_completed": m.tests_completed,
            "star_rate": round(m.total_stars / m.tests_completed, 2) if m.tests_completed > 0 else 0.0,
            "period_stars": period_data["period_stars"] or 0,
            "period_tests": period_data["period_tests"] or 0,
            "period_star_rate": rate,
            "tenure_months": tenure_months,
        })

    # Default sort: period_star_rate desc, then total_stars desc
    result.sort(key=lambda x: (-x["period_star_rate"], -x["total_stars"]))
    return result
