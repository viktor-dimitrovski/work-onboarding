"""compliance schema + frameworks + controls + tenant tracking

Revision ID: 0017_compliance_schema
Revises: 0016_release_mgmt_schema
Create Date: 2026-03-02
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0017_compliance_schema"
down_revision: str | Sequence[str] | None = "0016_release_mgmt_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


COMPLIANCE_SCHEMA = "compliance"
TENANT_TABLES = [
    f"{COMPLIANCE_SCHEMA}.tenant_profiles",
    f"{COMPLIANCE_SCHEMA}.control_status",
    f"{COMPLIANCE_SCHEMA}.evidence",
]


def upgrade() -> None:
    op.execute(f"CREATE SCHEMA IF NOT EXISTS {COMPLIANCE_SCHEMA}")

    op.create_table(
        "frameworks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("framework_key", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=True),
        sa.Column("version", sa.String(length=60), nullable=True),
        sa.Column("type", sa.String(length=60), nullable=True),
        sa.Column("region", sa.String(length=80), nullable=True),
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "references",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.UniqueConstraint("framework_key", name="uq_compliance_frameworks_framework_key"),
        schema=COMPLIANCE_SCHEMA,
    )

    op.create_table(
        "domains",
        sa.Column("code", sa.String(length=80), primary_key=True, nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        schema=COMPLIANCE_SCHEMA,
    )

    op.create_table(
        "controls",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("control_key", sa.String(length=120), nullable=False),
        sa.Column("code", sa.String(length=60), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("domain_code", sa.String(length=80), nullable=False),
        sa.Column("criticality", sa.String(length=10), nullable=False),
        sa.Column("weight", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("evidence_expected", sa.Text(), nullable=False),
        sa.Column("default_status", sa.String(length=20), nullable=False, server_default="not_started"),
        sa.Column("default_score", sa.Numeric(3, 2), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(
            ["domain_code"],
            [f"{COMPLIANCE_SCHEMA}.domains.code"],
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("control_key", name="uq_compliance_controls_control_key"),
        sa.UniqueConstraint("code", name="uq_compliance_controls_code"),
        sa.CheckConstraint(
            "criticality in ('Low','Medium','High')",
            name="ck_compliance_controls_criticality",
        ),
        sa.CheckConstraint(
            "default_status in ('not_started','in_progress','partial','mostly','implemented','na')",
            name="ck_compliance_controls_default_status",
        ),
        schema=COMPLIANCE_SCHEMA,
    )

    op.create_table(
        "control_framework_refs",
        sa.Column("control_id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("framework_id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("ref", sa.String(length=200), primary_key=True, nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["control_id"],
            [f"{COMPLIANCE_SCHEMA}.controls.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["framework_id"],
            [f"{COMPLIANCE_SCHEMA}.frameworks.id"],
            ondelete="CASCADE",
        ),
        schema=COMPLIANCE_SCHEMA,
    )
    op.create_index(
        "ix_compliance_control_framework_refs_control_framework",
        "control_framework_refs",
        ["control_id", "framework_id"],
        schema=COMPLIANCE_SCHEMA,
    )

    op.create_table(
        "profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("profile_key", sa.String(length=120), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.UniqueConstraint("profile_key", name="uq_compliance_profiles_profile_key"),
        schema=COMPLIANCE_SCHEMA,
    )

    op.create_table(
        "profile_controls",
        sa.Column("profile_id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("control_id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            [f"{COMPLIANCE_SCHEMA}.profiles.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["control_id"],
            [f"{COMPLIANCE_SCHEMA}.controls.id"],
            ondelete="CASCADE",
        ),
        schema=COMPLIANCE_SCHEMA,
    )

    op.create_table(
        "seed_import_batches",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("dataset", sa.String(length=160), nullable=False),
        sa.Column("schema_version", sa.String(length=20), nullable=False),
        sa.Column("exported_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source", sa.String(length=80), nullable=False),
        sa.Column("payload_sha256", sa.String(length=128), nullable=False),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("imported_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema=COMPLIANCE_SCHEMA,
    )

    op.create_table(
        "tenant_profiles",
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("profile_id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            [f"{COMPLIANCE_SCHEMA}.profiles.id"],
            ondelete="CASCADE",
        ),
        schema=COMPLIANCE_SCHEMA,
    )
    op.create_index(
        "ux_compliance_tenant_single_active_profile",
        "tenant_profiles",
        ["tenant_id"],
        unique=True,
        schema=COMPLIANCE_SCHEMA,
        postgresql_where=sa.text("enabled"),
    )

    op.create_table(
        "control_status",
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("control_id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("status_enum", sa.String(length=20), nullable=False, server_default="not_started"),
        sa.Column("score", sa.Numeric(3, 2), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("last_reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("na_reason", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["control_id"],
            [f"{COMPLIANCE_SCHEMA}.controls.id"],
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "status_enum in ('not_started','in_progress','partial','mostly','implemented','na')",
            name="ck_compliance_control_status_status_enum",
        ),
        sa.CheckConstraint(
            "score >= 0 AND score <= 1",
            name="ck_compliance_control_status_score_range",
        ),
        sa.CheckConstraint(
            "status_enum <> 'na' OR (na_reason IS NOT NULL AND score = 0)",
            name="ck_compliance_control_status_na_rule",
        ),
        schema=COMPLIANCE_SCHEMA,
    )
    op.create_index(
        "ix_compliance_control_status_tenant_status",
        "control_status",
        ["tenant_id", "status_enum"],
        schema=COMPLIANCE_SCHEMA,
    )

    op.create_table(
        "evidence",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("control_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("type", sa.String(length=12), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["control_id"],
            [f"{COMPLIANCE_SCHEMA}.controls.id"],
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "type in ('link','text')",
            name="ck_compliance_evidence_type",
        ),
        sa.CheckConstraint(
            "(type = 'link' AND url IS NOT NULL) OR (type = 'text' AND text IS NOT NULL)",
            name="ck_compliance_evidence_type_fields",
        ),
        schema=COMPLIANCE_SCHEMA,
    )
    op.create_index(
        "ix_compliance_evidence_tenant_control_created",
        "evidence",
        ["tenant_id", "control_id", "created_at"],
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
        "ix_compliance_evidence_tenant_control_created",
        table_name="evidence",
        schema=COMPLIANCE_SCHEMA,
    )
    op.drop_table("evidence", schema=COMPLIANCE_SCHEMA)

    op.drop_index(
        "ix_compliance_control_status_tenant_status",
        table_name="control_status",
        schema=COMPLIANCE_SCHEMA,
    )
    op.drop_table("control_status", schema=COMPLIANCE_SCHEMA)

    op.drop_index(
        "ux_compliance_tenant_single_active_profile",
        table_name="tenant_profiles",
        schema=COMPLIANCE_SCHEMA,
    )
    op.drop_table("tenant_profiles", schema=COMPLIANCE_SCHEMA)

    op.drop_table("seed_import_batches", schema=COMPLIANCE_SCHEMA)

    op.drop_table("profile_controls", schema=COMPLIANCE_SCHEMA)
    op.drop_table("profiles", schema=COMPLIANCE_SCHEMA)

    op.drop_index(
        "ix_compliance_control_framework_refs_control_framework",
        table_name="control_framework_refs",
        schema=COMPLIANCE_SCHEMA,
    )
    op.drop_table("control_framework_refs", schema=COMPLIANCE_SCHEMA)

    op.drop_table("controls", schema=COMPLIANCE_SCHEMA)
    op.drop_table("domains", schema=COMPLIANCE_SCHEMA)
    op.drop_table("frameworks", schema=COMPLIANCE_SCHEMA)

    op.execute(f"DROP SCHEMA IF EXISTS {COMPLIANCE_SCHEMA}")
