"""compliance client requirements tables

Revision ID: 0021_compliance_clients
Revises: 0020_compliance_practices
Create Date: 2026-03-02
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0021_compliance_clients"
down_revision: str | Sequence[str] | None = "0020_compliance_practices"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


COMPLIANCE_SCHEMA = "compliance"


TENANT_TABLES = [
    f"{COMPLIANCE_SCHEMA}.client_groups",
    f"{COMPLIANCE_SCHEMA}.client_set_versions",
    f"{COMPLIANCE_SCHEMA}.client_requirements",
    f"{COMPLIANCE_SCHEMA}.client_match_runs",
    f"{COMPLIANCE_SCHEMA}.client_match_results",
]


def upgrade() -> None:
    op.create_table(
        "client_groups",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("country", sa.String(length=80), nullable=True),
        sa.Column("bank_name", sa.String(length=200), nullable=True),
        sa.Column("project", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        schema=COMPLIANCE_SCHEMA,
    )
    op.create_index(
        "ix_compliance_client_groups_tenant",
        "client_groups",
        ["tenant_id"],
        schema=COMPLIANCE_SCHEMA,
    )

    op.create_table(
        "client_set_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("client_group_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_label", sa.String(length=60), nullable=False),
        sa.Column("is_active_version", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("last_matched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("library_batch_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        schema=COMPLIANCE_SCHEMA,
    )
    op.create_index(
        "ix_compliance_client_set_versions_tenant",
        "client_set_versions",
        ["tenant_id"],
        schema=COMPLIANCE_SCHEMA,
    )

    op.create_table(
        "client_requirements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("client_set_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("priority", sa.String(length=20), nullable=True),
        sa.Column("category", sa.String(length=80), nullable=True),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        schema=COMPLIANCE_SCHEMA,
    )
    op.create_index(
        "ix_compliance_client_requirements_version",
        "client_requirements",
        ["tenant_id", "client_set_version_id"],
        schema=COMPLIANCE_SCHEMA,
    )

    op.create_table(
        "client_match_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("client_set_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("run_type", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("model_info_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("input_hash", sa.String(length=128), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "run_type in ('single','bulk')",
            name="ck_compliance_client_match_runs_type",
        ),
        sa.CheckConstraint(
            "status in ('pending','running','success','failed')",
            name="ck_compliance_client_match_runs_status",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        schema=COMPLIANCE_SCHEMA,
    )
    op.create_index(
        "ix_compliance_client_match_runs_tenant",
        "client_match_runs",
        ["tenant_id"],
        schema=COMPLIANCE_SCHEMA,
    )

    op.create_table(
        "client_match_results",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_requirement_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("control_key", sa.String(length=120), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="0"),
        sa.Column("coverage_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("rationale", sa.Text(), nullable=False, server_default=""),
        sa.Column("suggested_evidence_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("accepted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("manual_override", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("override_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        schema=COMPLIANCE_SCHEMA,
    )
    op.create_index(
        "ix_compliance_client_match_results_requirement",
        "client_match_results",
        ["tenant_id", "client_requirement_id"],
        schema=COMPLIANCE_SCHEMA,
    )
    op.create_index(
        "ix_compliance_client_match_results_control",
        "client_match_results",
        ["tenant_id", "control_key"],
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
        "ix_compliance_client_match_results_control",
        table_name="client_match_results",
        schema=COMPLIANCE_SCHEMA,
    )
    op.drop_index(
        "ix_compliance_client_match_results_requirement",
        table_name="client_match_results",
        schema=COMPLIANCE_SCHEMA,
    )
    op.drop_table("client_match_results", schema=COMPLIANCE_SCHEMA)

    op.drop_index(
        "ix_compliance_client_match_runs_tenant",
        table_name="client_match_runs",
        schema=COMPLIANCE_SCHEMA,
    )
    op.drop_table("client_match_runs", schema=COMPLIANCE_SCHEMA)

    op.drop_index(
        "ix_compliance_client_requirements_version",
        table_name="client_requirements",
        schema=COMPLIANCE_SCHEMA,
    )
    op.drop_table("client_requirements", schema=COMPLIANCE_SCHEMA)

    op.drop_index(
        "ix_compliance_client_set_versions_tenant",
        table_name="client_set_versions",
        schema=COMPLIANCE_SCHEMA,
    )
    op.drop_table("client_set_versions", schema=COMPLIANCE_SCHEMA)

    op.drop_index(
        "ix_compliance_client_groups_tenant",
        table_name="client_groups",
        schema=COMPLIANCE_SCHEMA,
    )
    op.drop_table("client_groups", schema=COMPLIANCE_SCHEMA)
