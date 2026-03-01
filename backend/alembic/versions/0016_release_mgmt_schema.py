"""release_mgmt schema + work orders + release manifests

Revision ID: 0016_release_mgmt_schema
Revises: 0015_user_preferences_jsonb
Create Date: 2026-02-28
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0016_release_mgmt_schema"
down_revision: str | Sequence[str] | None = "0015_user_preferences_jsonb"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TENANT_TABLES = [
    "release_mgmt.work_orders",
    "release_mgmt.work_order_services",
    "release_mgmt.release_manifests",
    "release_mgmt.release_plans",
]


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS release_mgmt")

    op.create_table(
        "work_orders",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("wo_id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("wo_type", sa.String(length=30), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=True),
        sa.Column("risk", sa.String(length=20), nullable=True),
        sa.Column("owner", sa.String(length=120), nullable=True),
        sa.Column("requested_by", sa.String(length=120), nullable=True),
        sa.Column(
            "tenants_impacted",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "target_envs",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("postman_testing_ref", sa.Text(), nullable=True),
        sa.Column("body_markdown", sa.Text(), nullable=False, server_default=""),
        sa.Column("raw_markdown", sa.Text(), nullable=False, server_default=""),
        sa.Column("git_repo_full_name", sa.String(length=200), nullable=True),
        sa.Column("git_folder_path", sa.String(length=200), nullable=True),
        sa.Column("git_path", sa.String(length=255), nullable=True),
        sa.Column("git_branch", sa.String(length=120), nullable=True),
        sa.Column("git_sha", sa.String(length=120), nullable=True),
        sa.Column("pr_url", sa.String(length=255), nullable=True),
        sa.Column("sync_status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_error", sa.Text(), nullable=True),
        sa.Column("sync_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("tenant_id", "id", name="uq_release_mgmt_work_orders_tenant_id"),
        sa.UniqueConstraint("tenant_id", "wo_id", name="uq_release_mgmt_work_orders_wo_id"),
        sa.CheckConstraint(
            "sync_status in ('pending','synced','failed','disabled')",
            name="ck_release_mgmt_work_orders_sync_status",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        schema="release_mgmt",
    )
    op.create_index(
        "ix_release_mgmt_work_orders_tenant",
        "work_orders",
        ["tenant_id"],
        schema="release_mgmt",
    )
    op.create_index(
        "ix_release_mgmt_work_orders_wo_id",
        "work_orders",
        ["wo_id"],
        schema="release_mgmt",
    )
    op.create_index(
        "ix_release_mgmt_work_orders_status",
        "work_orders",
        ["status"],
        schema="release_mgmt",
    )
    op.create_index(
        "ix_release_mgmt_work_orders_sync_status",
        "work_orders",
        ["sync_status"],
        schema="release_mgmt",
    )

    op.create_table(
        "work_order_services",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("work_order_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("service_id", sa.String(length=200), nullable=False),
        sa.Column("repo", sa.String(length=200), nullable=True),
        sa.Column("change_type", sa.String(length=40), nullable=True),
        sa.Column("requires_deploy", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("requires_db_migration", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("requires_config_change", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "feature_flags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("release_notes_ref", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["tenant_id", "work_order_id"],
            ["release_mgmt.work_orders.tenant_id", "release_mgmt.work_orders.id"],
            ondelete="CASCADE",
        ),
        schema="release_mgmt",
    )
    op.create_index(
        "ix_release_mgmt_work_order_services_tenant",
        "work_order_services",
        ["tenant_id"],
        schema="release_mgmt",
    )
    op.create_index(
        "ix_release_mgmt_work_order_services_work_order",
        "work_order_services",
        ["work_order_id"],
        schema="release_mgmt",
    )
    op.create_index(
        "ix_release_mgmt_work_order_services_service_id",
        "work_order_services",
        ["service_id"],
        schema="release_mgmt",
    )

    op.create_table(
        "release_manifests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("rel_id", sa.String(length=64), nullable=False),
        sa.Column("env", sa.String(length=60), nullable=True),
        sa.Column("window", sa.String(length=120), nullable=True),
        sa.Column(
            "includes_work_orders",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "versions",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "release_notes",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "deploy_list",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("raw_markdown", sa.Text(), nullable=False, server_default=""),
        sa.Column("git_repo_full_name", sa.String(length=200), nullable=True),
        sa.Column("git_folder_path", sa.String(length=200), nullable=True),
        sa.Column("git_path", sa.String(length=255), nullable=True),
        sa.Column("git_branch", sa.String(length=120), nullable=True),
        sa.Column("git_sha", sa.String(length=120), nullable=True),
        sa.Column("pr_url", sa.String(length=255), nullable=True),
        sa.Column("sync_status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_error", sa.Text(), nullable=True),
        sa.Column("sync_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("tenant_id", "rel_id", name="uq_release_mgmt_release_manifests_rel_id"),
        sa.CheckConstraint(
            "sync_status in ('pending','synced','failed','disabled')",
            name="ck_release_mgmt_release_manifests_sync_status",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        schema="release_mgmt",
    )
    op.create_index(
        "ix_release_mgmt_release_manifests_tenant",
        "release_manifests",
        ["tenant_id"],
        schema="release_mgmt",
    )
    op.create_index(
        "ix_release_mgmt_release_manifests_rel_id",
        "release_manifests",
        ["rel_id"],
        schema="release_mgmt",
    )
    op.create_index(
        "ix_release_mgmt_release_manifests_sync_status",
        "release_manifests",
        ["sync_status"],
        schema="release_mgmt",
    )

    op.create_table(
        "release_plans",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("assignment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("environment", sa.String(length=60), nullable=True),
        sa.Column("version_tag", sa.String(length=80), nullable=True),
        sa.Column("release_manager_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("rel_id", sa.String(length=64), nullable=True),
        sa.Column(
            "links_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("tenant_id", "assignment_id", name="uq_release_mgmt_release_plans_assignment"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "assignment_id"],
            ["onboarding_assignments.tenant_id", "onboarding_assignments.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["release_manager_user_id"], ["users.id"], ondelete="SET NULL"),
        schema="release_mgmt",
    )
    op.create_index(
        "ix_release_mgmt_release_plans_tenant",
        "release_plans",
        ["tenant_id"],
        schema="release_mgmt",
    )
    op.create_index(
        "ix_release_mgmt_release_plans_assignment",
        "release_plans",
        ["assignment_id"],
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

    op.drop_index("ix_release_mgmt_release_plans_assignment", table_name="release_plans", schema="release_mgmt")
    op.drop_index("ix_release_mgmt_release_plans_tenant", table_name="release_plans", schema="release_mgmt")
    op.drop_table("release_plans", schema="release_mgmt")

    op.drop_index("ix_release_mgmt_release_manifests_sync_status", table_name="release_manifests", schema="release_mgmt")
    op.drop_index("ix_release_mgmt_release_manifests_rel_id", table_name="release_manifests", schema="release_mgmt")
    op.drop_index("ix_release_mgmt_release_manifests_tenant", table_name="release_manifests", schema="release_mgmt")
    op.drop_table("release_manifests", schema="release_mgmt")

    op.drop_index(
        "ix_release_mgmt_work_order_services_service_id",
        table_name="work_order_services",
        schema="release_mgmt",
    )
    op.drop_index(
        "ix_release_mgmt_work_order_services_work_order",
        table_name="work_order_services",
        schema="release_mgmt",
    )
    op.drop_index(
        "ix_release_mgmt_work_order_services_tenant",
        table_name="work_order_services",
        schema="release_mgmt",
    )
    op.drop_table("work_order_services", schema="release_mgmt")

    op.drop_index("ix_release_mgmt_work_orders_sync_status", table_name="work_orders", schema="release_mgmt")
    op.drop_index("ix_release_mgmt_work_orders_status", table_name="work_orders", schema="release_mgmt")
    op.drop_index("ix_release_mgmt_work_orders_wo_id", table_name="work_orders", schema="release_mgmt")
    op.drop_index("ix_release_mgmt_work_orders_tenant", table_name="work_orders", schema="release_mgmt")
    op.drop_table("work_orders", schema="release_mgmt")

    op.execute("DROP SCHEMA IF EXISTS release_mgmt")

