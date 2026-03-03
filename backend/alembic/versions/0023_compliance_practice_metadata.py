"""compliance practice metadata fields

Revision ID: 0023_compliance_practice_metadata
Revises: 0022_compliance_vector_embeddings
Create Date: 2026-03-02
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0023_compliance_practice_metadata"
down_revision: str | Sequence[str] | None = "0022_compliance_vector_embeddings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


COMPLIANCE_SCHEMA = "compliance"


def upgrade() -> None:
    op.add_column("practice_items", sa.Column("category", sa.String(length=120), nullable=True), schema=COMPLIANCE_SCHEMA)
    op.add_column(
        "practice_items",
        sa.Column("status", sa.String(length=60), nullable=True),
        schema=COMPLIANCE_SCHEMA,
    )
    op.add_column(
        "practice_items",
        sa.Column("frequency", sa.String(length=60), nullable=True),
        schema=COMPLIANCE_SCHEMA,
    )
    op.add_column("practice_items", sa.Column("evidence", sa.Text(), nullable=True), schema=COMPLIANCE_SCHEMA)
    op.add_column(
        "practice_items",
        sa.Column(
            "frameworks",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        schema=COMPLIANCE_SCHEMA,
    )
    # Best-effort backfill: treat old tags as frameworks
    op.execute(
        """
        UPDATE compliance.practice_items
        SET frameworks = COALESCE(tags, '[]'::jsonb)
        WHERE frameworks = '[]'::jsonb OR frameworks IS NULL
        """
    )


def downgrade() -> None:
    op.drop_column("practice_items", "frameworks", schema=COMPLIANCE_SCHEMA)
    op.drop_column("practice_items", "evidence", schema=COMPLIANCE_SCHEMA)
    op.drop_column("practice_items", "frequency", schema=COMPLIANCE_SCHEMA)
    op.drop_column("practice_items", "status", schema=COMPLIANCE_SCHEMA)
    op.drop_column("practice_items", "category", schema=COMPLIANCE_SCHEMA)

