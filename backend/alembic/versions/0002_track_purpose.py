"""add track purpose and source ids

Revision ID: 0002_track_purpose
Revises: 0001_initial
Create Date: 2026-02-25 00:10:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0002_track_purpose'
down_revision: str | None = '0001_initial'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'track_templates',
        sa.Column('purpose', sa.String(length=30), server_default='onboarding', nullable=False),
    )
    op.add_column(
        'track_versions',
        sa.Column('purpose', sa.String(length=30), server_default='onboarding', nullable=False),
    )
    op.add_column(
        'track_phases',
        sa.Column('source_phase_id', postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        'track_tasks',
        sa.Column('source_task_id', postgresql.UUID(as_uuid=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('track_tasks', 'source_task_id')
    op.drop_column('track_phases', 'source_phase_id')
    op.drop_column('track_versions', 'purpose')
    op.drop_column('track_templates', 'purpose')
