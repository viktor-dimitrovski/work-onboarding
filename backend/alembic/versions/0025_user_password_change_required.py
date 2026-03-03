"""user password change required

Revision ID: 0025_user_password_change_required
Revises: 0024_tenant_membership_roles_jsonb
Create Date: 2026-03-03
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0025_user_password_change_required"
down_revision: str | Sequence[str] | None = "0024_tenant_membership_roles_jsonb"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("password_change_required", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "users",
        sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.alter_column("users", "password_change_required", server_default=None)


def downgrade() -> None:
    op.drop_column("users", "password_changed_at")
    op.drop_column("users", "password_change_required")

