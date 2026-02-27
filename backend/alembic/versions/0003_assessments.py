"""add assessments module tables

Revision ID: 0003_assessments
Revises: 0002_track_purpose
Create Date: 2026-02-25 00:30:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0003_assessments'
down_revision: str | None = '0002_track_purpose'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'assessment_questions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('prompt', sa.Text(), nullable=False),
        sa.Column('question_type', sa.String(length=30), nullable=False),
        sa.Column('difficulty', sa.String(length=20), nullable=True),
        sa.Column('tags', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column('status', sa.String(length=30), nullable=False, server_default='draft'),
        sa.Column('explanation', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('updated_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint(
            "question_type in ('mcq_single', 'mcq_multi')",
            name='assessment_question_type_values',
        ),
        sa.CheckConstraint(
            "status in ('draft', 'published', 'archived')",
            name='assessment_question_status_values',
        ),
    )
    op.create_index('ix_assessment_questions_status', 'assessment_questions', ['status'])
    op.create_index('ix_assessment_questions_difficulty', 'assessment_questions', ['difficulty'])
    op.create_index('ix_assessment_questions_type', 'assessment_questions', ['question_type'])

    op.create_table(
        'assessment_question_options',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('question_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('option_text', sa.Text(), nullable=False),
        sa.Column('is_correct', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('order_index', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('updated_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(['question_id'], ['assessment_questions.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('question_id', 'order_index', name='uq_assessment_question_option_order'),
    )
    op.create_index(
        'ix_assessment_question_options_question_id', 'assessment_question_options', ['question_id']
    )

    op.create_table(
        'assessment_tests',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('category', sa.String(length=100), nullable=True),
        sa.Column('role_target', sa.String(length=100), nullable=True),
        sa.Column('status', sa.String(length=30), nullable=False, server_default='draft'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('updated_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint(
            "status in ('draft', 'published', 'archived')",
            name='assessment_test_status_values',
        ),
    )
    op.create_index('ix_assessment_tests_status', 'assessment_tests', ['status'])
    op.create_index('ix_assessment_tests_category', 'assessment_tests', ['category'])

    op.create_table(
        'assessment_test_versions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('test_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('version_number', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=30), nullable=False, server_default='draft'),
        sa.Column('passing_score', sa.Integer(), nullable=False, server_default='80'),
        sa.Column('time_limit_minutes', sa.Integer(), nullable=True),
        sa.Column('shuffle_questions', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('attempts_allowed', sa.Integer(), nullable=True),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('updated_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(['test_id'], ['assessment_tests.id'], ondelete='CASCADE'),
        sa.UniqueConstraint(
            'test_id', 'version_number', name='uq_assessment_test_versions_test_version'
        ),
        sa.CheckConstraint(
            "status in ('draft', 'published', 'archived')",
            name='assessment_test_version_status_values',
        ),
    )
    op.create_index('ix_assessment_test_versions_test_id', 'assessment_test_versions', ['test_id'])

    op.create_table(
        'assessment_test_version_questions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('test_version_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('question_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('order_index', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('points', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('question_snapshot', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('updated_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(['test_version_id'], ['assessment_test_versions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['question_id'], ['assessment_questions.id'], ondelete='SET NULL'),
        sa.UniqueConstraint(
            'test_version_id', 'order_index', name='uq_assessment_test_version_question_order'
        ),
    )

    op.create_table(
        'assessment_deliveries',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('test_version_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('audience_type', sa.String(length=30), nullable=False, server_default='assignment'),
        sa.Column('source_assignment_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('source_assignment_task_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('participant_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('starts_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ends_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('attempts_allowed', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('duration_minutes', sa.Integer(), nullable=True),
        sa.Column('due_date', sa.Date(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('updated_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(
            ['test_version_id'], ['assessment_test_versions.id'], ondelete='RESTRICT'
        ),
        sa.ForeignKeyConstraint(
            ['source_assignment_id'], ['onboarding_assignments.id'], ondelete='SET NULL'
        ),
        sa.ForeignKeyConstraint(
            ['source_assignment_task_id'], ['assignment_tasks.id'], ondelete='SET NULL'
        ),
        sa.ForeignKeyConstraint(['participant_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.CheckConstraint(
            "audience_type in ('assignment', 'campaign')",
            name='assessment_delivery_audience_values',
        ),
    )
    op.create_index(
        'ix_assessment_deliveries_participant_user',
        'assessment_deliveries',
        ['participant_user_id'],
    )
    op.create_index(
        'ix_assessment_deliveries_source_assignment',
        'assessment_deliveries',
        ['source_assignment_id'],
    )

    op.create_table(
        'assessment_attempts',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('delivery_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('attempt_number', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('status', sa.String(length=30), nullable=False, server_default='in_progress'),
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column(
            'question_order',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('score', sa.Float(), nullable=True),
        sa.Column('max_score', sa.Float(), nullable=True),
        sa.Column('score_percent', sa.Float(), nullable=True),
        sa.Column('passed', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('updated_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(['delivery_id'], ['assessment_deliveries.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='RESTRICT'),
        sa.UniqueConstraint(
            'delivery_id', 'user_id', 'attempt_number', name='uq_assessment_attempt_delivery_user'
        ),
        sa.CheckConstraint(
            "status in ('in_progress', 'submitted', 'scored', 'expired')",
            name='assessment_attempt_status_values',
        ),
    )
    op.create_index('ix_assessment_attempts_delivery_id', 'assessment_attempts', ['delivery_id'])
    op.create_index('ix_assessment_attempts_user_id', 'assessment_attempts', ['user_id'])

    op.create_table(
        'assessment_attempt_answers',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('attempt_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('question_index', sa.Integer(), nullable=False),
        sa.Column(
            'selected_option_keys',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column('is_correct', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('updated_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(['attempt_id'], ['assessment_attempts.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('attempt_id', 'question_index', name='uq_assessment_attempt_answer_order'),
    )


def downgrade() -> None:
    op.drop_table('assessment_attempt_answers')
    op.drop_table('assessment_attempts')
    op.drop_table('assessment_deliveries')
    op.drop_table('assessment_test_version_questions')
    op.drop_table('assessment_test_versions')
    op.drop_index('ix_assessment_tests_category', table_name='assessment_tests')
    op.drop_index('ix_assessment_tests_status', table_name='assessment_tests')
    op.drop_table('assessment_tests')
    op.drop_index('ix_assessment_question_options_question_id', table_name='assessment_question_options')
    op.drop_table('assessment_question_options')
    op.drop_index('ix_assessment_questions_type', table_name='assessment_questions')
    op.drop_index('ix_assessment_questions_difficulty', table_name='assessment_questions')
    op.drop_index('ix_assessment_questions_status', table_name='assessment_questions')
    op.drop_table('assessment_questions')
