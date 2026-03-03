"""compliance semantic match runs

Revision ID: 0026_compliance_semantic_match_runs
Revises: 0025_user_password_change_required
Create Date: 2026-03-03
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0026_compliance_semantic_match_runs"
down_revision: str | Sequence[str] | None = "0025_user_password_change_required"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


COMPLIANCE_SCHEMA = "compliance"


def upgrade() -> None:
    op.create_table(
        "semantic_match_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("profile_key", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="success"),
        sa.Column(
            "model_info_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("input_hash", sa.String(length=128), nullable=False),
        sa.Column(
            "result_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status in ('success','failed')",
            name="ck_compliance_semantic_match_runs_status",
        ),
        schema=COMPLIANCE_SCHEMA,
    )
    op.create_index(
        "ix_compliance_semantic_match_runs_tenant_created",
        "semantic_match_runs",
        ["tenant_id", "created_at"],
        schema=COMPLIANCE_SCHEMA,
    )
    op.alter_column("semantic_match_runs", "status", server_default=None, schema=COMPLIANCE_SCHEMA)


def downgrade() -> None:
    op.drop_index(
        "ix_compliance_semantic_match_runs_tenant_created",
        table_name="semantic_match_runs",
        schema=COMPLIANCE_SCHEMA,
    )
    op.drop_table("semantic_match_runs", schema=COMPLIANCE_SCHEMA)
