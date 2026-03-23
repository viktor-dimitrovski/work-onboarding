"""Create ai_import_templates table for per-tenant AI instruction presets.

Revision ID: 0045_ai_import_templates
Revises: 0044_fix_default_tenant_assessment_questions
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0045_ai_import_templates"
down_revision = "0044_fix_default_tenant_assessment_questions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'ai_import_templates',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('context_placeholder', sa.String(500), nullable=True),
        sa.Column('extra_instructions', sa.Text, nullable=False),
        sa.Column('auto_question_count', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('sort_order', sa.Integer, nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('created_by', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('updated_by', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
    )

    # RLS policy — tenants only see their own templates
    conn = op.get_bind()
    conn.execute(sa.text("ALTER TABLE ai_import_templates ENABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text(
        """
        CREATE POLICY ai_import_templates_tenant_isolation
        ON ai_import_templates
        USING (tenant_id = current_setting('app.tenant_id')::uuid)
        """
    ))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("DROP POLICY IF EXISTS ai_import_templates_tenant_isolation ON ai_import_templates"))
    op.drop_table('ai_import_templates')
