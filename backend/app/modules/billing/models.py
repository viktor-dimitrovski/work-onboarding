from __future__ import annotations

from datetime import datetime
from decimal import Decimal
import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin

BILLING_SCHEMA = 'billing'


class Plan(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'plans'
    __table_args__ = (
        UniqueConstraint('key', name='uq_billing_plans_key'),
        {'schema': BILLING_SCHEMA},
    )

    key: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    tenant_type_scope: Mapped[str] = mapped_column(String(20), nullable=False, default='all')
    module_defaults: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    limits_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    subscriptions: Mapped[list['Subscription']] = relationship(
        back_populates='plan', cascade='all, delete-orphan'
    )
    prices: Mapped[list['PlanPrice']] = relationship(
        back_populates='plan', cascade='all, delete-orphan'
    )


class PlanPrice(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'plan_prices'
    __table_args__ = (
        UniqueConstraint('plan_id', 'provider', 'billing_interval', 'currency', name='uq_billing_plan_prices'),
        CheckConstraint("billing_interval in ('month', 'year')", name='billing_plan_price_interval_values'),
        {'schema': BILLING_SCHEMA},
    )

    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey(f'{BILLING_SCHEMA}.plans.id', ondelete='CASCADE'), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(30), nullable=False, default='stripe')
    billing_interval: Mapped[str] = mapped_column(String(10), nullable=False, default='month')
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default='usd')
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal('0'))
    provider_price_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    nickname: Mapped[str | None] = mapped_column(String(120), nullable=True)

    plan: Mapped['Plan'] = relationship(back_populates='prices')


class Subscription(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'subscriptions'
    __table_args__ = (
        CheckConstraint(
            "status in ('active', 'trialing', 'canceled', 'past_due')",
            name='billing_subscription_status_values',
        ),
        {'schema': BILLING_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey(f'{BILLING_SCHEMA}.plans.id', ondelete='RESTRICT'), nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default='active')
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    provider: Mapped[str | None] = mapped_column(String(30), nullable=True)
    provider_customer_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    provider_subscription_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(10), nullable=True)
    billing_interval: Mapped[str | None] = mapped_column(String(10), nullable=True)
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    current_period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    tenant: Mapped['Tenant'] = relationship(back_populates='subscriptions')
    plan: Mapped['Plan'] = relationship(back_populates='subscriptions')


class TenantModule(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'tenant_modules'
    __table_args__ = (
        UniqueConstraint('tenant_id', 'module_key', name='uq_billing_tenant_modules'),
        {'schema': BILLING_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False
    )
    module_key: Mapped[str] = mapped_column(String(50), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default='plan')

    tenant: Mapped['Tenant'] = relationship(back_populates='modules')

class UsageEvent(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'usage_events'
    __table_args__ = (
        UniqueConstraint('tenant_id', 'idempotency_key', name='uq_billing_usage_idempotency'),
        {'schema': BILLING_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False
    )
    event_key: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    quantity: Mapped[float] = mapped_column(nullable=False, default=1.0)
    meta_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    idempotency_key: Mapped[str | None] = mapped_column(String(120), nullable=True)


class Meter(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'meters'
    __table_args__ = (
        UniqueConstraint('event_key', name='uq_billing_meters_event_key'),
        {'schema': BILLING_SCHEMA},
    )

    event_key: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    unit_label: Mapped[str | None] = mapped_column(String(40), nullable=True)
    aggregation: Mapped[str] = mapped_column(String(20), nullable=False, default='sum')
    rule_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    rates: Mapped[list['MeterRate']] = relationship(
        back_populates='meter', cascade='all, delete-orphan'
    )


class MeterRate(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'meter_rates'
    __table_args__ = (
        UniqueConstraint('meter_id', 'currency', 'effective_from', name='uq_billing_meter_rates'),
        {'schema': BILLING_SCHEMA},
    )

    meter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey(f'{BILLING_SCHEMA}.meters.id', ondelete='CASCADE'), nullable=False
    )
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default='usd')
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 6), nullable=False, default=Decimal('0'))
    pricing_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    effective_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    meter: Mapped['Meter'] = relationship(back_populates='rates')


class CreditPack(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'credit_packs'
    __table_args__ = (
        UniqueConstraint('key', name='uq_billing_credit_pack_key'),
        {'schema': BILLING_SCHEMA},
    )

    key: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default='usd')
    credits: Mapped[int] = mapped_column(nullable=False, default=0)
    price_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal('0'))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class CreditGrant(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'credit_grants'
    __table_args__ = (
        {'schema': BILLING_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False
    )
    credit_pack_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey(f'{BILLING_SCHEMA}.credit_packs.id', ondelete='SET NULL'), nullable=True
    )
    granted_credits: Mapped[int] = mapped_column(nullable=False, default=0)
    remaining_credits: Mapped[int] = mapped_column(nullable=False, default=0)
    source: Mapped[str] = mapped_column(String(40), nullable=False, default='purchase')
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LedgerEntry(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'ledger_entries'
    __table_args__ = (
        UniqueConstraint('tenant_id', 'idempotency_key', name='uq_billing_ledger_idempotency'),
        {'schema': BILLING_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False
    )
    meter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey(f'{BILLING_SCHEMA}.meters.id', ondelete='SET NULL'), nullable=True
    )
    usage_event_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey(f'{BILLING_SCHEMA}.usage_events.id', ondelete='SET NULL'), nullable=True
    )
    subscription_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey(f'{BILLING_SCHEMA}.subscriptions.id', ondelete='SET NULL'), nullable=True
    )
    units: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False, default=Decimal('0'))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 6), nullable=False, default=Decimal('0'))
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default='usd')
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    idempotency_key: Mapped[str | None] = mapped_column(String(120), nullable=True)


class Invoice(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'invoices'
    __table_args__ = (
        {'schema': BILLING_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False
    )
    provider: Mapped[str | None] = mapped_column(String(30), nullable=True)
    provider_invoice_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default='draft')
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default='usd')
    subtotal_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal('0'))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal('0'))
    period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    lines: Mapped[list['InvoiceLine']] = relationship(
        back_populates='invoice', cascade='all, delete-orphan'
    )


class InvoiceLine(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'invoice_lines'
    __table_args__ = (
        {'schema': BILLING_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False
    )
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey(f'{BILLING_SCHEMA}.invoices.id', ondelete='CASCADE'), nullable=False
    )
    ledger_entry_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey(f'{BILLING_SCHEMA}.ledger_entries.id', ondelete='SET NULL'), nullable=True
    )
    meter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey(f'{BILLING_SCHEMA}.meters.id', ondelete='SET NULL'), nullable=True
    )
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False, default=Decimal('0'))
    unit_amount: Mapped[Decimal] = mapped_column(Numeric(12, 6), nullable=False, default=Decimal('0'))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 6), nullable=False, default=Decimal('0'))
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default='usd')

    invoice: Mapped['Invoice'] = relationship(back_populates='lines')


class OutboxEvent(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'outbox_events'
    __table_args__ = (
        UniqueConstraint('tenant_id', 'dedupe_key', name='uq_billing_outbox_dedupe'),
        {'schema': BILLING_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    payload_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default='pending')
    attempt_count: Mapped[int] = mapped_column(nullable=False, default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    dedupe_key: Mapped[str | None] = mapped_column(String(120), nullable=True)


class ProviderEvent(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'provider_events'
    __table_args__ = (
        UniqueConstraint('provider', 'provider_event_id', name='uq_billing_provider_event'),
        {'schema': BILLING_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(30), nullable=False)
    provider_event_id: Mapped[str] = mapped_column(String(120), nullable=False)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    payload_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default='received')
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


Index('ix_billing_ledger_entries_tenant', LedgerEntry.tenant_id)
Index('ix_billing_ledger_entries_occurred', LedgerEntry.occurred_at)
Index('ix_billing_outbox_status', OutboxEvent.status)
Index('ix_billing_outbox_next_attempt', OutboxEvent.next_attempt_at)
Index('ix_billing_provider_event_tenant', ProviderEvent.tenant_id)
Index('ix_billing_credit_grants_tenant', CreditGrant.tenant_id)
Index('ix_billing_invoices_tenant', Invoice.tenant_id)
Index('ix_billing_invoice_lines_tenant', InvoiceLine.tenant_id)
Index('ix_subscriptions_tenant', Subscription.tenant_id)
Index('ix_tenant_modules_tenant', TenantModule.tenant_id)
Index('ix_usage_events_tenant', UsageEvent.tenant_id)
Index('ix_billing_meters_event_key', Meter.event_key)
Index('ix_plans_key', Plan.key)
