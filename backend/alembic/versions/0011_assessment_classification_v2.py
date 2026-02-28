"""assessment classification v2 (job items, cancel/apply metadata)

Revision ID: 0011_assessment_classification_v2
Revises: 0010_backfill_default_tenant_memberships
Create Date: 2026-02-28 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0011_assessment_classification_v2"
down_revision: str | None = "0010_backfill_default_tenant_memberships"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Extend jobs table with v2 fields (keep backward compatible defaults).
    op.add_column(
        "assessment_classification_jobs",
        sa.Column("mode", sa.String(length=40), nullable=False, server_default="unclassified_only"),
    )
    op.add_column(
        "assessment_classification_jobs",
        sa.Column("dry_run", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "assessment_classification_jobs",
        sa.Column("batch_size", sa.Integer(), nullable=False, server_default="25"),
    )
    op.add_column(
        "assessment_classification_jobs",
        sa.Column(
            "scope_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.add_column(
        "assessment_classification_jobs",
        sa.Column("cancel_requested", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "assessment_classification_jobs",
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "assessment_classification_jobs",
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "assessment_classification_jobs",
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "assessment_classification_jobs",
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "assessment_classification_jobs",
        sa.Column("rolled_back_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Add 'canceled' to status constraint.
    op.drop_constraint(
        "assessment_classification_job_status_values",
        "assessment_classification_jobs",
        type_="check",
    )
    op.create_check_constraint(
        "assessment_classification_job_status_values",
        "assessment_classification_jobs",
        "status in ('queued', 'running', 'completed', 'failed', 'canceled')",
    )

    op.create_table(
        "assessment_classification_job_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("question_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("old_category_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("old_difficulty", sa.String(length=20), nullable=True),
        sa.Column("new_category_name", sa.String(length=100), nullable=False),
        sa.Column("new_category_slug", sa.String(length=120), nullable=False),
        sa.Column("new_category_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("new_difficulty", sa.String(length=20), nullable=False),
        sa.Column("applied", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["job_id"], ["assessment_classification_jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "question_id"],
            ["assessment_questions.tenant_id", "assessment_questions.id"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("job_id", "question_id", name="uq_assessment_classify_job_item"),
    )
    op.create_index(
        "ix_assessment_classify_job_items_job",
        "assessment_classification_job_items",
        ["job_id"],
    )
    op.create_index(
        "ix_assessment_classify_job_items_tenant",
        "assessment_classification_job_items",
        ["tenant_id"],
    )
    op.create_index(
        "ix_assessment_classify_job_items_question",
        "assessment_classification_job_items",
        ["question_id"],
    )

    # Enable tenant RLS on the new items table.
    op.execute("ALTER TABLE assessment_classification_job_items ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation_assessment_classification_job_items
        ON assessment_classification_job_items
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP POLICY IF EXISTS tenant_isolation_assessment_classification_job_items ON assessment_classification_job_items"
    )
    op.execute("ALTER TABLE assessment_classification_job_items DISABLE ROW LEVEL SECURITY")

    op.drop_index("ix_assessment_classify_job_items_question", table_name="assessment_classification_job_items")
    op.drop_index("ix_assessment_classify_job_items_tenant", table_name="assessment_classification_job_items")
    op.drop_index("ix_assessment_classify_job_items_job", table_name="assessment_classification_job_items")
    op.drop_table("assessment_classification_job_items")

    op.drop_constraint(
        "assessment_classification_job_status_values",
        "assessment_classification_jobs",
        type_="check",
    )
    op.create_check_constraint(
        "assessment_classification_job_status_values",
        "assessment_classification_jobs",
        "status in ('queued', 'running', 'completed', 'failed')",
    )

    op.drop_column("assessment_classification_jobs", "rolled_back_at")
    op.drop_column("assessment_classification_jobs", "applied_at")
    op.drop_column("assessment_classification_jobs", "last_heartbeat_at")
    op.drop_column("assessment_classification_jobs", "completed_at")
    op.drop_column("assessment_classification_jobs", "started_at")
    op.drop_column("assessment_classification_jobs", "cancel_requested")
    op.drop_column("assessment_classification_jobs", "scope_json")
    op.drop_column("assessment_classification_jobs", "batch_size")
    op.drop_column("assessment_classification_jobs", "dry_run")
    op.drop_column("assessment_classification_jobs", "mode")
