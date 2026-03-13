"""add task types: training, presentation, discussion, diagram, procedure

Revision ID: 0033_add_task_types
Revises: 0032_replace_supervisor
Create Date: 2026-03-08
"""
from alembic import op

revision = '0033_add_task_types'
down_revision = '0032_replace_supervisor'
branch_labels = None
depends_on = None

_OLD_VALUES = (
    "'read_material', 'video', 'checklist', 'quiz', 'code_assignment', "
    "'external_link', 'mentor_approval', 'file_upload', 'assessment_test'"
)
_NEW_VALUES = (
    "'read_material', 'video', 'checklist', 'quiz', 'code_assignment', "
    "'external_link', 'mentor_approval', 'file_upload', 'assessment_test', "
    "'training', 'presentation', 'discussion', 'diagram', 'procedure'"
)


def upgrade() -> None:
    op.drop_constraint('track_task_type_values', 'track_tasks', type_='check')
    op.create_check_constraint(
        'track_task_type_values',
        'track_tasks',
        f'task_type in ({_NEW_VALUES})',
    )


def downgrade() -> None:
    op.drop_constraint('track_task_type_values', 'track_tasks', type_='check')
    op.create_check_constraint(
        'track_task_type_values',
        'track_tasks',
        f'task_type in ({_OLD_VALUES})',
    )
