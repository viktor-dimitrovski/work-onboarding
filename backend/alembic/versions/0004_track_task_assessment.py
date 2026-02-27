"""add assessment_test task type

Revision ID: 0004_track_task_assessment
Revises: 0003_assessments
Create Date: 2026-02-25 00:40:00.000000
"""

from collections.abc import Sequence

from alembic import op


revision: str = '0004_track_task_assessment'
down_revision: str | None = '0003_assessments'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint('track_task_type_values', 'track_tasks', type_='check')
    op.create_check_constraint(
        'track_task_type_values',
        'track_tasks',
        "task_type in ('read_material', 'video', 'checklist', 'quiz', 'code_assignment', 'external_link', 'mentor_approval', 'file_upload', 'assessment_test')",
    )


def downgrade() -> None:
    op.drop_constraint('track_task_type_values', 'track_tasks', type_='check')
    op.create_check_constraint(
        'track_task_type_values',
        'track_tasks',
        "task_type in ('read_material', 'video', 'checklist', 'quiz', 'code_assignment', 'external_link', 'mentor_approval', 'file_upload')",
    )
