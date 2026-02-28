"""tenant settings json

Revision ID: 0014_tenant_settings
Revises: 0013_release_tracks_and_assignment_metadata
Create Date: 2026-02-28
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0014_tenant_settings'
down_revision: str | Sequence[str] | None = '0013_release_tracks_and_assignment_metadata'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'tenants',
        sa.Column(
            'settings',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column('tenants', 'settings')
