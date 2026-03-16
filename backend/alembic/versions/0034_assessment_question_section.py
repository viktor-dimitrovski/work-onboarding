"""assessment question section grouping

Revision ID: 0034_assessment_question_section
Revises: 0033_add_task_types
Create Date: 2026-03-08
"""

from alembic import op
import sqlalchemy as sa

revision = '0034_assessment_question_section'
down_revision = '0033_add_task_types'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'assessment_test_version_questions',
        sa.Column('section', sa.String(100), nullable=True),
    )
    op.add_column(
        'assessment_attempts',
        sa.Column('section_scores', sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('assessment_attempts', 'section_scores')
    op.drop_column('assessment_test_version_questions', 'section')
