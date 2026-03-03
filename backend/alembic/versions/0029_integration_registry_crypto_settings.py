"""integration registry encryption settings + ciphertext columns

Revision ID: 0029_integration_registry_crypto_settings
Revises: 0028_integration_registry_schema
Create Date: 2026-03-03
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0029_integration_registry_crypto_settings"
down_revision: str | Sequence[str] | None = "0028_integration_registry_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


IR_SCHEMA = "integration_registry"


def upgrade() -> None:
    op.create_table(
        "ir_tenant_crypto",
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("kdf_salt", postgresql.BYTEA(), nullable=False),
        sa.Column("key_fingerprint", sa.String(length=128), nullable=False),
        sa.Column(
            "kdf_params_json",
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
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        schema=IR_SCHEMA,
    )

    # Ciphertext-friendly column sizes (Text).
    op.alter_column(
        "ir_endpoint",
        "fqdn",
        existing_type=sa.String(length=500),
        type_=sa.Text(),
        schema=IR_SCHEMA,
    )
    op.alter_column(
        "ir_endpoint",
        "ip",
        existing_type=sa.String(length=100),
        type_=sa.Text(),
        schema=IR_SCHEMA,
    )
    op.alter_column(
        "ir_endpoint",
        "base_path",
        existing_type=sa.String(length=500),
        type_=sa.Text(),
        schema=IR_SCHEMA,
    )
    op.alter_column(
        "ir_instance",
        "vault_ref",
        existing_type=sa.String(length=500),
        type_=sa.Text(),
        schema=IR_SCHEMA,
    )
    op.alter_column(
        "ir_instance",
        "contact",
        existing_type=sa.String(length=200),
        type_=sa.Text(),
        schema=IR_SCHEMA,
    )
    op.alter_column(
        "ir_route_hop",
        "label",
        existing_type=sa.String(length=200),
        type_=sa.Text(),
        schema=IR_SCHEMA,
    )
    op.alter_column(
        "ir_route_hop",
        "proxy_chain",
        existing_type=sa.String(length=500),
        type_=sa.Text(),
        schema=IR_SCHEMA,
    )

    # Remove trigram index (encrypted values are not searchable).
    op.execute(f"DROP INDEX IF EXISTS {IR_SCHEMA}.ix_ir_endpoint_fqdn_trgm")

    # RLS policy for tenant crypto settings.
    policy = f"tenant_isolation_{IR_SCHEMA}.ir_tenant_crypto".replace(".", "_")
    op.execute(f"ALTER TABLE {IR_SCHEMA}.ir_tenant_crypto ENABLE ROW LEVEL SECURITY")
    op.execute(
        f"""
        CREATE POLICY {policy}
        ON {IR_SCHEMA}.ir_tenant_crypto
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
        """
    )


def downgrade() -> None:
    policy = f"tenant_isolation_{IR_SCHEMA}.ir_tenant_crypto".replace(".", "_")
    op.execute(f"DROP POLICY IF EXISTS {policy} ON {IR_SCHEMA}.ir_tenant_crypto")
    op.execute(f"ALTER TABLE {IR_SCHEMA}.ir_tenant_crypto DISABLE ROW LEVEL SECURITY")
    op.drop_table("ir_tenant_crypto", schema=IR_SCHEMA)

    # Recreate trigram index if possible (best-effort).
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

    # Revert columns to original lengths.
    op.alter_column(
        "ir_endpoint",
        "fqdn",
        existing_type=sa.Text(),
        type_=sa.String(length=500),
        schema=IR_SCHEMA,
    )
    op.alter_column(
        "ir_endpoint",
        "ip",
        existing_type=sa.Text(),
        type_=sa.String(length=100),
        schema=IR_SCHEMA,
    )
    op.alter_column(
        "ir_endpoint",
        "base_path",
        existing_type=sa.Text(),
        type_=sa.String(length=500),
        schema=IR_SCHEMA,
    )
    op.alter_column(
        "ir_instance",
        "vault_ref",
        existing_type=sa.Text(),
        type_=sa.String(length=500),
        schema=IR_SCHEMA,
    )
    op.alter_column(
        "ir_instance",
        "contact",
        existing_type=sa.Text(),
        type_=sa.String(length=200),
        schema=IR_SCHEMA,
    )
    op.alter_column(
        "ir_route_hop",
        "label",
        existing_type=sa.Text(),
        type_=sa.String(length=200),
        schema=IR_SCHEMA,
    )
    op.alter_column(
        "ir_route_hop",
        "proxy_chain",
        existing_type=sa.Text(),
        type_=sa.String(length=500),
        schema=IR_SCHEMA,
    )
