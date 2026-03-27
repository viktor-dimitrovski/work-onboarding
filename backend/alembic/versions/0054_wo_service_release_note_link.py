"""Add release_note_id FK to work_order_services for WO ↔ Release Notes linking.

Revision ID: 0054_wo_service_release_note_link
Revises: 0053_platform_release_calendar
Create Date: 2026-03-27
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0054_wo_service_release_note_link"
down_revision: str | Sequence[str] | None = "0053_platform_release_calendar"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "work_order_services",
        sa.Column("release_note_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="release_mgmt",
    )
    op.create_foreign_key(
        "fk_release_mgmt_wo_services_release_note",
        "work_order_services",
        "release_notes",
        ["release_note_id"],
        ["id"],
        source_schema="release_mgmt",
        referent_schema="release_mgmt",
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_release_mgmt_wo_services_release_note",
        "work_order_services",
        ["release_note_id"],
        schema="release_mgmt",
    )


def downgrade() -> None:
    op.drop_index("ix_release_mgmt_wo_services_release_note", table_name="work_order_services", schema="release_mgmt")
    op.drop_constraint(
        "fk_release_mgmt_wo_services_release_note",
        "work_order_services",
        schema="release_mgmt",
        type_="foreignkey",
    )
    op.drop_column("work_order_services", "release_note_id", schema="release_mgmt")
