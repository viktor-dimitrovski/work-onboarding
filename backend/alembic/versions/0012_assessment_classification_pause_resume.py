"""assessment classification pause/resume

Revision ID: 0012_assessment_classification_pause_resume
Revises: 0011_assessment_classification_v2
Create Date: 2026-02-28 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0012_assessment_classification_pause_resume"
down_revision: str | None = "0011_assessment_classification_v2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "assessment_classification_jobs",
        sa.Column("pause_requested", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    op.drop_constraint(
        "assessment_classification_job_status_values",
        "assessment_classification_jobs",
        type_="check",
    )
    op.create_check_constraint(
        "assessment_classification_job_status_values",
        "assessment_classification_jobs",
        "status in ('queued', 'running', 'paused', 'completed', 'failed', 'canceled')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "assessment_classification_job_status_values",
        "assessment_classification_jobs",
        type_="check",
    )
    op.create_check_constraint(
        "assessment_classification_job_status_values",
        "assessment_classification_jobs",
        "status in ('queued', 'running', 'completed', 'failed', 'canceled')",
    )
    op.drop_column("assessment_classification_jobs", "pause_requested")

