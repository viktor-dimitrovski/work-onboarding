"""add assessment categories

Revision ID: 0004_assessment_categories
Revises: 0003_assessments
Create Date: 2026-02-27 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0004_assessment_categories'
down_revision: str | None = '0003_assessments'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'assessment_categories',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('slug', sa.String(length=120), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('updated_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.UniqueConstraint('slug', name='uq_assessment_category_slug'),
    )
    op.create_index('ix_assessment_categories_slug', 'assessment_categories', ['slug'])

    op.add_column('assessment_questions', sa.Column('category_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index('ix_assessment_questions_category_id', 'assessment_questions', ['category_id'])
    op.create_foreign_key(
        'fk_assessment_questions_category_id',
        'assessment_questions',
        'assessment_categories',
        ['category_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_assessment_questions_category_id', 'assessment_questions', type_='foreignkey')
    op.drop_index('ix_assessment_questions_category_id', table_name='assessment_questions')
    op.drop_column('assessment_questions', 'category_id')
    op.drop_index('ix_assessment_categories_slug', table_name='assessment_categories')
    op.drop_table('assessment_categories')
