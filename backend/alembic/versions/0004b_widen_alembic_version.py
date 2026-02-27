"""widen alembic_version.version_num for long revision IDs

Revision ID: 0004b_widen_alembic_version
Revises: 0004_assessment_categories
Create Date: 2026-02-27

"""
from collections.abc import Sequence

from alembic import op


revision: str = '0004b_widen_alembic_version'
down_revision: str | None = '0004_assessment_categories'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(64)")


def downgrade() -> None:
    op.execute("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(32)")
