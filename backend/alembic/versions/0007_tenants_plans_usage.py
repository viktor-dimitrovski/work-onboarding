"""add tenant, plan, usage foundations

Revision ID: 0007_tenants_plans_usage
Revises: 0006_oauth_users
Create Date: 2026-02-27 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0007_tenants_plans_usage'
down_revision: str | None = '0006_oauth_users'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'tenants',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('slug', sa.String(length=63), nullable=False),
        sa.Column('tenant_type', sa.String(length=20), nullable=False, server_default='company'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.UniqueConstraint('slug', name='uq_tenants_slug'),
        sa.CheckConstraint("tenant_type in ('company', 'education')", name='tenant_type_values'),
    )
    op.create_index('ix_tenants_slug', 'tenants', ['slug'])

    op.create_table(
        'tenant_domains',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('domain', sa.String(length=255), nullable=False),
        sa.Column('is_primary', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('domain', name='uq_tenant_domains_domain'),
    )
    op.create_index('ix_tenant_domains_domain', 'tenant_domains', ['domain'])

    op.create_table(
        'tenant_memberships',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('role', sa.String(length=50), nullable=False, server_default='member'),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='active'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('tenant_id', 'user_id', name='uq_tenant_membership'),
        sa.CheckConstraint("status in ('active', 'invited', 'disabled')", name='tenant_membership_status_values'),
    )
    op.create_index('ix_tenant_memberships_tenant', 'tenant_memberships', ['tenant_id'])
    op.create_index('ix_tenant_memberships_user', 'tenant_memberships', ['user_id'])

    op.create_table(
        'groups',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('group_type', sa.String(length=20), nullable=False, server_default='team'),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.CheckConstraint("group_type in ('team', 'class')", name='group_type_values'),
    )
    op.create_index('ix_groups_tenant', 'groups', ['tenant_id'])

    op.create_table(
        'group_memberships',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('group_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('role', sa.String(length=50), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['group_id'], ['groups.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('group_id', 'user_id', name='uq_group_membership'),
    )
    op.create_index('ix_group_memberships_group', 'group_memberships', ['group_id'])
    op.create_index('ix_group_memberships_user', 'group_memberships', ['user_id'])

    op.create_table(
        'plans',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('key', sa.String(length=50), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('tenant_type_scope', sa.String(length=20), nullable=False, server_default='all'),
        sa.Column('module_defaults', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('limits_json', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.UniqueConstraint('key', name='uq_plans_key'),
    )
    op.create_index('ix_plans_key', 'plans', ['key'])

    op.create_table(
        'subscriptions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('plan_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='active'),
        sa.Column('starts_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('ends_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['plan_id'], ['plans.id'], ondelete='RESTRICT'),
        sa.CheckConstraint("status in ('active', 'trialing', 'canceled')", name='subscription_status_values'),
    )
    op.create_index('ix_subscriptions_tenant', 'subscriptions', ['tenant_id'])

    op.create_table(
        'tenant_modules',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('module_key', sa.String(length=50), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('source', sa.String(length=20), nullable=False, server_default='plan'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('tenant_id', 'module_key', name='uq_tenant_modules'),
    )
    op.create_index('ix_tenant_modules_tenant', 'tenant_modules', ['tenant_id'])

    op.create_table(
        'usage_events',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('event_key', sa.String(length=60), nullable=False),
        sa.Column('quantity', sa.Float(), nullable=False, server_default='1'),
        sa.Column('meta_json', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('actor_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_usage_events_tenant', 'usage_events', ['tenant_id'])
    op.create_index('ix_usage_events_event_key', 'usage_events', ['event_key'])


def downgrade() -> None:
    op.drop_index('ix_usage_events_event_key', table_name='usage_events')
    op.drop_index('ix_usage_events_tenant', table_name='usage_events')
    op.drop_table('usage_events')
    op.drop_index('ix_tenant_modules_tenant', table_name='tenant_modules')
    op.drop_table('tenant_modules')
    op.drop_index('ix_subscriptions_tenant', table_name='subscriptions')
    op.drop_table('subscriptions')
    op.drop_index('ix_plans_key', table_name='plans')
    op.drop_table('plans')
    op.drop_index('ix_group_memberships_user', table_name='group_memberships')
    op.drop_index('ix_group_memberships_group', table_name='group_memberships')
    op.drop_table('group_memberships')
    op.drop_index('ix_groups_tenant', table_name='groups')
    op.drop_table('groups')
    op.drop_index('ix_tenant_memberships_user', table_name='tenant_memberships')
    op.drop_index('ix_tenant_memberships_tenant', table_name='tenant_memberships')
    op.drop_table('tenant_memberships')
    op.drop_index('ix_tenant_domains_domain', table_name='tenant_domains')
    op.drop_table('tenant_domains')
    op.drop_index('ix_tenants_slug', table_name='tenants')
    op.drop_table('tenants')
