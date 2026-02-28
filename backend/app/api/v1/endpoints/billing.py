from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.models.rbac import User
from app.multitenancy.deps import TenantContext, require_tenant_membership
from app.multitenancy.permissions import require_access
from app.modules.billing.models import Invoice, PlanPrice
from app.modules.billing.providers import get_provider_adapter
from app.modules.billing.service import BillingAdminService, BillingQueries
from app.schemas.billing import (
    BillingCheckoutSessionRequest,
    BillingCheckoutSessionResponse,
    BillingInvoiceOut,
    BillingInvoiceSummary,
    BillingOverviewResponse,
    BillingPlanSummary,
    BillingPortalSessionResponse,
    BillingSubscriptionSummary,
    BillingUsageItem,
    BillingUsageResponse,
    MeterCreate,
    MeterOut,
    MeterRateCreate,
    MeterRateOut,
    PlanPriceCreate,
    PlanPriceOut,
)


router = APIRouter(prefix='/billing', tags=['billing'])
webhook_router = APIRouter(prefix='/billing', tags=['billing'])


@router.get('/overview', response_model=BillingOverviewResponse)
def billing_overview(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('billing', 'billing:read')),
) -> BillingOverviewResponse:
    subscription = BillingQueries.current_subscription(db, tenant_id=ctx.tenant.id)
    plan = BillingQueries.current_plan(db, subscription=subscription)
    period_start, period_end = BillingQueries.current_period(db, subscription=subscription)
    spend = BillingQueries.current_spend(
        db, tenant_id=ctx.tenant.id, period_start=period_start, period_end=period_end
    )

    invoices = BillingQueries.list_invoices(db, tenant_id=ctx.tenant.id)
    next_invoice = invoices[0] if invoices else None
    currency = subscription.currency if subscription else None
    if not currency and next_invoice:
        currency = next_invoice.currency

    return BillingOverviewResponse(
        plan=BillingPlanSummary.model_validate(plan) if plan else None,
        subscription=BillingSubscriptionSummary.model_validate(subscription) if subscription else None,
        current_period_spend=spend,
        currency=currency,
        period_start=period_start,
        period_end=period_end,
        next_invoice=BillingInvoiceSummary.model_validate(next_invoice) if next_invoice else None,
    )


@router.get('/usage', response_model=BillingUsageResponse)
def billing_usage(
    from_date: datetime | None = None,
    to_date: datetime | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('billing', 'billing:read')),
) -> BillingUsageResponse:
    items = BillingQueries.list_usage_breakdown(
        db, tenant_id=ctx.tenant.id, from_date=from_date, to_date=to_date
    )
    return BillingUsageResponse(
        from_date=from_date,
        to_date=to_date,
        items=[BillingUsageItem(**item) for item in items],
    )


@router.get('/invoices', response_model=list[BillingInvoiceOut])
def billing_invoices(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('billing', 'billing:read')),
) -> list[BillingInvoiceOut]:
    rows = db.scalars(
        select(Invoice)
        .options(selectinload(Invoice.lines))
        .where(Invoice.tenant_id == ctx.tenant.id)
        .order_by(Invoice.issued_at.desc().nulls_last(), Invoice.created_at.desc())
    ).all()
    return [BillingInvoiceOut.model_validate(row) for row in rows]


@router.post('/checkout-session', response_model=BillingCheckoutSessionResponse)
def create_checkout_session(
    payload: BillingCheckoutSessionRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('billing', 'billing:manage')),
) -> BillingCheckoutSessionResponse:
    plan_price = db.scalar(select(PlanPrice).where(PlanPrice.id == payload.plan_price_id))
    if not plan_price:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Plan price not found')
    adapter = get_provider_adapter()
    if not adapter:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Billing provider not configured')
    try:
        url = adapter.create_checkout_session(tenant_id=ctx.tenant.id, plan_price=plan_price)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return BillingCheckoutSessionResponse(url=url)


@router.post('/portal-session', response_model=BillingPortalSessionResponse)
def create_portal_session(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('billing', 'billing:read')),
) -> BillingPortalSessionResponse:
    adapter = get_provider_adapter()
    if not adapter:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Billing provider not configured')
    try:
        url = adapter.create_portal_session(tenant_id=ctx.tenant.id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return BillingPortalSessionResponse(url=url)


@router.get('/admin/meters', response_model=list[MeterOut])
def list_meters(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('billing', 'billing:manage')),
) -> list[MeterOut]:
    rows = BillingAdminService.list_meters(db)
    return [MeterOut.model_validate(row) for row in rows]


@router.post('/admin/meters', response_model=MeterOut, status_code=status.HTTP_201_CREATED)
def create_meter(
    payload: MeterCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('billing', 'billing:manage')),
) -> MeterOut:
    meter = BillingAdminService.create_meter(db, payload=payload.model_dump())
    db.commit()
    return MeterOut.model_validate(meter)


@router.get('/admin/meters/{meter_id}/rates', response_model=list[MeterRateOut])
def list_meter_rates(
    meter_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('billing', 'billing:manage')),
) -> list[MeterRateOut]:
    rows = BillingAdminService.list_rates(db, meter_id=meter_id)
    return [MeterRateOut.model_validate(row) for row in rows]


@router.post('/admin/meters/{meter_id}/rates', response_model=MeterRateOut, status_code=status.HTTP_201_CREATED)
def create_meter_rate(
    meter_id: UUID,
    payload: MeterRateCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('billing', 'billing:manage')),
) -> MeterRateOut:
    if str(payload.meter_id) != str(meter_id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='meter_id mismatch')
    rate = BillingAdminService.create_rate(db, payload=payload.model_dump())
    db.commit()
    return MeterRateOut.model_validate(rate)


@router.get('/admin/plan-prices', response_model=list[PlanPriceOut])
def list_plan_prices(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('billing', 'billing:manage')),
) -> list[PlanPriceOut]:
    rows = BillingAdminService.list_plan_prices(db)
    return [PlanPriceOut.model_validate(row) for row in rows]


@router.post('/admin/plan-prices', response_model=PlanPriceOut, status_code=status.HTTP_201_CREATED)
def create_plan_price(
    payload: PlanPriceCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('billing', 'billing:manage')),
) -> PlanPriceOut:
    price = BillingAdminService.create_plan_price(db, payload=payload.model_dump())
    db.commit()
    return PlanPriceOut.model_validate(price)


@webhook_router.post('/webhooks/stripe')
async def stripe_webhook(request: Request) -> dict:
    adapter = get_provider_adapter()
    if not adapter:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Billing provider not configured')
    payload = await request.body()
    signature = request.headers.get('stripe-signature')
    try:
        return adapter.handle_webhook(payload=payload, signature=signature)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
