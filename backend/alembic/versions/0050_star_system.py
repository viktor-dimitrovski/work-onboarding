"""Add star system: total_stars + tests_completed to tenant_memberships;
stars_earned to assessment_attempts. Backfill from existing scored data.

Revision ID: 0050_star_system
Revises: 0049_platform_releases
Create Date: 2026-03-08
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0050_star_system"
down_revision: str | Sequence[str] | None = "0049_platform_releases"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── tenant_memberships: star counters ─────────────────────────────────────
    op.add_column(
        "tenant_memberships",
        sa.Column("total_stars", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "tenant_memberships",
        sa.Column("tests_completed", sa.Integer(), nullable=False, server_default="0"),
    )

    # ── assessment_attempts: per-attempt star award ───────────────────────────
    op.add_column(
        "assessment_attempts",
        sa.Column("stars_earned", sa.SmallInteger(), nullable=True),
    )

    # ── Backfill stars_earned for all existing scored attempts ────────────────
    op.execute(
        """
        UPDATE assessment_attempts
        SET stars_earned = CASE
            WHEN score_percent IS NULL  THEN NULL
            WHEN score_percent >= 90    THEN 5
            WHEN score_percent >= 75    THEN 4
            WHEN score_percent >= 60    THEN 3
            WHEN score_percent >= 40    THEN 2
            ELSE                             1
        END
        WHERE status IN ('scored', 'submitted')
        """
    )

    # ── Backfill total_stars + tests_completed from existing attempts ─────────
    op.execute(
        """
        UPDATE tenant_memberships tm
        SET
            tests_completed = COALESCE(sub.cnt,  0),
            total_stars     = COALESCE(sub.stars, 0)
        FROM (
            SELECT
                a.user_id,
                d.tenant_id,
                COUNT(*)                  AS cnt,
                SUM(COALESCE(a.stars_earned, 0)) AS stars
            FROM  assessment_attempts    a
            JOIN  assessment_deliveries  d ON d.id = a.delivery_id
            WHERE a.status IN ('scored', 'submitted')
              AND a.stars_earned IS NOT NULL
            GROUP BY a.user_id, d.tenant_id
        ) sub
        WHERE tm.user_id   = sub.user_id
          AND tm.tenant_id = sub.tenant_id
        """
    )


def downgrade() -> None:
    op.drop_column("assessment_attempts", "stars_earned")
    op.drop_column("tenant_memberships", "tests_completed")
    op.drop_column("tenant_memberships", "total_stars")
