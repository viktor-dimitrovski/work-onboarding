"""merge multiple heads

Revision ID: 0009_merge_heads
Revises: 0008_tenant_id_rls, 0004_track_task_assessment
Create Date: 2026-02-27

"""
from collections.abc import Sequence

from alembic import op


revision: str = '0009_merge_heads'
down_revision: str | tuple[str, ...] | None = ('0008_tenant_id_rls', '0004_track_task_assessment')
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
