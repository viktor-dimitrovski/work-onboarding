"""billing schema + outbox + rating tables

Revision ID: 0012_billing_schema_module
Revises: 0011_assessment_classification_v2
Create Date: 2026-02-28

"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0012_billing_schema_module'
down_revision: str | None = '0011_assessment_classification_v2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TENANT_TABLES = [
    'subscriptions',
    'tenant_modules',
    'usage_events',
    'credit_grants',
    'ledger_entries',
    'invoices',
    'invoice_lines',
    'outbox_events',
    'provider_events',
]


def upgrade() -> None:
    op.execute('CREATE SCHEMA IF NOT EXISTS billing')

    for table in ['plans', 'subscriptions', 'tenant_modules', 'usage_events']:
        op.execute(f'ALTER TABLE {table} SET SCHEMA billing')

    op.add_column(
        'subscriptions', sa.Column('provider', sa.String(length=30), nullable=True), schema='billing'
    )
    op.add_column(
        'subscriptions',
        sa.Column('provider_customer_id', sa.String(length=120), nullable=True),
        schema='billing',
    )
    op.add_column(
        'subscriptions',
        sa.Column('provider_subscription_id', sa.String(length=120), nullable=True),
        schema='billing',
    )
    op.add_column(
        'subscriptions', sa.Column('currency', sa.String(length=10), nullable=True), schema='billing'
    )
    op.add_column(
        'subscriptions',
        sa.Column('billing_interval', sa.String(length=10), nullable=True),
        schema='billing',
    )
    op.add_column(
        'subscriptions', sa.Column('trial_ends_at', sa.DateTime(timezone=True), nullable=True), schema='billing'
    )
    op.add_column(
        'subscriptions',
        sa.Column('current_period_start', sa.DateTime(timezone=True), nullable=True),
        schema='billing',
    )
    op.add_column(
        'subscriptions',
        sa.Column('current_period_end', sa.DateTime(timezone=True), nullable=True),
        schema='billing',
    )
    op.add_column(
        'subscriptions',
        sa.Column('cancel_at_period_end', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        schema='billing',
    )
    op.drop_constraint('subscription_status_values', 'subscriptions', schema='billing', type_='check')
    op.create_check_constraint(
        'billing_subscription_status_values',
        'subscriptions',
        "status in ('active', 'trialing', 'canceled', 'past_due')",
        schema='billing',
    )

    op.add_column(
        'usage_events', sa.Column('occurred_at', sa.DateTime(timezone=True), nullable=True), schema='billing'
    )
    op.execute("UPDATE billing.usage_events SET occurred_at = created_at WHERE occurred_at IS NULL")
    op.alter_column(
        'usage_events',
        'occurred_at',
        schema='billing',
        nullable=False,
        server_default=sa.text('now()'),
    )
    op.add_column(
        'usage_events', sa.Column('idempotency_key', sa.String(length=120), nullable=True), schema='billing'
    )
    op.create_unique_constraint(
        'uq_billing_usage_idempotency',
        'usage_events',
        ['tenant_id', 'idempotency_key'],
        schema='billing',
    )

    op.create_table(
        'plan_prices',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('plan_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('provider', sa.String(length=30), nullable=False, server_default='stripe'),
        sa.Column('billing_interval', sa.String(length=10), nullable=False, server_default='month'),
        sa.Column('currency', sa.String(length=10), nullable=False, server_default='usd'),
        sa.Column('amount', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('provider_price_id', sa.String(length=120), nullable=True),
        sa.Column('nickname', sa.String(length=120), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['plan_id'], ['billing.plans.id'], ondelete='CASCADE'),
        sa.UniqueConstraint(
            'plan_id', 'provider', 'billing_interval', 'currency', name='uq_billing_plan_prices'
        ),
        sa.CheckConstraint(
            "billing_interval in ('month', 'year')", name='billing_plan_price_interval_values'
        ),
        schema='billing',
    )

    op.create_table(
        'meters',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('event_key', sa.String(length=80), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('unit_label', sa.String(length=40), nullable=True),
        sa.Column('aggregation', sa.String(length=20), nullable=False, server_default='sum'),
        sa.Column('rule_json', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.UniqueConstraint('event_key', name='uq_billing_meters_event_key'),
        schema='billing',
    )
    op.create_index('ix_billing_meters_event_key', 'meters', ['event_key'], schema='billing')

    op.create_table(
        'meter_rates',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('meter_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('currency', sa.String(length=10), nullable=False, server_default='usd'),
        sa.Column('unit_price', sa.Numeric(12, 6), nullable=False, server_default='0'),
        sa.Column('pricing_json', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('effective_from', sa.DateTime(timezone=True), nullable=False),
        sa.Column('effective_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['meter_id'], ['billing.meters.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('meter_id', 'currency', 'effective_from', name='uq_billing_meter_rates'),
        schema='billing',
    )

    op.create_table(
        'credit_packs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('key', sa.String(length=50), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('currency', sa.String(length=10), nullable=False, server_default='usd'),
        sa.Column('credits', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('price_amount', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.UniqueConstraint('key', name='uq_billing_credit_pack_key'),
        schema='billing',
    )

    op.create_table(
        'credit_grants',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            'tenant_id',
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column('credit_pack_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('granted_credits', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('remaining_credits', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('source', sa.String(length=40), nullable=False, server_default='purchase'),
        sa.Column('granted_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['credit_pack_id'], ['billing.credit_packs.id'], ondelete='SET NULL'),
        schema='billing',
    )
    op.create_index('ix_billing_credit_grants_tenant', 'credit_grants', ['tenant_id'], schema='billing')

    op.create_table(
        'ledger_entries',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            'tenant_id',
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column('meter_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('usage_event_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('subscription_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('units', sa.Numeric(18, 6), nullable=False, server_default='0'),
        sa.Column('amount', sa.Numeric(12, 6), nullable=False, server_default='0'),
        sa.Column('currency', sa.String(length=10), nullable=False, server_default='usd'),
        sa.Column('description', sa.String(length=255), nullable=True),
        sa.Column('occurred_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('idempotency_key', sa.String(length=120), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['meter_id'], ['billing.meters.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['usage_event_id'], ['billing.usage_events.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['subscription_id'], ['billing.subscriptions.id'], ondelete='SET NULL'),
        sa.UniqueConstraint('tenant_id', 'idempotency_key', name='uq_billing_ledger_idempotency'),
        schema='billing',
    )
    op.create_index('ix_billing_ledger_entries_tenant', 'ledger_entries', ['tenant_id'], schema='billing')
    op.create_index('ix_billing_ledger_entries_occurred', 'ledger_entries', ['occurred_at'], schema='billing')

    op.create_table(
        'invoices',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            'tenant_id',
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column('provider', sa.String(length=30), nullable=True),
        sa.Column('provider_invoice_id', sa.String(length=120), nullable=True),
        sa.Column('status', sa.String(length=30), nullable=False, server_default='draft'),
        sa.Column('currency', sa.String(length=10), nullable=False, server_default='usd'),
        sa.Column('subtotal_amount', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('total_amount', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('period_start', sa.DateTime(timezone=True), nullable=True),
        sa.Column('period_end', sa.DateTime(timezone=True), nullable=True),
        sa.Column('issued_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('due_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('paid_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('metadata_json', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        schema='billing',
    )
    op.create_index('ix_billing_invoices_tenant', 'invoices', ['tenant_id'], schema='billing')

    op.create_table(
        'invoice_lines',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            'tenant_id',
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column('invoice_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('ledger_entry_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('meter_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('description', sa.String(length=255), nullable=False),
        sa.Column('quantity', sa.Numeric(18, 6), nullable=False, server_default='0'),
        sa.Column('unit_amount', sa.Numeric(12, 6), nullable=False, server_default='0'),
        sa.Column('total_amount', sa.Numeric(12, 6), nullable=False, server_default='0'),
        sa.Column('currency', sa.String(length=10), nullable=False, server_default='usd'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['invoice_id'], ['billing.invoices.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['ledger_entry_id'], ['billing.ledger_entries.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['meter_id'], ['billing.meters.id'], ondelete='SET NULL'),
        schema='billing',
    )
    op.create_index('ix_billing_invoice_lines_tenant', 'invoice_lines', ['tenant_id'], schema='billing')

    op.create_table(
        'outbox_events',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            'tenant_id',
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column('event_type', sa.String(length=80), nullable=False),
        sa.Column('payload_json', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
        sa.Column('attempt_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('dedupe_key', sa.String(length=120), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('tenant_id', 'dedupe_key', name='uq_billing_outbox_dedupe'),
        schema='billing',
    )
    op.create_index('ix_billing_outbox_status', 'outbox_events', ['status'], schema='billing')
    op.create_index('ix_billing_outbox_next_attempt', 'outbox_events', ['next_attempt_at'], schema='billing')

    op.create_table(
        'provider_events',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            'tenant_id',
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("current_setting('app.tenant_id')::uuid"),
        ),
        sa.Column('provider', sa.String(length=30), nullable=False),
        sa.Column('provider_event_id', sa.String(length=120), nullable=False),
        sa.Column('event_type', sa.String(length=80), nullable=False),
        sa.Column('payload_json', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='received'),
        sa.Column('received_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('processed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('provider', 'provider_event_id', name='uq_billing_provider_event'),
        schema='billing',
    )
    op.create_index('ix_billing_provider_event_tenant', 'provider_events', ['tenant_id'], schema='billing')

    for table in TENANT_TABLES:
        op.execute(f'ALTER TABLE billing.{table} ENABLE ROW LEVEL SECURITY')
        op.execute(
            f"""
            DROP POLICY IF EXISTS tenant_isolation_{table} ON billing.{table};
            DROP POLICY IF EXISTS tenant_isolation_billing_{table} ON billing.{table};
            CREATE POLICY tenant_isolation_billing_{table}
            ON billing.{table}
            USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
            WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
            """
        )


def downgrade() -> None:
    for table in TENANT_TABLES:
        op.execute(f'DROP POLICY IF EXISTS tenant_isolation_billing_{table} ON billing.{table}')
        op.execute(f'ALTER TABLE billing.{table} DISABLE ROW LEVEL SECURITY')

    op.drop_index('ix_billing_provider_event_tenant', table_name='provider_events', schema='billing')
    op.drop_table('provider_events', schema='billing')

    op.drop_index('ix_billing_outbox_next_attempt', table_name='outbox_events', schema='billing')
    op.drop_index('ix_billing_outbox_status', table_name='outbox_events', schema='billing')
    op.drop_table('outbox_events', schema='billing')

    op.drop_index('ix_billing_invoice_lines_tenant', table_name='invoice_lines', schema='billing')
    op.drop_table('invoice_lines', schema='billing')

    op.drop_index('ix_billing_invoices_tenant', table_name='invoices', schema='billing')
    op.drop_table('invoices', schema='billing')

    op.drop_index('ix_billing_ledger_entries_occurred', table_name='ledger_entries', schema='billing')
    op.drop_index('ix_billing_ledger_entries_tenant', table_name='ledger_entries', schema='billing')
    op.drop_table('ledger_entries', schema='billing')

    op.drop_index('ix_billing_credit_grants_tenant', table_name='credit_grants', schema='billing')
    op.drop_table('credit_grants', schema='billing')
    op.drop_table('credit_packs', schema='billing')

    op.drop_table('meter_rates', schema='billing')
    op.drop_index('ix_billing_meters_event_key', table_name='meters', schema='billing')
    op.drop_table('meters', schema='billing')

    op.drop_table('plan_prices', schema='billing')

    op.drop_constraint('uq_billing_usage_idempotency', 'usage_events', schema='billing', type_='unique')
    op.drop_column('usage_events', 'idempotency_key', schema='billing')
    op.drop_column('usage_events', 'occurred_at', schema='billing')

    op.drop_column('subscriptions', 'cancel_at_period_end', schema='billing')
    op.drop_column('subscriptions', 'current_period_end', schema='billing')
    op.drop_column('subscriptions', 'current_period_start', schema='billing')
    op.drop_column('subscriptions', 'trial_ends_at', schema='billing')
    op.drop_column('subscriptions', 'billing_interval', schema='billing')
    op.drop_column('subscriptions', 'currency', schema='billing')
    op.drop_column('subscriptions', 'provider_subscription_id', schema='billing')
    op.drop_column('subscriptions', 'provider_customer_id', schema='billing')
    op.drop_column('subscriptions', 'provider', schema='billing')
    op.drop_constraint('billing_subscription_status_values', 'subscriptions', schema='billing', type_='check')
    op.create_check_constraint(
        'subscription_status_values',
        'subscriptions',
        "status in ('active', 'trialing', 'canceled')",
        schema='billing',
    )

    for table in ['plans', 'subscriptions', 'tenant_modules', 'usage_events']:
        op.execute(f'ALTER TABLE billing.{table} SET SCHEMA public')

    op.execute('DROP SCHEMA IF EXISTS billing')
