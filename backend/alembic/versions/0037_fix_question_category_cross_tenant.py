"""Fix questions that were classified with categories from the wrong tenant.

The AI classification service ran before the per-tenant category hierarchy was
corrected, so some questions in tenant T have a category_id that belongs to a
different tenant (typically the phantom seeding tenant ada410ae-…).

This migration reassigns each such question's category_id to the matching
category (same slug) that belongs to the question's own tenant.  Questions
whose misassigned category has no slug-equivalent in their tenant are left
untouched (category_id stays; if it later causes a FK violation it can be
NULLed separately).

Revision ID: 0037
Revises: 0036
"""

from alembic import op
import sqlalchemy as sa

revision = '0037_fix_question_category_cross_tenant'
down_revision = '0036_fix_category_hierarchy_tenant'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        UPDATE assessment_questions
        SET    category_id = correct.id,
               updated_at  = now()
        FROM   assessment_categories wrong
        JOIN   assessment_categories correct
               ON  correct.slug = wrong.slug
               AND correct.id  <> wrong.id
        WHERE  assessment_questions.category_id = wrong.id
          AND  wrong.tenant_id  <> assessment_questions.tenant_id
          AND  correct.tenant_id = assessment_questions.tenant_id
    """))


def downgrade() -> None:
    # Re-running upgrade again is a no-op (idempotent); a true reverse would
    # require knowing the original mapping which is not stored.
    pass
