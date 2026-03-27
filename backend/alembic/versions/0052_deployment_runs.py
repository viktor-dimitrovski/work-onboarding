"""Add deployment_runs and deployment_run_items tables for deployment checklist feature.

Revision ID: 0052_deployment_runs
Revises: 0051_achievements
Create Date: 2026-03-27
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0052_deployment_runs"
down_revision: str | Sequence[str] | None = "0051_achievements"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TENANT_TABLES = [
    "release_mgmt.deployment_runs",
]


def upgrade() -> None:
    op.create_table(
        "deployment_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("platform_release_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("data_center_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("environment", sa.String(length=60), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("started_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reopened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reopened_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reopen_reason", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "status in ('pending','in_progress','completed','partial','aborted')",
            name="ck_release_mgmt_deployment_runs_status",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["platform_release_id"],
            ["release_mgmt.platform_releases.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["data_center_id"],
            ["release_mgmt.data_centers.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["started_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reopened_by"], ["users.id"], ondelete="SET NULL"),
        schema="release_mgmt",
    )
    op.create_index(
        "ix_release_mgmt_deployment_runs_tenant",
        "deployment_runs",
        ["tenant_id"],
        schema="release_mgmt",
    )
    op.create_index(
        "ix_release_mgmt_deployment_runs_platform_release",
        "deployment_runs",
        ["platform_release_id"],
        schema="release_mgmt",
    )
    op.create_index(
        "ix_release_mgmt_deployment_runs_status",
        "deployment_runs",
        ["status"],
        schema="release_mgmt",
    )
    # Partial unique index: only one active run per release+DC+ENV
    op.execute(
        """
        CREATE UNIQUE INDEX uq_release_mgmt_deployment_runs_active
        ON release_mgmt.deployment_runs (platform_release_id, data_center_id, environment)
        WHERE status IN ('pending', 'in_progress')
        """
    )

    op.create_table(
        "deployment_run_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("deployment_run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("group_key", sa.String(length=300), nullable=False),
        sa.Column("group_label", sa.String(length=300), nullable=False),
        sa.Column("step_index", sa.Integer(), nullable=False),
        sa.Column("item_title", sa.String(length=500), nullable=False),
        sa.Column("migration_step", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("marked_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("marked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status in ('pending','in_progress','done','blocked','postponed','skipped')",
            name="ck_release_mgmt_deployment_run_items_status",
        ),
        sa.ForeignKeyConstraint(
            ["deployment_run_id"],
            ["release_mgmt.deployment_runs.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["marked_by"], ["users.id"], ondelete="SET NULL"),
        schema="release_mgmt",
    )
    op.create_index(
        "ix_release_mgmt_deployment_run_items_run",
        "deployment_run_items",
        ["deployment_run_id"],
        schema="release_mgmt",
    )
    op.create_index(
        "ix_release_mgmt_deployment_run_items_status",
        "deployment_run_items",
        ["status"],
        schema="release_mgmt",
    )

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

    op.drop_index("ix_release_mgmt_deployment_run_items_status", table_name="deployment_run_items", schema="release_mgmt")
    op.drop_index("ix_release_mgmt_deployment_run_items_run", table_name="deployment_run_items", schema="release_mgmt")
    op.drop_table("deployment_run_items", schema="release_mgmt")

    op.execute("DROP INDEX IF EXISTS release_mgmt.uq_release_mgmt_deployment_runs_active")
    op.drop_index("ix_release_mgmt_deployment_runs_status", table_name="deployment_runs", schema="release_mgmt")
    op.drop_index("ix_release_mgmt_deployment_runs_platform_release", table_name="deployment_runs", schema="release_mgmt")
    op.drop_index("ix_release_mgmt_deployment_runs_tenant", table_name="deployment_runs", schema="release_mgmt")
    op.drop_table("deployment_runs", schema="release_mgmt")
