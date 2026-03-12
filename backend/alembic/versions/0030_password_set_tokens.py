"""password_set_tokens table for invitation and password-reset links

Revision ID: 0030_password_set_tokens
Revises: 0029_integration_registry_crypto_settings
Create Date: 2026-03-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = '0030_password_set_tokens'
down_revision: str | None = '0029_integration_registry_crypto_settings'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'password_set_tokens',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('token_hash', sa.String(128), nullable=False, unique=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('purpose', sa.String(30), nullable=False, server_default='invitation'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_password_set_tokens_token_hash', 'password_set_tokens', ['token_hash'], unique=True)
    op.create_index('ix_password_set_tokens_user_id', 'password_set_tokens', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_password_set_tokens_user_id', table_name='password_set_tokens')
    op.drop_index('ix_password_set_tokens_token_hash', table_name='password_set_tokens')
    op.drop_table('password_set_tokens')
