"""compliance optional vector embeddings table

Revision ID: 0022_compliance_vector_embeddings
Revises: 0021_compliance_clients
Create Date: 2026-03-02
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0022_compliance_vector_embeddings"
down_revision: str | Sequence[str] | None = "0021_compliance_clients"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


COMPLIANCE_SCHEMA = "compliance"


TENANT_TABLES = [
    f"{COMPLIANCE_SCHEMA}.control_embeddings",
]


def upgrade() -> None:
    op.create_table(
        "control_embeddings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("control_key", sa.String(length=120), nullable=False),
        sa.Column("model", sa.String(length=80), nullable=False),
        sa.Column("embedding_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "control_key", "model", name="uq_compliance_control_embeddings_unique"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        schema=COMPLIANCE_SCHEMA,
    )
    op.create_index(
        "ix_compliance_control_embeddings_control",
        "control_embeddings",
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
        "ix_compliance_control_embeddings_control",
        table_name="control_embeddings",
        schema=COMPLIANCE_SCHEMA,
    )
    op.drop_table("control_embeddings", schema=COMPLIANCE_SCHEMA)
