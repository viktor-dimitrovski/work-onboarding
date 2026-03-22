"""Fix category hierarchy for real tenants — create missing parent groups and assign children.

The previous migration (0035) accidentally created the 5 parent-group categories
only for a seeding/phantom tenant (ada410ae-…) instead of every real tenant
that owns actual leaf categories.  Real tenants ended up with leaf categories
whose parent_id points to a parent that belongs to a different tenant, which
causes FK violations when merging or deleting.

This migration:
  1. Inserts the 5 parent-group categories for every tenant that has at least one
     of the expected leaf slugs but is MISSING the corresponding parent slug.
  2. Sets parent_id on the leaf categories, scoped strictly to the same tenant.

Revision ID: 0036_fix_category_hierarchy_tenant
Revises: 0035_category_hierarchy
Create Date: 2026-03-16
"""

from alembic import op
import sqlalchemy as sa

revision = '0036_fix_category_hierarchy_tenant'
down_revision = '0035_category_hierarchy'
branch_labels = None
depends_on = None

HIERARCHY = {
    'Software Engineering': (
        'software-engineering',
        ['code-review', 'code-safety', 'debugging', 'design-patterns',
         'development-practices', 'performance', 'validation'],
    ),
    'Backend & Architecture': (
        'backend-architecture',
        ['api-design', 'api-testing', 'asynchronous-programming',
         'concurrency', 'database', 'dependency-injection',
         'distributed-systems', 'entity-framework', 'middleware'],
    ),
    'Infrastructure & Cloud': (
        'infrastructure-cloud',
        ['containerization', 'kubernetes', 'scripting'],
    ),
    'Security & Compliance': (
        'security-compliance',
        ['ai-safety', 'security', 'open-banking',
         'payment-services-directive', 'payment-transactions'],
    ),
    'Professional Development': (
        'professional-development',
        ['career-development', 'document-updates'],
    ),
}


def upgrade() -> None:
    conn = op.get_bind()

    # Find every tenant that owns at least one leaf category but does NOT yet
    # have a parent category with the canonical parent slug.
    # We iterate over each group and fix any tenant that is missing the parent.

    for parent_name, (parent_slug, child_slugs) in HIERARCHY.items():
        # Tenants that own at least one of the expected children
        tenant_rows = conn.execute(sa.text("""
            SELECT DISTINCT tenant_id
            FROM   assessment_categories
            WHERE  slug = ANY(:slugs)
        """), {'slugs': child_slugs}).fetchall()

        for (tenant_id,) in tenant_rows:
            tid = str(tenant_id)

            # Upsert the parent for this tenant (no-op if it already exists
            # with the correct tenant_id).
            conn.execute(sa.text("""
                INSERT INTO assessment_categories
                       (id, tenant_id, name, slug, created_at, updated_at)
                VALUES (gen_random_uuid(), :tid, :name, :slug, now(), now())
                ON CONFLICT (tenant_id, slug) DO NOTHING
            """), {'tid': tid, 'name': parent_name, 'slug': parent_slug})

            # Fetch the canonical parent id for THIS tenant
            parent_row = conn.execute(sa.text("""
                SELECT id FROM assessment_categories
                WHERE  tenant_id = :tid AND slug = :slug
            """), {'tid': tid, 'slug': parent_slug}).fetchone()

            if parent_row is None:
                continue
            parent_id = str(parent_row[0])

            # Assign parent_id to leaf categories that:
            #   a) belong to the same tenant
            #   b) match one of the expected child slugs
            #   c) currently have no parent  -OR-  have a parent that belongs
            #      to a DIFFERENT tenant (cross-tenant parent from 0035 bug)
            conn.execute(sa.text("""
                UPDATE assessment_categories
                SET    parent_id  = :parent_id,
                       updated_at = now()
                WHERE  tenant_id = :tid
                  AND  slug = ANY(:slugs)
                  AND  (
                           parent_id IS NULL
                        OR parent_id NOT IN (
                               SELECT id FROM assessment_categories
                               WHERE  tenant_id = :tid
                           )
                       )
            """), {
                'parent_id': parent_id,
                'tid': tid,
                'slugs': child_slugs,
            })


def downgrade() -> None:
    # Remove parent assignments added by this migration, then delete the
    # parent rows that were inserted.
    op.execute(sa.text("""
        UPDATE assessment_categories
        SET parent_id = NULL
        WHERE slug IN (
            'code-review','code-safety','debugging','design-patterns',
            'development-practices','performance','validation',
            'api-design','api-testing','asynchronous-programming',
            'concurrency','database','dependency-injection',
            'distributed-systems','entity-framework','middleware',
            'containerization','kubernetes','scripting',
            'ai-safety','security','open-banking',
            'payment-services-directive','payment-transactions',
            'career-development','document-updates'
        )
    """))
    op.execute(sa.text("""
        DELETE FROM assessment_categories
        WHERE slug IN (
            'software-engineering','backend-architecture',
            'infrastructure-cloud','security-compliance',
            'professional-development'
        )
    """))
