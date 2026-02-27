"""add oauth fields to users

Revision ID: 0006_oauth_users
Revises: 0005_assessment_classification_jobs
Create Date: 2026-02-27 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = '0006_oauth_users'
down_revision: str | None = '0005_assessment_classification_jobs'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('users', sa.Column('oauth_provider', sa.String(length=50), nullable=True))
    op.add_column('users', sa.Column('oauth_provider_id', sa.String(length=255), nullable=True))
    op.alter_column('users', 'hashed_password', nullable=True)
    op.create_index('ix_users_oauth_provider', 'users', ['oauth_provider'])
    op.create_index('ix_users_oauth_provider_id', 'users', ['oauth_provider_id'])
    op.create_unique_constraint('uq_users_oauth_provider', 'users', ['oauth_provider', 'oauth_provider_id'])


def downgrade() -> None:
    op.drop_constraint('uq_users_oauth_provider', 'users', type_='unique')
    op.drop_index('ix_users_oauth_provider_id', table_name='users')
    op.drop_index('ix_users_oauth_provider', table_name='users')
    op.alter_column('users', 'hashed_password', nullable=False)
    op.drop_column('users', 'oauth_provider_id')
    op.drop_column('users', 'oauth_provider')
