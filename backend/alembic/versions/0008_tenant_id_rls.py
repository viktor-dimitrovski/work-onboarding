"""add tenant_id columns and rls policies

Revision ID: 0008_tenant_id_rls
Revises: 0007_tenants_plans_usage
Create Date: 2026-02-27 00:00:00.000000
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0008_tenant_id_rls'
down_revision: str | None = '0007_tenants_plans_usage'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


ADD_TENANT_ID_TABLES = [
    'track_templates',
    'track_versions',
    'track_phases',
    'track_tasks',
    'task_resources',
    'onboarding_assignments',
    'assignment_phases',
    'assignment_tasks',
    'task_submissions',
    'mentor_reviews',
    'quiz_attempts',
    'comments',
    'assessment_categories',
    'assessment_questions',
    'assessment_question_options',
    'assessment_classification_jobs',
    'assessment_tests',
    'assessment_test_versions',
    'assessment_test_version_questions',
    'assessment_deliveries',
    'assessment_attempts',
    'assessment_attempt_answers',
    'audit_log',
    # group_memberships is tenant-scoped via its group, but needs tenant_id for RLS.
    'group_memberships',
]

TENANT_TABLES = [
    *ADD_TENANT_ID_TABLES,
    'tenant_memberships',
    'tenant_modules',
    'tenant_domains',
    'groups',
    'subscriptions',
    'usage_events',
]


def _ensure_default_tenant(conn) -> str:
    tenant_id = conn.execute(sa.text("select id from tenants limit 1")).scalar()
    if tenant_id:
        return str(tenant_id)

    new_id = str(uuid.uuid4())
    conn.execute(
        sa.text(
            """
            insert into tenants (id, name, slug, tenant_type, is_active, created_at, updated_at)
            values (:id, 'Default Tenant', 'default', 'company', true, now(), now())
            """
        ),
        {"id": new_id},
    )
    return new_id


def upgrade() -> None:
    conn = op.get_bind()
    default_tenant_id = _ensure_default_tenant(conn)
    default_literal = sa.text(f"'{default_tenant_id}'::uuid")

    def add_tenant_id(table_name: str) -> None:
        op.add_column(
            table_name,
            sa.Column(
                'tenant_id',
                postgresql.UUID(as_uuid=True),
                nullable=False,
                server_default=default_literal,
            ),
        )
        op.create_index(f'ix_{table_name}_tenant_id', table_name, ['tenant_id'])

    for table in ADD_TENANT_ID_TABLES:
        add_tenant_id(table)

    op.drop_constraint('uq_assessment_category_slug', 'assessment_categories', type_='unique')
    op.create_unique_constraint(
        'uq_assessment_category_slug', 'assessment_categories', ['tenant_id', 'slug']
    )

    for table in [
        'track_templates',
        'track_versions',
        'track_phases',
        'track_tasks',
        'onboarding_assignments',
        'assignment_phases',
        'assignment_tasks',
        'assessment_categories',
        'assessment_questions',
        'assessment_tests',
        'assessment_test_versions',
        'assessment_deliveries',
        'assessment_attempts',
        'groups',
    ]:
        op.create_unique_constraint(f'uq_{table}_tenant_id', table, ['tenant_id', 'id'])

    # Backfill group_memberships.tenant_id from groups.tenant_id for existing rows.
    op.execute(
        """
        update group_memberships gm
        set tenant_id = g.tenant_id
        from groups g
        where gm.group_id = g.id
        """
    )
    # Enforce tenant-consistent membership rows.
    op.create_foreign_key(
        'fk_group_memberships_tenant_group',
        'group_memberships',
        'groups',
        ['tenant_id', 'group_id'],
        ['tenant_id', 'id'],
        ondelete='CASCADE',
    )

    op.create_foreign_key(
        'fk_track_versions_tenant_template',
        'track_versions',
        'track_templates',
        ['tenant_id', 'template_id'],
        ['tenant_id', 'id'],
        ondelete='CASCADE',
    )
    op.create_foreign_key(
        'fk_track_phases_tenant_version',
        'track_phases',
        'track_versions',
        ['tenant_id', 'track_version_id'],
        ['tenant_id', 'id'],
        ondelete='CASCADE',
    )
    op.create_foreign_key(
        'fk_track_tasks_tenant_phase',
        'track_tasks',
        'track_phases',
        ['tenant_id', 'track_phase_id'],
        ['tenant_id', 'id'],
        ondelete='CASCADE',
    )
    op.create_foreign_key(
        'fk_task_resources_tenant_task',
        'task_resources',
        'track_tasks',
        ['tenant_id', 'task_id'],
        ['tenant_id', 'id'],
        ondelete='CASCADE',
    )
    op.create_foreign_key(
        'fk_onboarding_assignments_tenant_template',
        'onboarding_assignments',
        'track_templates',
        ['tenant_id', 'template_id'],
        ['tenant_id', 'id'],
        ondelete='RESTRICT',
    )
    op.create_foreign_key(
        'fk_onboarding_assignments_tenant_version',
        'onboarding_assignments',
        'track_versions',
        ['tenant_id', 'track_version_id'],
        ['tenant_id', 'id'],
        ondelete='RESTRICT',
    )
    op.create_foreign_key(
        'fk_assignment_phases_tenant_assignment',
        'assignment_phases',
        'onboarding_assignments',
        ['tenant_id', 'assignment_id'],
        ['tenant_id', 'id'],
        ondelete='CASCADE',
    )
    op.create_foreign_key(
        'fk_assignment_tasks_tenant_assignment',
        'assignment_tasks',
        'onboarding_assignments',
        ['tenant_id', 'assignment_id'],
        ['tenant_id', 'id'],
        ondelete='CASCADE',
    )
    op.create_foreign_key(
        'fk_assignment_tasks_tenant_phase',
        'assignment_tasks',
        'assignment_phases',
        ['tenant_id', 'assignment_phase_id'],
        ['tenant_id', 'id'],
        ondelete='CASCADE',
    )
    op.create_foreign_key(
        'fk_task_submissions_tenant_task',
        'task_submissions',
        'assignment_tasks',
        ['tenant_id', 'assignment_task_id'],
        ['tenant_id', 'id'],
        ondelete='CASCADE',
    )
    op.create_foreign_key(
        'fk_mentor_reviews_tenant_task',
        'mentor_reviews',
        'assignment_tasks',
        ['tenant_id', 'assignment_task_id'],
        ['tenant_id', 'id'],
        ondelete='CASCADE',
    )
    op.create_foreign_key(
        'fk_quiz_attempts_tenant_task',
        'quiz_attempts',
        'assignment_tasks',
        ['tenant_id', 'assignment_task_id'],
        ['tenant_id', 'id'],
        ondelete='CASCADE',
    )
    op.create_foreign_key(
        'fk_comments_tenant_assignment',
        'comments',
        'onboarding_assignments',
        ['tenant_id', 'assignment_id'],
        ['tenant_id', 'id'],
        ondelete='CASCADE',
    )
    op.create_foreign_key(
        'fk_comments_tenant_task',
        'comments',
        'assignment_tasks',
        ['tenant_id', 'assignment_task_id'],
        ['tenant_id', 'id'],
        ondelete='SET NULL',
    )
    op.create_foreign_key(
        'fk_assessment_questions_tenant_category',
        'assessment_questions',
        'assessment_categories',
        ['tenant_id', 'category_id'],
        ['tenant_id', 'id'],
        ondelete='SET NULL',
    )
    op.create_foreign_key(
        'fk_assessment_question_options_tenant_question',
        'assessment_question_options',
        'assessment_questions',
        ['tenant_id', 'question_id'],
        ['tenant_id', 'id'],
        ondelete='CASCADE',
    )
    op.create_foreign_key(
        'fk_assessment_test_versions_tenant_test',
        'assessment_test_versions',
        'assessment_tests',
        ['tenant_id', 'test_id'],
        ['tenant_id', 'id'],
        ondelete='CASCADE',
    )
    op.create_foreign_key(
        'fk_assessment_test_version_questions_tenant_version',
        'assessment_test_version_questions',
        'assessment_test_versions',
        ['tenant_id', 'test_version_id'],
        ['tenant_id', 'id'],
        ondelete='CASCADE',
    )
    op.create_foreign_key(
        'fk_assessment_test_version_questions_tenant_question',
        'assessment_test_version_questions',
        'assessment_questions',
        ['tenant_id', 'question_id'],
        ['tenant_id', 'id'],
        ondelete='SET NULL',
    )
    op.create_foreign_key(
        'fk_assessment_deliveries_tenant_test_version',
        'assessment_deliveries',
        'assessment_test_versions',
        ['tenant_id', 'test_version_id'],
        ['tenant_id', 'id'],
        ondelete='RESTRICT',
    )
    op.create_foreign_key(
        'fk_assessment_deliveries_tenant_assignment',
        'assessment_deliveries',
        'onboarding_assignments',
        ['tenant_id', 'source_assignment_id'],
        ['tenant_id', 'id'],
        ondelete='SET NULL',
    )
    op.create_foreign_key(
        'fk_assessment_deliveries_tenant_assignment_task',
        'assessment_deliveries',
        'assignment_tasks',
        ['tenant_id', 'source_assignment_task_id'],
        ['tenant_id', 'id'],
        ondelete='SET NULL',
    )
    op.create_foreign_key(
        'fk_assessment_attempts_tenant_delivery',
        'assessment_attempts',
        'assessment_deliveries',
        ['tenant_id', 'delivery_id'],
        ['tenant_id', 'id'],
        ondelete='CASCADE',
    )
    op.create_foreign_key(
        'fk_assessment_attempt_answers_tenant_attempt',
        'assessment_attempt_answers',
        'assessment_attempts',
        ['tenant_id', 'attempt_id'],
        ['tenant_id', 'id'],
        ondelete='CASCADE',
    )

    for table in ADD_TENANT_ID_TABLES:
        op.alter_column(
            table,
            'tenant_id',
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        )

    for table in TENANT_TABLES:
        op.execute(f'ALTER TABLE {table} ENABLE ROW LEVEL SECURITY')
        op.execute(
            f"""
            CREATE POLICY tenant_isolation_{table}
            ON {table}
            USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
            WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
            """
        )


def downgrade() -> None:
    for table in TENANT_TABLES:
        op.execute(f'DROP POLICY IF EXISTS tenant_isolation_{table} ON {table}')
        op.execute(f'ALTER TABLE {table} DISABLE ROW LEVEL SECURITY')

    op.drop_constraint('fk_assessment_attempt_answers_tenant_attempt', 'assessment_attempt_answers', type_='foreignkey')
    op.drop_constraint('fk_assessment_attempts_tenant_delivery', 'assessment_attempts', type_='foreignkey')
    op.drop_constraint('fk_assessment_deliveries_tenant_assignment_task', 'assessment_deliveries', type_='foreignkey')
    op.drop_constraint('fk_assessment_deliveries_tenant_assignment', 'assessment_deliveries', type_='foreignkey')
    op.drop_constraint('fk_assessment_deliveries_tenant_test_version', 'assessment_deliveries', type_='foreignkey')
    op.drop_constraint('fk_assessment_test_version_questions_tenant_question', 'assessment_test_version_questions', type_='foreignkey')
    op.drop_constraint('fk_assessment_test_version_questions_tenant_version', 'assessment_test_version_questions', type_='foreignkey')
    op.drop_constraint('fk_assessment_test_versions_tenant_test', 'assessment_test_versions', type_='foreignkey')
    op.drop_constraint('fk_assessment_question_options_tenant_question', 'assessment_question_options', type_='foreignkey')
    op.drop_constraint('fk_assessment_questions_tenant_category', 'assessment_questions', type_='foreignkey')
    op.drop_constraint('fk_comments_tenant_task', 'comments', type_='foreignkey')
    op.drop_constraint('fk_comments_tenant_assignment', 'comments', type_='foreignkey')
    op.drop_constraint('fk_quiz_attempts_tenant_task', 'quiz_attempts', type_='foreignkey')
    op.drop_constraint('fk_mentor_reviews_tenant_task', 'mentor_reviews', type_='foreignkey')
    op.drop_constraint('fk_task_submissions_tenant_task', 'task_submissions', type_='foreignkey')
    op.drop_constraint('fk_assignment_tasks_tenant_phase', 'assignment_tasks', type_='foreignkey')
    op.drop_constraint('fk_assignment_tasks_tenant_assignment', 'assignment_tasks', type_='foreignkey')
    op.drop_constraint('fk_assignment_phases_tenant_assignment', 'assignment_phases', type_='foreignkey')
    op.drop_constraint('fk_onboarding_assignments_tenant_version', 'onboarding_assignments', type_='foreignkey')
    op.drop_constraint('fk_onboarding_assignments_tenant_template', 'onboarding_assignments', type_='foreignkey')
    op.drop_constraint('fk_task_resources_tenant_task', 'task_resources', type_='foreignkey')
    op.drop_constraint('fk_track_tasks_tenant_phase', 'track_tasks', type_='foreignkey')
    op.drop_constraint('fk_track_phases_tenant_version', 'track_phases', type_='foreignkey')
    op.drop_constraint('fk_track_versions_tenant_template', 'track_versions', type_='foreignkey')

    op.drop_constraint('fk_group_memberships_tenant_group', 'group_memberships', type_='foreignkey')

    for table in [
        'track_templates',
        'track_versions',
        'track_phases',
        'track_tasks',
        'onboarding_assignments',
        'assignment_phases',
        'assignment_tasks',
        'assessment_categories',
        'assessment_questions',
        'assessment_tests',
        'assessment_test_versions',
        'assessment_deliveries',
        'assessment_attempts',
        'groups',
    ]:
        op.drop_constraint(f'uq_{table}_tenant_id', table, type_='unique')

    op.drop_constraint('uq_assessment_category_slug', 'assessment_categories', type_='unique')
    op.create_unique_constraint('uq_assessment_category_slug', 'assessment_categories', ['slug'])

    for table in ADD_TENANT_ID_TABLES:
        op.drop_index(f'ix_{table}_tenant_id', table_name=table)
        op.drop_column(table, 'tenant_id')
