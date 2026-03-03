"""compliance tenant library + control_key migration

Revision ID: 0018_compliance_tenant_library
Revises: 0017_compliance_schema
Create Date: 2026-03-02
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0018_compliance_tenant_library"
down_revision: str | Sequence[str] | None = "0017_compliance_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


COMPLIANCE_SCHEMA = "compliance"


TENANT_TABLES = [
    f"{COMPLIANCE_SCHEMA}.tenant_library_import_batches",
    f"{COMPLIANCE_SCHEMA}.tenant_frameworks",
    f"{COMPLIANCE_SCHEMA}.tenant_domains",
    f"{COMPLIANCE_SCHEMA}.tenant_controls",
    f"{COMPLIANCE_SCHEMA}.tenant_control_framework_refs",
    f"{COMPLIANCE_SCHEMA}.tenant_library_profiles",
    f"{COMPLIANCE_SCHEMA}.tenant_profile_controls",
]


def upgrade() -> None:
    op.create_table(
        "tenant_library_import_batches",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("schema_version", sa.String(length=30), nullable=False),
        sa.Column("dataset", sa.String(length=160), nullable=False),
        sa.Column("exported_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version_label", sa.String(length=80), nullable=True),
        sa.Column("source", sa.String(length=80), nullable=False),
        sa.Column("payload_sha256", sa.String(length=128), nullable=False),
        sa.Column(
            "payload_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("imported_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        schema=COMPLIANCE_SCHEMA,
    )
    op.create_index(
        "ix_compliance_tenant_library_batches_tenant",
        "tenant_library_import_batches",
        ["tenant_id"],
        schema=COMPLIANCE_SCHEMA,
    )

    op.create_table(
        "tenant_frameworks",
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("framework_key", sa.String(length=80), primary_key=True, nullable=False),
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
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        schema=COMPLIANCE_SCHEMA,
    )

    op.create_table(
        "tenant_domains",
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("domain_code", sa.String(length=80), primary_key=True, nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        schema=COMPLIANCE_SCHEMA,
    )

    op.create_table(
        "tenant_controls",
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("control_key", sa.String(length=120), primary_key=True, nullable=False),
        sa.Column("code", sa.String(length=60), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("domain_code", sa.String(length=80), nullable=False),
        sa.Column("criticality", sa.String(length=10), nullable=False),
        sa.Column("weight", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("evidence_expected", sa.Text(), nullable=False),
        sa.Column("default_status", sa.String(length=20), nullable=False, server_default="not_started"),
        sa.Column("default_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.UniqueConstraint("tenant_id", "code", name="uq_compliance_tenant_controls_code"),
        sa.CheckConstraint(
            "criticality in ('Low','Medium','High')",
            name="ck_compliance_tenant_controls_criticality",
        ),
        sa.CheckConstraint(
            "default_status in ('not_started','in_progress','partial','mostly','implemented','na')",
            name="ck_compliance_tenant_controls_default_status",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        schema=COMPLIANCE_SCHEMA,
    )

    op.create_table(
        "tenant_control_framework_refs",
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("control_key", sa.String(length=120), primary_key=True, nullable=False),
        sa.Column("framework_key", sa.String(length=80), primary_key=True, nullable=False),
        sa.Column("ref", sa.String(length=200), primary_key=True, nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        schema=COMPLIANCE_SCHEMA,
    )

    op.create_table(
        "tenant_library_profiles",
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("profile_key", sa.String(length=120), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        schema=COMPLIANCE_SCHEMA,
    )

    op.create_table(
        "tenant_profile_controls",
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("profile_key", sa.String(length=120), primary_key=True, nullable=False),
        sa.Column("control_key", sa.String(length=120), primary_key=True, nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        schema=COMPLIANCE_SCHEMA,
    )

    # control_status: add control_key and migrate primary key
    op.add_column("control_status", sa.Column("control_key", sa.String(length=120), nullable=True), schema=COMPLIANCE_SCHEMA)
    op.execute(
        """
        UPDATE compliance.control_status cs
        SET control_key = c.control_key
        FROM compliance.controls c
        WHERE cs.control_id = c.id
        """
    )
    op.alter_column("control_status", "control_key", nullable=False, schema=COMPLIANCE_SCHEMA)
    op.drop_constraint("fk_control_status_control_id_controls", "control_status", schema=COMPLIANCE_SCHEMA, type_="foreignkey")
    op.drop_constraint("pk_control_status", "control_status", schema=COMPLIANCE_SCHEMA, type_="primary")
    op.alter_column("control_status", "control_id", nullable=True, schema=COMPLIANCE_SCHEMA)
    op.create_primary_key(
        "pk_control_status", "control_status", ["tenant_id", "control_key"], schema=COMPLIANCE_SCHEMA
    )
    op.create_foreign_key(
        "fk_control_status_control_id_controls",
        "control_status",
        "controls",
        ["control_id"],
        ["id"],
        ondelete="SET NULL",
        source_schema=COMPLIANCE_SCHEMA,
        referent_schema=COMPLIANCE_SCHEMA,
    )
    op.create_index(
        "ix_compliance_control_status_tenant_control",
        "control_status",
        ["tenant_id", "control_key"],
        schema=COMPLIANCE_SCHEMA,
    )

    # evidence: add control_key and migrate
    op.add_column("evidence", sa.Column("control_key", sa.String(length=120), nullable=True), schema=COMPLIANCE_SCHEMA)
    op.execute(
        """
        UPDATE compliance.evidence e
        SET control_key = c.control_key
        FROM compliance.controls c
        WHERE e.control_id = c.id
        """
    )
    op.alter_column("evidence", "control_key", nullable=False, schema=COMPLIANCE_SCHEMA)
    op.drop_constraint("fk_evidence_control_id_controls", "evidence", schema=COMPLIANCE_SCHEMA, type_="foreignkey")
    op.alter_column("evidence", "control_id", nullable=True, schema=COMPLIANCE_SCHEMA)
    op.create_foreign_key(
        "fk_evidence_control_id_controls",
        "evidence",
        "controls",
        ["control_id"],
        ["id"],
        ondelete="SET NULL",
        source_schema=COMPLIANCE_SCHEMA,
        referent_schema=COMPLIANCE_SCHEMA,
    )
    op.drop_index(
        "ix_compliance_evidence_tenant_control_created",
        table_name="evidence",
        schema=COMPLIANCE_SCHEMA,
    )
    op.create_index(
        "ix_compliance_evidence_tenant_control_created",
        "evidence",
        ["tenant_id", "control_key", "created_at"],
        schema=COMPLIANCE_SCHEMA,
    )

    # tenant_profiles: migrate to profile_key
    op.add_column("tenant_profiles", sa.Column("profile_key", sa.String(length=120), nullable=True), schema=COMPLIANCE_SCHEMA)
    op.execute(
        """
        UPDATE compliance.tenant_profiles tp
        SET profile_key = p.profile_key
        FROM compliance.profiles p
        WHERE tp.profile_id = p.id
        """
    )
    op.alter_column("tenant_profiles", "profile_key", nullable=False, schema=COMPLIANCE_SCHEMA)
    op.drop_constraint("fk_tenant_profiles_profile_id_profiles", "tenant_profiles", schema=COMPLIANCE_SCHEMA, type_="foreignkey")
    op.drop_constraint("pk_tenant_profiles", "tenant_profiles", schema=COMPLIANCE_SCHEMA, type_="primary")
    op.drop_column("tenant_profiles", "profile_id", schema=COMPLIANCE_SCHEMA)
    op.create_primary_key(
        "pk_tenant_profiles", "tenant_profiles", ["tenant_id", "profile_key"], schema=COMPLIANCE_SCHEMA
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

    # revert tenant_profiles
    op.drop_constraint("pk_tenant_profiles", "tenant_profiles", schema=COMPLIANCE_SCHEMA, type_="primary")
    op.add_column(
        "tenant_profiles",
        sa.Column("profile_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema=COMPLIANCE_SCHEMA,
    )
    op.execute(
        """
        UPDATE compliance.tenant_profiles tp
        SET profile_id = p.id
        FROM compliance.profiles p
        WHERE tp.profile_key = p.profile_key
        """
    )
    op.alter_column("tenant_profiles", "profile_id", nullable=False, schema=COMPLIANCE_SCHEMA)
    op.create_primary_key(
        "pk_tenant_profiles", "tenant_profiles", ["tenant_id", "profile_id"], schema=COMPLIANCE_SCHEMA
    )
    op.create_foreign_key(
        "fk_tenant_profiles_profile_id_profiles",
        "tenant_profiles",
        "profiles",
        ["profile_id"],
        ["id"],
        ondelete="CASCADE",
        source_schema=COMPLIANCE_SCHEMA,
        referent_schema=COMPLIANCE_SCHEMA,
    )
    op.drop_column("tenant_profiles", "profile_key", schema=COMPLIANCE_SCHEMA)

    # evidence revert
    op.drop_index(
        "ix_compliance_evidence_tenant_control_created",
        table_name="evidence",
        schema=COMPLIANCE_SCHEMA,
    )
    op.create_index(
        "ix_compliance_evidence_tenant_control_created",
        "evidence",
        ["tenant_id", "control_id", "created_at"],
        schema=COMPLIANCE_SCHEMA,
    )
    op.drop_constraint("fk_evidence_control_id_controls", "evidence", schema=COMPLIANCE_SCHEMA, type_="foreignkey")
    op.alter_column("evidence", "control_id", nullable=False, schema=COMPLIANCE_SCHEMA)
    op.create_foreign_key(
        "fk_evidence_control_id_controls",
        "evidence",
        "controls",
        ["control_id"],
        ["id"],
        ondelete="CASCADE",
        source_schema=COMPLIANCE_SCHEMA,
        referent_schema=COMPLIANCE_SCHEMA,
    )
    op.drop_column("evidence", "control_key", schema=COMPLIANCE_SCHEMA)

    # control_status revert
    op.drop_index(
        "ix_compliance_control_status_tenant_control",
        table_name="control_status",
        schema=COMPLIANCE_SCHEMA,
    )
    op.drop_constraint("fk_control_status_control_id_controls", "control_status", schema=COMPLIANCE_SCHEMA, type_="foreignkey")
    op.drop_constraint("pk_control_status", "control_status", schema=COMPLIANCE_SCHEMA, type_="primary")
    op.alter_column("control_status", "control_id", nullable=False, schema=COMPLIANCE_SCHEMA)
    op.create_primary_key(
        "pk_control_status", "control_status", ["tenant_id", "control_id"], schema=COMPLIANCE_SCHEMA
    )
    op.create_foreign_key(
        "fk_control_status_control_id_controls",
        "control_status",
        "controls",
        ["control_id"],
        ["id"],
        ondelete="CASCADE",
        source_schema=COMPLIANCE_SCHEMA,
        referent_schema=COMPLIANCE_SCHEMA,
    )
    op.drop_column("control_status", "control_key", schema=COMPLIANCE_SCHEMA)

    op.drop_table("tenant_profile_controls", schema=COMPLIANCE_SCHEMA)
    op.drop_table("tenant_library_profiles", schema=COMPLIANCE_SCHEMA)
    op.drop_table("tenant_control_framework_refs", schema=COMPLIANCE_SCHEMA)
    op.drop_table("tenant_controls", schema=COMPLIANCE_SCHEMA)
    op.drop_table("tenant_domains", schema=COMPLIANCE_SCHEMA)
    op.drop_table("tenant_frameworks", schema=COMPLIANCE_SCHEMA)
    op.drop_index(
        "ix_compliance_tenant_library_batches_tenant",
        table_name="tenant_library_import_batches",
        schema=COMPLIANCE_SCHEMA,
    )
    op.drop_table("tenant_library_import_batches", schema=COMPLIANCE_SCHEMA)
