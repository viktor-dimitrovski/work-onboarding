"""user preferences json

Revision ID: 0015_user_preferences_jsonb
Revises: 0014_tenant_settings
Create Date: 2026-02-28
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0015_user_preferences_jsonb'
down_revision: str | Sequence[str] | None = '0014_tenant_settings'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column(
            'preferences',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column('users', 'preferences')
