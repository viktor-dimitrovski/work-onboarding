"""Add release calendar columns and 'planned' status to platform_releases.

Revision ID: 0053_platform_release_calendar
Revises: 0052_deployment_runs
Create Date: 2026-03-27
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0053_platform_release_calendar"
down_revision: str | Sequence[str] | None = "0052_deployment_runs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "platform_releases",
        sa.Column("planned_start", sa.Date(), nullable=True),
        schema="release_mgmt",
    )
    op.add_column(
        "platform_releases",
        sa.Column("planned_end", sa.Date(), nullable=True),
        schema="release_mgmt",
    )
    op.add_column(
        "platform_releases",
        sa.Column("planning_notes", sa.Text(), nullable=True),
        schema="release_mgmt",
    )

    # Drop old check constraint and recreate with 'planned' included
    op.drop_constraint(
        "ck_release_mgmt_platform_releases_status",
        "platform_releases",
        schema="release_mgmt",
        type_="check",
    )
    op.create_check_constraint(
        "ck_release_mgmt_platform_releases_status",
        "platform_releases",
        "status in ('planned','draft','preparation','cab_approved','deploying','deployed','closed')",
        schema="release_mgmt",
    )

    op.create_index(
        "ix_release_mgmt_platform_releases_planned_start",
        "platform_releases",
        ["planned_start"],
        schema="release_mgmt",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_release_mgmt_platform_releases_planned_start",
        table_name="platform_releases",
        schema="release_mgmt",
    )

    op.drop_constraint(
        "ck_release_mgmt_platform_releases_status",
        "platform_releases",
        schema="release_mgmt",
        type_="check",
    )
    op.create_check_constraint(
        "ck_release_mgmt_platform_releases_status",
        "platform_releases",
        "status in ('draft','preparation','cab_approved','deploying','deployed','closed')",
        schema="release_mgmt",
    )

    op.drop_column("platform_releases", "planning_notes", schema="release_mgmt")
    op.drop_column("platform_releases", "planned_end", schema="release_mgmt")
    op.drop_column("platform_releases", "planned_start", schema="release_mgmt")
