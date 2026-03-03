"""integration registry schema — services, instances, endpoints, routes, audit, dictionaries

Revision ID: 0028_integration_registry_schema
Revises: 0027_compliance_client_requirement_coverage
Create Date: 2026-03-03
"""

from collections.abc import Sequence
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0028_integration_registry_schema"
down_revision: str | Sequence[str] | None = "0027_compliance_client_requirement_coverage"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


IR_SCHEMA = "integration_registry"

TENANT_TABLES = [
    f"{IR_SCHEMA}.ir_service",
    f"{IR_SCHEMA}.ir_instance",
    f"{IR_SCHEMA}.ir_endpoint",
    f"{IR_SCHEMA}.ir_route_hop",
    f"{IR_SCHEMA}.ir_audit_log",
]


def upgrade() -> None:
    op.execute(f"CREATE SCHEMA IF NOT EXISTS {IR_SCHEMA}")

    # -------------------------------------------------------------------------
    # ir_dictionary — global or tenant-scoped code list definitions
    # -------------------------------------------------------------------------
    op.create_table(
        "ir_dictionary",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("is_addable", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_global", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("key", "tenant_id", name="uq_ir_dictionary_key_tenant"),
        schema=IR_SCHEMA,
    )

    # -------------------------------------------------------------------------
    # ir_dictionary_item — entries within a dictionary
    # -------------------------------------------------------------------------
    op.create_table(
        "ir_dictionary_item",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "dictionary_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey(f"{IR_SCHEMA}.ir_dictionary.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("code", sa.String(length=80), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "meta_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.UniqueConstraint("dictionary_id", "code", name="uq_ir_dictionary_item_dict_code"),
        schema=IR_SCHEMA,
    )
    op.create_index(
        "ix_ir_dictionary_item_dictionary_id",
        "ir_dictionary_item",
        ["dictionary_id"],
        schema=IR_SCHEMA,
    )

    # -------------------------------------------------------------------------
    # ir_service — logical service catalog entry (tenant-scoped)
    # -------------------------------------------------------------------------
    op.create_table(
        "ir_service",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            index=True,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("service_type", sa.String(length=80), nullable=True),
        sa.Column("owner_team", sa.String(length=120), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=False, server_default=sa.text("'active'")),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        schema=IR_SCHEMA,
    )
    op.create_index(
        "ix_ir_service_tenant_name",
        "ir_service",
        ["tenant_id", "name"],
        schema=IR_SCHEMA,
    )

    # -------------------------------------------------------------------------
    # ir_instance — one deployment per service+env+DC
    # -------------------------------------------------------------------------
    op.create_table(
        "ir_instance",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            index=True,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column(
            "service_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey(f"{IR_SCHEMA}.ir_service.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("env", sa.String(length=20), nullable=False),
        sa.Column("datacenter", sa.String(length=80), nullable=True),
        sa.Column("network_zone", sa.String(length=80), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=False, server_default=sa.text("'draft'")),
        sa.Column("contact", sa.String(length=200), nullable=True),
        sa.Column("vault_ref", sa.String(length=500), nullable=True),
        sa.Column(
            "type_settings_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        schema=IR_SCHEMA,
    )
    op.create_index(
        "ix_ir_instance_tenant_env_service",
        "ir_instance",
        ["tenant_id", "env", "service_id"],
        schema=IR_SCHEMA,
    )
    op.create_index(
        "ix_ir_instance_tenant_status",
        "ir_instance",
        ["tenant_id", "status"],
        schema=IR_SCHEMA,
    )

    # -------------------------------------------------------------------------
    # ir_endpoint — FQDN/IP/port entries per instance (1..N)
    # -------------------------------------------------------------------------
    op.create_table(
        "ir_endpoint",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "instance_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey(f"{IR_SCHEMA}.ir_instance.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            index=True,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("fqdn", sa.String(length=500), nullable=True),
        sa.Column("ip", sa.String(length=100), nullable=True),
        sa.Column("port", sa.Integer(), nullable=True),
        sa.Column("protocol", sa.String(length=20), nullable=False, server_default=sa.text("'HTTPS'")),
        sa.Column("base_path", sa.String(length=500), nullable=True),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema=IR_SCHEMA,
    )
    op.create_index(
        "ix_ir_endpoint_instance_id",
        "ir_endpoint",
        ["instance_id"],
        schema=IR_SCHEMA,
    )
    # GIN trigram index for substring search on fqdn (requires pg_trgm).
    # If the DB user cannot create extensions (common in hosted Postgres),
    # we skip this index rather than failing the entire migration.
    try:
        op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    except Exception:
        pass

    try:
        op.execute(
            f"CREATE INDEX ix_ir_endpoint_fqdn_trgm ON {IR_SCHEMA}.ir_endpoint "
            "USING gin (fqdn gin_trgm_ops) "
            "WHERE fqdn IS NOT NULL"
        )
    except Exception:
        pass

    # -------------------------------------------------------------------------
    # ir_route_hop — proxy chain hops per instance (0..N)
    # -------------------------------------------------------------------------
    op.create_table(
        "ir_route_hop",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "instance_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey(f"{IR_SCHEMA}.ir_instance.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            index=True,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("direction", sa.String(length=20), nullable=False, server_default=sa.text("'outbound'")),
        sa.Column("hop_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("label", sa.String(length=200), nullable=True),
        sa.Column("proxy_chain", sa.String(length=500), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema=IR_SCHEMA,
    )
    op.create_index(
        "ix_ir_route_hop_instance_id",
        "ir_route_hop",
        ["instance_id"],
        schema=IR_SCHEMA,
    )

    # -------------------------------------------------------------------------
    # ir_audit_log — immutable snapshot version log
    # -------------------------------------------------------------------------
    op.create_table(
        "ir_audit_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            index=True,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("entity_type", sa.String(length=80), nullable=False),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("action", sa.String(length=40), nullable=False),
        sa.Column("changed_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "changed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("change_reason", sa.Text(), nullable=False),
        sa.Column(
            "snapshot_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        schema=IR_SCHEMA,
    )
    op.create_index(
        "ix_ir_audit_log_tenant_entity",
        "ir_audit_log",
        ["tenant_id", "entity_type", "entity_id"],
        schema=IR_SCHEMA,
    )
    op.create_index(
        "ix_ir_audit_log_changed_at",
        "ir_audit_log",
        ["tenant_id", "changed_at"],
        schema=IR_SCHEMA,
    )

    # -------------------------------------------------------------------------
    # ir_user_grid_prefs — column picker preferences per user+tenant+grid_key
    # -------------------------------------------------------------------------
    op.create_table(
        "ir_user_grid_prefs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("grid_key", sa.String(length=80), nullable=False),
        sa.Column(
            "visible_columns_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "order_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "user_id", "tenant_id", "grid_key",
            name="uq_ir_user_grid_prefs_user_tenant_grid",
        ),
        schema=IR_SCHEMA,
    )

    # -------------------------------------------------------------------------
    # RLS policies for all tenant-scoped tables
    # -------------------------------------------------------------------------
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

    # -------------------------------------------------------------------------
    # Seed global dictionaries
    # -------------------------------------------------------------------------
    _seed_global_dictionaries()


def _seed_global_dictionaries() -> None:
    dict_table = f"{IR_SCHEMA}.ir_dictionary"
    item_table = f"{IR_SCHEMA}.ir_dictionary_item"

    global_dicts = [
        {
            "id": str(uuid.uuid4()),
            "key": "environment",
            "name": "Environments",
            "is_addable": False,
            "is_global": True,
            "items": [
                {"code": "UAT", "label": "UAT", "sort_order": 0},
                {"code": "PROD", "label": "PROD", "sort_order": 1},
            ],
        },
        {
            "id": str(uuid.uuid4()),
            "key": "service_type",
            "name": "Service Types",
            "is_addable": False,
            "is_global": True,
            "items": [
                {"code": "HTTP_API", "label": "HTTP API", "sort_order": 0},
                {"code": "DATABASE", "label": "Database", "sort_order": 1},
                {"code": "MESSAGE_BROKER", "label": "Message Broker", "sort_order": 2},
                {"code": "GRPC", "label": "gRPC", "sort_order": 3},
                {"code": "SFTP", "label": "SFTP", "sort_order": 4},
            ],
        },
        {
            "id": str(uuid.uuid4()),
            "key": "network_zone",
            "name": "Network Zones",
            "is_addable": False,
            "is_global": True,
            "items": [
                {"code": "PRIVATE", "label": "Private", "sort_order": 0},
                {"code": "PUBLIC", "label": "Public", "sort_order": 1},
                {"code": "HYBRID", "label": "Hybrid", "sort_order": 2},
            ],
        },
        {
            "id": str(uuid.uuid4()),
            "key": "datacenter",
            "name": "Data Centers",
            "is_addable": True,
            "is_global": True,
            "items": [
                {"code": "MK-DC1", "label": "MK-DC1", "sort_order": 0},
                {"code": "RO-DC1", "label": "RO-DC1", "sort_order": 1},
                {"code": "EU-WEST", "label": "EU-WEST", "sort_order": 2},
            ],
        },
        {
            "id": str(uuid.uuid4()),
            "key": "owner_team",
            "name": "Owner Teams",
            "is_addable": True,
            "is_global": True,
            "items": [],
        },
        {
            "id": str(uuid.uuid4()),
            "key": "auth_method",
            "name": "Auth Methods",
            "is_addable": True,
            "is_global": True,
            "items": [
                {"code": "NONE", "label": "None", "sort_order": 0},
                {"code": "BASIC", "label": "Basic Auth", "sort_order": 1},
                {"code": "BEARER", "label": "Bearer Token", "sort_order": 2},
                {"code": "OAUTH2", "label": "OAuth2", "sort_order": 3},
                {"code": "MTLS", "label": "mTLS", "sort_order": 4},
                {"code": "API_KEY", "label": "API Key", "sort_order": 5},
            ],
        },
        {
            "id": str(uuid.uuid4()),
            "key": "connection_status",
            "name": "Connection Statuses",
            "is_addable": False,
            "is_global": True,
            "items": [
                {"code": "draft", "label": "Draft", "sort_order": 0},
                {"code": "active", "label": "Active", "sort_order": 1},
                {"code": "disabled", "label": "Disabled", "sort_order": 2},
                {"code": "deprecated", "label": "Deprecated", "sort_order": 3},
            ],
        },
    ]

    conn = op.get_bind()

    for d in global_dicts:
        d_id = d["id"]
        conn.execute(
            sa.text(
                f"INSERT INTO {dict_table} (id, key, name, is_addable, is_global, tenant_id)"
                " VALUES (:id, :key, :name, :is_addable, :is_global, NULL)"
                " ON CONFLICT DO NOTHING"
            ),
            {
                "id": d_id,
                "key": d["key"],
                "name": d["name"],
                "is_addable": d["is_addable"],
                "is_global": d["is_global"],
            },
        )
        for item in d.get("items", []):
            conn.execute(
                sa.text(
                    f"INSERT INTO {item_table} (id, dictionary_id, code, label, is_active, sort_order)"
                    " VALUES (:id, :dictionary_id, :code, :label, true, :sort_order)"
                    " ON CONFLICT DO NOTHING"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "dictionary_id": d_id,
                    "code": item["code"],
                    "label": item["label"],
                    "sort_order": item["sort_order"],
                },
            )


def downgrade() -> None:
    for table in TENANT_TABLES:
        policy = f"tenant_isolation_{table.replace('.', '_')}"
        op.execute(f"DROP POLICY IF EXISTS {policy} ON {table}")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.drop_index("ix_ir_audit_log_changed_at", table_name="ir_audit_log", schema=IR_SCHEMA)
    op.drop_index("ix_ir_audit_log_tenant_entity", table_name="ir_audit_log", schema=IR_SCHEMA)
    op.drop_table("ir_audit_log", schema=IR_SCHEMA)

    op.drop_table("ir_user_grid_prefs", schema=IR_SCHEMA)

    op.drop_index("ix_ir_route_hop_instance_id", table_name="ir_route_hop", schema=IR_SCHEMA)
    op.drop_table("ir_route_hop", schema=IR_SCHEMA)

    op.execute(f"DROP INDEX IF EXISTS {IR_SCHEMA}.ix_ir_endpoint_fqdn_trgm")
    op.drop_index("ix_ir_endpoint_instance_id", table_name="ir_endpoint", schema=IR_SCHEMA)
    op.drop_table("ir_endpoint", schema=IR_SCHEMA)

    op.drop_index("ix_ir_instance_tenant_status", table_name="ir_instance", schema=IR_SCHEMA)
    op.drop_index("ix_ir_instance_tenant_env_service", table_name="ir_instance", schema=IR_SCHEMA)
    op.drop_table("ir_instance", schema=IR_SCHEMA)

    op.drop_index("ix_ir_service_tenant_name", table_name="ir_service", schema=IR_SCHEMA)
    op.drop_table("ir_service", schema=IR_SCHEMA)

    op.drop_index("ix_ir_dictionary_item_dictionary_id", table_name="ir_dictionary_item", schema=IR_SCHEMA)
    op.drop_table("ir_dictionary_item", schema=IR_SCHEMA)
    op.drop_table("ir_dictionary", schema=IR_SCHEMA)

    op.execute(f"DROP SCHEMA IF EXISTS {IR_SCHEMA} CASCADE")
