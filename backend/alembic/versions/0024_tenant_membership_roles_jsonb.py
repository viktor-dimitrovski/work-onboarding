"""tenant membership roles jsonb

Revision ID: 0024_tenant_membership_roles_jsonb
Revises: 0023_compliance_practice_metadata
Create Date: 2026-03-03
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0024_tenant_membership_roles_jsonb"
down_revision: str | Sequence[str] | None = "0023_compliance_practice_metadata"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tenant_memberships",
        sa.Column(
            "roles",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[\"member\"]'::jsonb"),
        ),
    )
    # Backfill from legacy single-role column when present.
    op.execute(
        """
        UPDATE tenant_memberships
        SET roles = jsonb_build_array(role)
        WHERE role IS NOT NULL
        """
    )
    op.alter_column("tenant_memberships", "roles", server_default=None)


def downgrade() -> None:
    op.drop_column("tenant_memberships", "roles")

