"""Add platform_releases, platform_release_work_orders, wo_dc_deployments tables.

Revision ID: 0049_platform_releases
Revises: 0048_release_notes_module
Create Date: 2026-03-25
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0049_platform_releases"
down_revision: str | Sequence[str] | None = "0048_release_notes_module"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TENANT_TABLES = [
    "release_mgmt.platform_releases",
    "release_mgmt.wo_dc_deployments",
]


def upgrade() -> None:
    op.create_table(
        "platform_releases",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("release_type", sa.String(length=20), nullable=False, server_default="quarterly"),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="draft"),
        sa.Column("environment", sa.String(length=60), nullable=True),
        sa.Column("data_center_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("cab_approver_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("cab_approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cab_notes", sa.Text(), nullable=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("generated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "services_snapshot",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "changelog_snapshot",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "deploy_steps_snapshot",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("deployed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deployed_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "release_type in ('quarterly','ad_hoc','security','bugfix')",
            name="ck_release_mgmt_platform_releases_type",
        ),
        sa.CheckConstraint(
            "status in ('draft','preparation','cab_approved','deploying','deployed','closed')",
            name="ck_release_mgmt_platform_releases_status",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["data_center_id"],
            ["release_mgmt.data_centers.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(["cab_approver_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["generated_by"], ["users.id"], ondelete="SET NULL"),
        schema="release_mgmt",
    )
    op.create_index("ix_release_mgmt_platform_releases_tenant", "platform_releases", ["tenant_id"], schema="release_mgmt")
    op.create_index("ix_release_mgmt_platform_releases_status", "platform_releases", ["status"], schema="release_mgmt")
    op.create_index("ix_release_mgmt_platform_releases_type", "platform_releases", ["release_type"], schema="release_mgmt")

    op.create_table(
        "platform_release_work_orders",
        sa.Column("platform_release_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("work_order_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("included_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("included_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("platform_release_id", "work_order_id"),
        sa.ForeignKeyConstraint(
            ["platform_release_id"],
            ["release_mgmt.platform_releases.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["work_order_id"],
            ["release_mgmt.work_orders.id"],
            ondelete="CASCADE",
        ),
        schema="release_mgmt",
    )
    op.create_index(
        "ix_release_mgmt_prwo_release",
        "platform_release_work_orders",
        ["platform_release_id"],
        schema="release_mgmt",
    )
    op.create_index(
        "ix_release_mgmt_prwo_wo",
        "platform_release_work_orders",
        ["work_order_id"],
        schema="release_mgmt",
    )

    op.create_table(
        "wo_dc_deployments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("work_order_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("data_center_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("platform_release_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("environment", sa.String(length=60), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="pending"),
        sa.Column("deployed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deployed_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "status in ('pending','deploying','deployed','failed','rolled_back')",
            name="ck_release_mgmt_wo_dc_deployments_status",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["work_order_id"],
            ["release_mgmt.work_orders.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["data_center_id"],
            ["release_mgmt.data_centers.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["platform_release_id"],
            ["release_mgmt.platform_releases.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(["deployed_by"], ["users.id"], ondelete="SET NULL"),
        schema="release_mgmt",
    )
    op.create_index("ix_release_mgmt_wo_dc_deployments_tenant", "wo_dc_deployments", ["tenant_id"], schema="release_mgmt")
    op.create_index("ix_release_mgmt_wo_dc_deployments_wo", "wo_dc_deployments", ["work_order_id"], schema="release_mgmt")
    op.create_index("ix_release_mgmt_wo_dc_deployments_dc", "wo_dc_deployments", ["data_center_id"], schema="release_mgmt")

    for table in TENANT_TABLES:
        policy = f"tenant_isolation_{table.replace('.', '_')}"
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY {policy}
            ON {table}
            USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
            WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
            """
        )


def downgrade() -> None:
    for table in TENANT_TABLES:
        policy = f"tenant_isolation_{table.replace('.', '_')}"
        op.execute(f"DROP POLICY IF EXISTS {policy} ON {table}")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.drop_index("ix_release_mgmt_wo_dc_deployments_dc", table_name="wo_dc_deployments", schema="release_mgmt")
    op.drop_index("ix_release_mgmt_wo_dc_deployments_wo", table_name="wo_dc_deployments", schema="release_mgmt")
    op.drop_index("ix_release_mgmt_wo_dc_deployments_tenant", table_name="wo_dc_deployments", schema="release_mgmt")
    op.drop_table("wo_dc_deployments", schema="release_mgmt")

    op.drop_index("ix_release_mgmt_prwo_wo", table_name="platform_release_work_orders", schema="release_mgmt")
    op.drop_index("ix_release_mgmt_prwo_release", table_name="platform_release_work_orders", schema="release_mgmt")
    op.drop_table("platform_release_work_orders", schema="release_mgmt")

    op.drop_index("ix_release_mgmt_platform_releases_type", table_name="platform_releases", schema="release_mgmt")
    op.drop_index("ix_release_mgmt_platform_releases_status", table_name="platform_releases", schema="release_mgmt")
    op.drop_index("ix_release_mgmt_platform_releases_tenant", table_name="platform_releases", schema="release_mgmt")
    op.drop_table("platform_releases", schema="release_mgmt")
