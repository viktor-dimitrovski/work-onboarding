"""Fix category slug uniqueness: scope to (tenant_id, slug, parent_id).

Previously the constraint was (tenant_id, slug) which prevents creating the
same sub-category name under two different parents (e.g. "8th Grade" under
both "History" and "Biology").  Replace it with two partial unique indexes
that enforce uniqueness per (tenant, slug) within the same parent level.

Revision ID: 0046_category_slug_unique_per_parent
Revises: 0045_ai_import_templates
Create Date: 2026-03-08
"""

from __future__ import annotations

from alembic import op

revision = '0046_category_slug_unique_per_parent'
down_revision = '0045_ai_import_templates'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the old tenant-wide slug uniqueness constraint.
    op.drop_constraint('uq_assessment_category_slug', 'assessment_categories', type_='unique')

    # Root categories: slug must be unique per tenant where parent_id IS NULL.
    op.execute("""
        CREATE UNIQUE INDEX uq_category_slug_root
        ON assessment_categories (tenant_id, slug)
        WHERE parent_id IS NULL
    """)

    # Child categories: slug must be unique per (tenant, parent).
    op.execute("""
        CREATE UNIQUE INDEX uq_category_slug_child
        ON assessment_categories (tenant_id, slug, parent_id)
        WHERE parent_id IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_category_slug_root")
    op.execute("DROP INDEX IF EXISTS uq_category_slug_child")

    op.create_unique_constraint(
        'uq_assessment_category_slug',
        'assessment_categories',
        ['tenant_id', 'slug'],
    )
