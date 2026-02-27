"""add assessment classification jobs

Revision ID: 0005_assessment_classification_jobs
Revises: 0004_assessment_categories
Create Date: 2026-02-27 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0005_assessment_classification_jobs'
down_revision: str | None = '0004b_widen_alembic_version'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'assessment_classification_jobs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='queued'),
        sa.Column('total', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('processed', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('error_summary', sa.Text(), nullable=True),
        sa.Column(
            'report_json',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('updated_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint(
            "status in ('queued', 'running', 'completed', 'failed')",
            name='assessment_classification_job_status_values',
        ),
    )
    op.create_index(
        'ix_assessment_classification_jobs_status',
        'assessment_classification_jobs',
        ['status'],
    )


def downgrade() -> None:
    op.drop_index('ix_assessment_classification_jobs_status', table_name='assessment_classification_jobs')
    op.drop_table('assessment_classification_jobs')
