from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import BaseSchema, TimestampedSchema


class BillingPlanSummary(BaseSchema):
    id: UUID
    key: str
    name: str


class BillingSubscriptionSummary(BaseSchema):
    id: UUID
    status: str
    starts_at: datetime
    ends_at: datetime | None
    trial_ends_at: datetime | None
    current_period_start: datetime | None
    current_period_end: datetime | None
    billing_interval: str | None
    currency: str | None
    provider: str | None
    cancel_at_period_end: bool


class BillingInvoiceSummary(BaseSchema):
    id: UUID
    status: str
    total_amount: Decimal
    currency: str
    issued_at: datetime | None
    due_at: datetime | None
    paid_at: datetime | None


class BillingOverviewResponse(BaseModel):
    plan: BillingPlanSummary | None = None
    subscription: BillingSubscriptionSummary | None = None
    current_period_spend: Decimal = Decimal('0')
    currency: str | None = None
    period_start: datetime | None = None
    period_end: datetime | None = None
    next_invoice: BillingInvoiceSummary | None = None


class BillingUsageItem(BaseModel):
    event_key: str
    meter_name: str
    units: Decimal
    amount: Decimal
    currency: str


class BillingUsageResponse(BaseModel):
    from_date: datetime | None = None
    to_date: datetime | None = None
    items: list[BillingUsageItem] = Field(default_factory=list)


class BillingInvoiceLineOut(BaseSchema):
    id: UUID
    description: str
    quantity: Decimal
    unit_amount: Decimal
    total_amount: Decimal
    currency: str


class BillingInvoiceOut(BaseSchema):
    id: UUID
    status: str
    currency: str
    subtotal_amount: Decimal
    total_amount: Decimal
    issued_at: datetime | None
    due_at: datetime | None
    paid_at: datetime | None
    period_start: datetime | None
    period_end: datetime | None
    lines: list[BillingInvoiceLineOut] = Field(default_factory=list)


class BillingCheckoutSessionRequest(BaseModel):
    plan_price_id: UUID


class BillingCheckoutSessionResponse(BaseModel):
    url: str


class BillingPortalSessionResponse(BaseModel):
    url: str


class MeterOut(TimestampedSchema):
    event_key: str
    name: str
    description: str | None
    unit_label: str | None
    aggregation: str
    rule_json: dict
    is_active: bool


class MeterCreate(BaseModel):
    event_key: str = Field(min_length=2, max_length=80)
    name: str = Field(min_length=2, max_length=120)
    description: str | None = None
    unit_label: str | None = None
    aggregation: str = Field(default='sum')
    rule_json: dict = Field(default_factory=dict)
    is_active: bool = True


class MeterRateOut(TimestampedSchema):
    meter_id: UUID
    currency: str
    unit_price: Decimal
    pricing_json: dict
    effective_from: datetime
    effective_until: datetime | None
    is_active: bool


class MeterRateCreate(BaseModel):
    meter_id: UUID
    currency: str = Field(default='usd', min_length=3, max_length=10)
    unit_price: Decimal = Decimal('0')
    pricing_json: dict = Field(default_factory=dict)
    effective_from: datetime
    effective_until: datetime | None = None
    is_active: bool = True


class PlanPriceOut(TimestampedSchema):
    plan_id: UUID
    provider: str
    billing_interval: str
    currency: str
    amount: Decimal
    provider_price_id: str | None
    nickname: str | None


class PlanPriceCreate(BaseModel):
    plan_id: UUID
    provider: str = Field(default='stripe', min_length=2, max_length=30)
    billing_interval: str = Field(default='month')
    currency: str = Field(default='usd', min_length=3, max_length=10)
    amount: Decimal = Decimal('0')
    provider_price_id: str | None = None
    nickname: str | None = None
