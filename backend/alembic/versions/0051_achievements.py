"""Add assessment_achievement_catalog and user_achievements tables, seeded with
the full achievement catalog.

Revision ID: 0051_achievements
Revises: 0050_star_system
Create Date: 2026-03-08
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0051_achievements"
down_revision: str | Sequence[str] | None = "0050_star_system"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# fmt: off
CATALOG = [
    # code,             name,               description,                                         icon,  category,  sort
    ("first_star",      "First Star",        "Earn your very first star",                        "⭐",  "stars",   10),
    ("stars_10",        "Star Collector",    "Collect 10 stars",                                 "🌟",  "stars",   20),
    ("stars_50",        "Star Hoarder",      "Collect 50 stars",                                 "💫",  "stars",   30),
    ("stars_100",       "Centurion",         "Collect 100 stars",                                "🌠",  "stars",   40),
    ("stars_250",       "Rising Star",       "Collect 250 stars",                                "🎆",  "stars",   50),
    ("stars_500",       "Galaxy Brain",      "Collect 500 stars",                                "🌌",  "stars",   60),
    ("stars_1000",      "Legend",            "Collect 1 000 stars",                              "🏆",  "stars",   70),
    ("tests_1",         "First Step",        "Complete your first test",                         "📝",  "tests",   110),
    ("tests_10",        "Bookworm",          "Complete 10 tests",                                "📚",  "tests",   120),
    ("tests_25",        "Graduate",          "Complete 25 tests",                                "🎓",  "tests",   130),
    ("tests_50",        "Researcher",        "Complete 50 tests",                                "🔬",  "tests",   140),
    ("tests_100",       "Scholar",           "Complete 100 tests",                               "🧠",  "tests",   150),
    ("perfect_score",   "Perfect!",          "Score 5 stars on any test",                        "💯",  "skill",   210),
    ("perfect_3",       "Sharpshooter",      "Score 5 stars on 3 tests in a row",                "🎯",  "skill",   220),
    ("five_star_10",    "Excellence Club",   "Earn 5 stars on 10 different attempts",            "✨",  "skill",   230),
    ("rate_4",          "High Achiever",     "Maintain a 4.0+ Star Rate over 10+ tests",        "★",   "skill",   240),
    ("rate_45",         "Elite Performer",   "Maintain a 4.5+ Star Rate over 10+ tests",        "★★",  "skill",   250),
    ("week_streak_2",   "On a Roll",         "Complete at least 1 test each week for 2 weeks",  "🔥",  "streak",  310),
    ("week_streak_4",   "Hot Streak",        "4-week completion streak",                         "🔥",  "streak",  320),
    ("week_streak_8",   "Unstoppable",       "8-week completion streak",                         "⚡",  "streak",  330),
    ("improver",        "Most Improved",     "Improve by 2 or more stars on a re-take",         "📈",  "special", 410),
    ("comeback",        "Comeback",          "Score 5 stars after a 1-star attempt",            "🦅",  "special", 420),
    ("consistent",      "Consistent",        "Never score below 3 stars across 10 tests",       "🎵",  "special", 430),
]
# fmt: on


def upgrade() -> None:
    # ── Achievement catalog (global, not tenant-scoped) ───────────────────────
    op.create_table(
        "assessment_achievement_catalog",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("code", sa.String(60), nullable=False, unique=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("icon", sa.String(10), nullable=False),
        sa.Column("category", sa.String(30), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )

    # ── Seed the catalog ──────────────────────────────────────────────────────
    op.execute(
        sa.text(
            """
            INSERT INTO assessment_achievement_catalog (code, name, description, icon, category, sort_order)
            VALUES
              ('first_star',    'First Star',       'Earn your very first star',                        '⭐', 'stars',   10),
              ('stars_10',      'Star Collector',   'Collect 10 stars',                                 '🌟', 'stars',   20),
              ('stars_50',      'Star Hoarder',     'Collect 50 stars',                                 '💫', 'stars',   30),
              ('stars_100',     'Centurion',        'Collect 100 stars',                                '🌠', 'stars',   40),
              ('stars_250',     'Rising Star',      'Collect 250 stars',                                '🎆', 'stars',   50),
              ('stars_500',     'Galaxy Brain',     'Collect 500 stars',                                '🌌', 'stars',   60),
              ('stars_1000',    'Legend',           'Collect 1 000 stars',                              '🏆', 'stars',   70),
              ('tests_1',       'First Step',       'Complete your first test',                         '📝', 'tests',  110),
              ('tests_10',      'Bookworm',         'Complete 10 tests',                                '📚', 'tests',  120),
              ('tests_25',      'Graduate',         'Complete 25 tests',                                '🎓', 'tests',  130),
              ('tests_50',      'Researcher',       'Complete 50 tests',                                '🔬', 'tests',  140),
              ('tests_100',     'Scholar',          'Complete 100 tests',                               '🧠', 'tests',  150),
              ('perfect_score', 'Perfect!',         'Score 5 stars on any test',                        '💯', 'skill',  210),
              ('perfect_3',     'Sharpshooter',     'Score 5 stars on 3 tests in a row',                '🎯', 'skill',  220),
              ('five_star_10',  'Excellence Club',  'Earn 5 stars on 10 different attempts',            '✨', 'skill',  230),
              ('rate_4',        'High Achiever',    'Maintain a 4.0+ Star Rate over 10+ tests',        '★',  'skill',  240),
              ('rate_45',       'Elite Performer',  'Maintain a 4.5+ Star Rate over 10+ tests',        '★★', 'skill',  250),
              ('week_streak_2', 'On a Roll',        'Complete at least 1 test each week for 2 weeks',  '🔥', 'streak', 310),
              ('week_streak_4', 'Hot Streak',       '4-week completion streak',                         '🔥', 'streak', 320),
              ('week_streak_8', 'Unstoppable',      '8-week completion streak',                         '⚡', 'streak', 330),
              ('improver',      'Most Improved',    'Improve by 2 or more stars on a re-take',         '📈', 'special',410),
              ('comeback',      'Comeback',         'Score 5 stars after a 1-star attempt',            '🦅', 'special',420),
              ('consistent',    'Consistent',       'Never score below 3 stars across 10 tests',       '🎵', 'special',430)
            ON CONFLICT (code) DO NOTHING
            """
        )
    )

    # ── Per-user achievement unlocks (tenant-scoped) ──────────────────────────
    op.create_table(
        "user_achievements",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("achievement_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "unlocked_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["achievement_id"],
            ["assessment_achievement_catalog.id"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("tenant_id", "user_id", "achievement_id", name="uq_user_achievement"),
    )
    op.create_index("ix_user_achievements_tenant_user", "user_achievements", ["tenant_id", "user_id"])
    op.create_index("ix_user_achievements_user", "user_achievements", ["user_id"])

    # Enable RLS on user_achievements
    op.execute("ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation_user_achievements
        ON user_achievements
        USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation_user_achievements ON user_achievements")
    op.execute("ALTER TABLE user_achievements DISABLE ROW LEVEL SECURITY")
    op.drop_index("ix_user_achievements_user", table_name="user_achievements")
    op.drop_index("ix_user_achievements_tenant_user", table_name="user_achievements")
    op.drop_table("user_achievements")
    op.drop_table("assessment_achievement_catalog")
