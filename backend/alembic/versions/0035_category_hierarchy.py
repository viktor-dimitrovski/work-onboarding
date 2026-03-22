"""assessment_categories hierarchy: add parent_id, deduplicate, organise tree

Revision ID: 0035_category_hierarchy
Revises: 0034_assessment_question_section
Create Date: 2026-03-08
"""

from alembic import op
import sqlalchemy as sa

revision = '0035_category_hierarchy'
down_revision = '0034_assessment_question_section'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. Add parent_id self-referential FK ─────────────────────────────────
    op.add_column(
        'assessment_categories',
        sa.Column('parent_id', sa.UUID(), sa.ForeignKey('assessment_categories.id', ondelete='SET NULL'), nullable=True),
    )
    op.create_index(
        'ix_assessment_categories_parent_id',
        'assessment_categories',
        ['parent_id'],
    )

    conn = op.get_bind()

    # ── 2. Deduplicate categories within the same tenant ─────────────────────
    # For any (tenant_id, slug) with multiple rows keep the oldest (smallest
    # created_at), re-point all question references, then delete the extras.
    conn.execute(sa.text("""
        UPDATE assessment_questions q
        SET    category_id = keep.id
        FROM (
            SELECT DISTINCT ON (tenant_id, slug)
                   id, tenant_id, slug
            FROM   assessment_categories
            ORDER  BY tenant_id, slug, created_at ASC
        ) keep
        JOIN assessment_categories dup
            ON  dup.tenant_id = keep.tenant_id
            AND dup.slug      = keep.slug
            AND dup.id       <> keep.id
        WHERE q.category_id = dup.id
    """))

    conn.execute(sa.text("""
        DELETE FROM assessment_categories a
        USING (
            SELECT DISTINCT ON (tenant_id, slug)
                   id AS keep_id, tenant_id, slug
            FROM   assessment_categories
            ORDER  BY tenant_id, slug, created_at ASC
        ) keep
        WHERE a.tenant_id = keep.tenant_id
          AND a.slug      = keep.slug
          AND a.id       <> keep.keep_id
    """))

    # ── 3. Insert parent (group) categories for every existing tenant ─────────
    # Groups:
    #   software-engineering   → code-review, code-safety, debugging,
    #                            design-patterns, development-practices,
    #                            performance, validation
    #   backend-architecture   → api-design, api-testing,
    #                            asynchronous-programming, concurrency,
    #                            database, dependency-injection,
    #                            distributed-systems, entity-framework,
    #                            middleware
    #   infrastructure-cloud   → containerization, kubernetes, scripting
    #   security-compliance    → ai-safety, security, open-banking,
    #                            payment-services-directive,
    #                            payment-transactions
    #   professional-development → career-development, document-updates

    hierarchy = {
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

    # Collect all distinct tenants that currently own at least one category
    rows = conn.execute(
        sa.text("SELECT DISTINCT tenant_id FROM assessment_categories")
    ).fetchall()

    for (tenant_id,) in rows:
        for parent_name, (parent_slug, child_slugs) in hierarchy.items():
            # Upsert the parent row (ignore if slug already exists for tenant)
            conn.execute(sa.text("""
                INSERT INTO assessment_categories
                       (id, tenant_id, name, slug, created_at, updated_at)
                VALUES (gen_random_uuid(), :tid, :name, :slug, now(), now())
                ON CONFLICT (tenant_id, slug) DO NOTHING
            """), {'tid': str(tenant_id), 'name': parent_name, 'slug': parent_slug})

            # Fetch the canonical parent id (might have existed already)
            parent_row = conn.execute(sa.text("""
                SELECT id FROM assessment_categories
                WHERE  tenant_id = :tid AND slug = :slug
            """), {'tid': str(tenant_id), 'slug': parent_slug}).fetchone()

            if parent_row is None:
                continue
            parent_id = str(parent_row[0])

            # Assign parent_id to children that belong to this tenant
            conn.execute(sa.text("""
                UPDATE assessment_categories
                SET    parent_id  = :parent_id,
                       updated_at = now()
                WHERE  tenant_id = :tid
                  AND  slug = ANY(:slugs)
                  AND  parent_id IS NULL
            """), {
                'parent_id': parent_id,
                'tid': str(tenant_id),
                'slugs': child_slugs,
            })


def downgrade() -> None:
    # Remove parent assignments, then the parent rows, then the column
    op.execute(sa.text("UPDATE assessment_categories SET parent_id = NULL"))
    op.execute(sa.text("""
        DELETE FROM assessment_categories
        WHERE slug IN (
            'software-engineering', 'backend-architecture',
            'infrastructure-cloud', 'security-compliance',
            'professional-development'
        )
    """))
    op.drop_index('ix_assessment_categories_parent_id', table_name='assessment_categories')
    op.drop_column('assessment_categories', 'parent_id')
