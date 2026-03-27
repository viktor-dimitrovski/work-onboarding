"""Add release_notes, release_note_items, release_note_authors tables.

Revision ID: 0048_release_notes_module
Revises: 0047_data_centers_and_branch
Create Date: 2026-03-25
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0048_release_notes_module"
down_revision: str | Sequence[str] | None = "0047_data_centers_and_branch"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TENANT_TABLES = [
    "release_mgmt.release_notes",
    # release_note_items has no tenant_id column — it is protected through its FK to release_notes
]


def upgrade() -> None:
    op.create_table(
        "release_notes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("repo", sa.String(length=200), nullable=False),
        sa.Column("branch", sa.String(length=120), nullable=True),
        sa.Column("service_name", sa.String(length=200), nullable=False),
        sa.Column("component_type", sa.String(length=20), nullable=False, server_default="service"),
        sa.Column("tag", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
        sa.Column("approved_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("tenant_id", "repo", "branch", "tag", name="uq_release_mgmt_release_notes_version"),
        sa.CheckConstraint(
            "status in ('draft','published','approved')",
            name="ck_release_mgmt_release_notes_status",
        ),
        sa.CheckConstraint(
            "component_type in ('service','config')",
            name="ck_release_mgmt_release_notes_component_type",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["approved_by"], ["users.id"], ondelete="SET NULL"),
        schema="release_mgmt",
    )
    op.create_index("ix_release_mgmt_release_notes_tenant", "release_notes", ["tenant_id"], schema="release_mgmt")
    op.create_index("ix_release_mgmt_release_notes_repo", "release_notes", ["repo"], schema="release_mgmt")
    op.create_index("ix_release_mgmt_release_notes_status", "release_notes", ["status"], schema="release_mgmt")

    op.create_table(
        "release_note_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("release_note_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("item_type", sa.String(length=30), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("migration_step", sa.Text(), nullable=True),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "item_type in ('feature','bug_fix','security','api_change','breaking_change','config_change')",
            name="ck_release_mgmt_release_note_items_type",
        ),
        sa.ForeignKeyConstraint(
            ["release_note_id"],
            ["release_mgmt.release_notes.id"],
            ondelete="CASCADE",
        ),
        schema="release_mgmt",
    )
    op.create_index(
        "ix_release_mgmt_release_note_items_note",
        "release_note_items",
        ["release_note_id"],
        schema="release_mgmt",
    )

    # Junction table for co-authors (not RLS-protected itself; inherits via release_note_id)
    op.create_table(
        "release_note_authors",
        sa.Column("release_note_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("added_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("release_note_id", "user_id"),
        sa.ForeignKeyConstraint(
            ["release_note_id"],
            ["release_mgmt.release_notes.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        schema="release_mgmt",
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
    for table in ["release_mgmt.release_notes"]:
        policy = f"tenant_isolation_{table.replace('.', '_')}"
        op.execute(f"DROP POLICY IF EXISTS {policy} ON {table}")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.drop_table("release_note_authors", schema="release_mgmt")
    op.drop_index("ix_release_mgmt_release_note_items_note", table_name="release_note_items", schema="release_mgmt")
    op.drop_table("release_note_items", schema="release_mgmt")
    op.drop_index("ix_release_mgmt_release_notes_status", table_name="release_notes", schema="release_mgmt")
    op.drop_index("ix_release_mgmt_release_notes_repo", table_name="release_notes", schema="release_mgmt")
    op.drop_index("ix_release_mgmt_release_notes_tenant", table_name="release_notes", schema="release_mgmt")
    op.drop_table("release_notes", schema="release_mgmt")
