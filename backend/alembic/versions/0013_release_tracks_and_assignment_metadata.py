"""release track_type + assignment metadata

Revision ID: 0013_release_tracks_and_assignment_metadata
Revises: 0012_billing_schema_module, 0012_assessment_classification_pause_resume
Create Date: 2026-02-28
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0013_release_tracks_and_assignment_metadata'
down_revision: str | Sequence[str] | None = (
    '0012_billing_schema_module',
    '0012_assessment_classification_pause_resume',
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'track_templates',
        sa.Column('track_type', sa.String(length=30), nullable=False, server_default='GENERAL'),
    )
    op.add_column(
        'track_versions',
        sa.Column('track_type', sa.String(length=30), nullable=False, server_default='GENERAL'),
    )
    op.create_index('ix_track_templates_track_type', 'track_templates', ['track_type'])
    op.create_index('ix_track_versions_track_type', 'track_versions', ['track_type'])

    op.add_column(
        'onboarding_assignments',
        sa.Column(
            'metadata',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column('onboarding_assignments', 'metadata')
    op.drop_index('ix_track_versions_track_type', table_name='track_versions')
    op.drop_index('ix_track_templates_track_type', table_name='track_templates')
    op.drop_column('track_versions', 'track_type')
    op.drop_column('track_templates', 'track_type')
