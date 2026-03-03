"""compliance client requirement coverage fields

Revision ID: 0027_compliance_client_requirement_coverage
Revises: 0026_compliance_semantic_match_runs
Create Date: 2026-03-03
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0027_compliance_client_requirement_coverage"
down_revision: str | Sequence[str] | None = "0026_compliance_semantic_match_runs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


COMPLIANCE_SCHEMA = "compliance"


def upgrade() -> None:
    op.add_column(
        "client_requirements",
        sa.Column("coverage_percent", sa.Float(), nullable=True),
        schema=COMPLIANCE_SCHEMA,
    )
    op.add_column(
        "client_requirements",
        sa.Column("coverage_updated_at", sa.DateTime(timezone=True), nullable=True),
        schema=COMPLIANCE_SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("client_requirements", "coverage_updated_at", schema=COMPLIANCE_SCHEMA)
    op.drop_column("client_requirements", "coverage_percent", schema=COMPLIANCE_SCHEMA)
