"""compliance snapshots + remediation + work items

Revision ID: 0019_compliance_snapshots_gaps
Revises: 0018_compliance_tenant_library
Create Date: 2026-03-02
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0019_compliance_snapshots_gaps"
down_revision: str | Sequence[str] | None = "0018_compliance_tenant_library"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


COMPLIANCE_SCHEMA = "compliance"


TENANT_TABLES = [
    f"{COMPLIANCE_SCHEMA}.compliance_snapshots",
    f"{COMPLIANCE_SCHEMA}.work_item_links",
]


def upgrade() -> None:
    op.add_column(
        "control_status",
        sa.Column("target_score", sa.Float(), nullable=True),
        schema=COMPLIANCE_SCHEMA,
    )
    op.add_column(
        "control_status",
        sa.Column("priority", sa.String(length=20), nullable=True),
        schema=COMPLIANCE_SCHEMA,
    )
    op.add_column(
        "control_status",
        sa.Column("due_date", sa.DateTime(timezone=True), nullable=True),
        schema=COMPLIANCE_SCHEMA,
    )
    op.add_column(
        "control_status",
        sa.Column("remediation_notes", sa.Text(), nullable=True),
        schema=COMPLIANCE_SCHEMA,
    )
    op.add_column(
        "control_status",
        sa.Column("remediation_owner_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema=COMPLIANCE_SCHEMA,
    )

    op.create_table(
        "compliance_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("scope", sa.String(length=30), nullable=False),
        sa.Column("profile_key", sa.String(length=120), nullable=False),
        sa.Column("framework_key", sa.String(length=80), nullable=True),
        sa.Column("client_set_version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("library_batch_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("implementation_percent", sa.Float(), nullable=True),
        sa.Column("coverage_percent", sa.Float(), nullable=True),
        sa.Column("metrics_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("input_hash", sa.String(length=128), nullable=False),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("computed_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint(
            "scope in ('overall','framework','client_set')",
            name="ck_compliance_snapshots_scope",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        schema=COMPLIANCE_SCHEMA,
    )
    op.create_index(
        "ix_compliance_snapshots_tenant_scope_time",
        "compliance_snapshots",
        ["tenant_id", "scope", "computed_at"],
        schema=COMPLIANCE_SCHEMA,
    )

    op.create_table(
        "work_item_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("source_type", sa.String(length=30), nullable=False),
        sa.Column("source_key", sa.String(length=200), nullable=False),
        sa.Column("link_type", sa.String(length=30), nullable=False),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("work_order_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint(
            "source_type in ('control','gap','practice','client_requirement')",
            name="ck_compliance_work_item_links_source_type",
        ),
        sa.CheckConstraint(
            "link_type in ('jira','work_order','track')",
            name="ck_compliance_work_item_links_link_type",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        schema=COMPLIANCE_SCHEMA,
    )
    op.create_index(
        "ix_compliance_work_item_links_source",
        "work_item_links",
        ["tenant_id", "source_type", "source_key"],
        schema=COMPLIANCE_SCHEMA,
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

    op.drop_index(
        "ix_compliance_work_item_links_source",
        table_name="work_item_links",
        schema=COMPLIANCE_SCHEMA,
    )
    op.drop_table("work_item_links", schema=COMPLIANCE_SCHEMA)

    op.drop_index(
        "ix_compliance_snapshots_tenant_scope_time",
        table_name="compliance_snapshots",
        schema=COMPLIANCE_SCHEMA,
    )
    op.drop_table("compliance_snapshots", schema=COMPLIANCE_SCHEMA)

    op.drop_column("control_status", "remediation_owner_user_id", schema=COMPLIANCE_SCHEMA)
    op.drop_column("control_status", "remediation_notes", schema=COMPLIANCE_SCHEMA)
    op.drop_column("control_status", "due_date", schema=COMPLIANCE_SCHEMA)
    op.drop_column("control_status", "priority", schema=COMPLIANCE_SCHEMA)
    op.drop_column("control_status", "target_score", schema=COMPLIANCE_SCHEMA)
