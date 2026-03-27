"""Add data_centers table and branch column to work_order_services.

Revision ID: 0047_data_centers_and_branch
Revises: 0046_category_slug_unique_per_parent
Create Date: 2026-03-25
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0047_data_centers_and_branch"
down_revision: str | Sequence[str] | None = "0046_category_slug_unique_per_parent"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "data_centers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("location", sa.String(length=120), nullable=True),
        sa.Column("cluster_url", sa.String(length=255), nullable=True),
        sa.Column("k8s_context", sa.String(length=120), nullable=True),
        sa.Column("environment", sa.String(length=30), nullable=False, server_default="production"),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_dr", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("tenant_id", "slug", name="uq_release_mgmt_data_centers_slug"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        schema="release_mgmt",
    )
    op.create_index("ix_release_mgmt_data_centers_tenant", "data_centers", ["tenant_id"], schema="release_mgmt")
    op.create_index("ix_release_mgmt_data_centers_slug", "data_centers", ["slug"], schema="release_mgmt")

    op.execute("ALTER TABLE release_mgmt.data_centers ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation_release_mgmt_data_centers
        ON release_mgmt.data_centers
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
        """
    )

    # Add branch column to work_order_services
    op.add_column(
        "work_order_services",
        sa.Column("branch", sa.String(length=120), nullable=True),
        schema="release_mgmt",
    )
    op.create_index(
        "ix_release_mgmt_work_order_services_branch",
        "work_order_services",
        ["branch"],
        schema="release_mgmt",
    )


def downgrade() -> None:
    op.drop_index("ix_release_mgmt_work_order_services_branch", table_name="work_order_services", schema="release_mgmt")
    op.drop_column("work_order_services", "branch", schema="release_mgmt")

    op.execute("DROP POLICY IF EXISTS tenant_isolation_release_mgmt_data_centers ON release_mgmt.data_centers")
    op.execute("ALTER TABLE release_mgmt.data_centers DISABLE ROW LEVEL SECURITY")
    op.drop_index("ix_release_mgmt_data_centers_slug", table_name="data_centers", schema="release_mgmt")
    op.drop_index("ix_release_mgmt_data_centers_tenant", table_name="data_centers", schema="release_mgmt")
    op.drop_table("data_centers", schema="release_mgmt")
