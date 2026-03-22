"""Add composite indexes for list_questions performance.

Existing single-column indexes cover individual predicates but PostgreSQL
cannot combine them efficiently when multiple columns are tested together.
These composite indexes let the planner satisfy the most common access
patterns in a single index scan:

  1. (tenant_id, status) on assessment_questions
     — covers every filtered list query (tenant scoped + status filter).

  2. (tenant_id, status, category_id) on assessment_questions
     — extends #1 for category-filtered queries; allows an index-only plan
       for the correlated-subquery IN check.

  3. (tenant_id, slug) on assessment_categories
     — the UNIQUE constraint uq_assessment_category_slug already provides
       this index implicitly; we skip creating a duplicate.

  4. (tenant_id, question_id, order_index) on assessment_question_options
     — selectinload fires "WHERE question_id IN (...)" per page; this index
       lets PostgreSQL satisfy that scan with one index seek per question
       and returns options already sorted by order_index.

Revision ID: 0038_question_perf_indexes
Revises: 0037_fix_question_category_cross_tenant
"""

from alembic import op

revision = '0038_question_perf_indexes'
down_revision = '0037_fix_question_category_cross_tenant'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # (tenant_id, status) — basic tenant-scoped status filter
    op.create_index(
        'ix_assessment_questions_tenant_status',
        'assessment_questions',
        ['tenant_id', 'status'],
        if_not_exists=True,
    )

    # (tenant_id, status, category_id) — category-filtered list queries
    op.create_index(
        'ix_assessment_questions_tenant_status_category',
        'assessment_questions',
        ['tenant_id', 'status', 'category_id'],
        if_not_exists=True,
    )

    # (tenant_id, question_id, order_index) — selectinload batch fetch, sorted
    op.create_index(
        'ix_assessment_question_options_tenant_question_order',
        'assessment_question_options',
        ['tenant_id', 'question_id', 'order_index'],
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index(
        'ix_assessment_question_options_tenant_question_order',
        table_name='assessment_question_options',
        if_exists=True,
    )
    op.drop_index(
        'ix_assessment_questions_tenant_status_category',
        table_name='assessment_questions',
        if_exists=True,
    )
    op.drop_index(
        'ix_assessment_questions_tenant_status',
        table_name='assessment_questions',
        if_exists=True,
    )
