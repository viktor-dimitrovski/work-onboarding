from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

import stripe
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal, set_tenant_id
from app.models.tenant import Tenant
from app.modules.billing.models import Invoice, InvoiceLine, PlanPrice, ProviderEvent, Subscription
from app.modules.billing.providers.base import PaymentProviderAdapter


class StripeAdapter(PaymentProviderAdapter):
    def __init__(self) -> None:
        stripe.api_key = settings.STRIPE_API_KEY or ''

    def create_checkout_session(self, *, tenant_id: UUID, plan_price: PlanPrice) -> str:
        if not settings.STRIPE_API_KEY:
            raise ValueError('Stripe API key is not configured')
        if not plan_price.provider_price_id:
            raise ValueError('Plan price is missing Stripe price id')

        tenant = _get_tenant(tenant_id)
        customer_id = _get_stripe_customer_id(tenant_id)
        session = stripe.checkout.Session.create(
            mode='subscription',
            customer=customer_id,
            line_items=[{'price': plan_price.provider_price_id, 'quantity': 1}],
            client_reference_id=str(tenant_id),
            metadata={'tenant_id': str(tenant_id), 'plan_price_id': str(plan_price.id)},
            success_url=f'{settings.FRONTEND_BASE_URL}/billing?checkout=success',
            cancel_url=f'{settings.FRONTEND_BASE_URL}/billing?checkout=cancel',
            customer_email=None if customer_id else _tenant_contact_email(tenant),
        )
        return session.url

    def create_portal_session(self, *, tenant_id: UUID) -> str:
        if not settings.STRIPE_API_KEY:
            raise ValueError('Stripe API key is not configured')
        customer_id = _get_stripe_customer_id(tenant_id)
        if not customer_id:
            raise ValueError('Stripe customer not found for tenant')
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=f'{settings.FRONTEND_BASE_URL}/billing',
        )
        return session.url

    def handle_webhook(self, *, payload: bytes, signature: str | None) -> dict:
        if not settings.STRIPE_WEBHOOK_SECRET:
            raise ValueError('Stripe webhook secret is not configured')
        event = stripe.Webhook.construct_event(payload, signature, settings.STRIPE_WEBHOOK_SECRET)
        event_dict = event.to_dict()

        db = SessionLocal()
        try:
            tenant_id = _resolve_tenant_id(db, event_dict)
            if not tenant_id:
                raise ValueError('Tenant not resolved for Stripe event')
            set_tenant_id(db, str(tenant_id))

            existing = db.scalar(
                select(ProviderEvent).where(
                    ProviderEvent.provider == 'stripe', ProviderEvent.provider_event_id == event_dict['id']
                )
            )
            if existing:
                return {'status': 'duplicate'}

            provider_event = ProviderEvent(
                tenant_id=tenant_id,
                provider='stripe',
                provider_event_id=event_dict['id'],
                event_type=event_dict['type'],
                payload_json=event_dict,
                status='received',
                received_at=datetime.now(timezone.utc),
            )
            db.add(provider_event)
            db.flush()

            _dispatch_event(db, event_dict, tenant_id)
            provider_event.status = 'processed'
            provider_event.processed_at = datetime.now(timezone.utc)
            db.commit()
            return {'status': 'ok'}
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            raise exc
        finally:
            db.close()

    def record_metered_usage(
        self,
        *,
        subscription_id: str,
        subscription_item_id: str,
        units: Decimal,
        occurred_at: datetime,
        currency: str,
    ) -> None:
        if not settings.STRIPE_API_KEY:
            raise ValueError('Stripe API key is not configured')
        _ = currency
        stripe.UsageRecord.create(
            subscription_item=subscription_item_id,
            quantity=int(units),
            timestamp=int(occurred_at.timestamp()),
            action='increment',
        )


def _get_tenant(tenant_id: UUID) -> Tenant | None:
    db = SessionLocal()
    try:
        return db.scalar(select(Tenant).where(Tenant.id == tenant_id))
    finally:
        db.close()


def _tenant_contact_email(tenant: Tenant | None) -> str | None:
    if not tenant:
        return None
    return f'billing+{tenant.slug}@example.com'


def _get_stripe_customer_id(tenant_id: UUID) -> str | None:
    db = SessionLocal()
    try:
        set_tenant_id(db, str(tenant_id))
        subscription = db.scalar(
            select(Subscription)
            .where(Subscription.tenant_id == tenant_id)
            .order_by(Subscription.starts_at.desc())
        )
        return subscription.provider_customer_id if subscription else None
    finally:
        db.close()


def _resolve_tenant_id(db: Session, event_dict: dict) -> UUID | None:
    data = event_dict.get('data', {}).get('object', {})
    metadata = data.get('metadata') or {}
    tenant_id_raw = metadata.get('tenant_id') or data.get('client_reference_id')
    if tenant_id_raw:
        try:
            return UUID(str(tenant_id_raw))
        except ValueError:
            pass

    subscription_id = data.get('subscription')
    customer_id = data.get('customer')
    if subscription_id:
        match = db.scalar(
            select(Subscription).where(Subscription.provider_subscription_id == str(subscription_id))
        )
        if match:
            return match.tenant_id
    if customer_id:
        match = db.scalar(
            select(Subscription).where(Subscription.provider_customer_id == str(customer_id))
        )
        if match:
            return match.tenant_id
    return None


def _dispatch_event(db: Session, event_dict: dict, tenant_id: UUID) -> None:
    event_type = event_dict['type']
    data = event_dict.get('data', {}).get('object', {})

    if event_type == 'checkout.session.completed':
        _handle_checkout_completed(db, data, tenant_id)
    elif event_type.startswith('customer.subscription.'):
        _handle_subscription_update(db, data, tenant_id)
    elif event_type.startswith('invoice.'):
        _handle_invoice_update(db, data, tenant_id)


def _handle_checkout_completed(db: Session, data: dict, tenant_id: UUID) -> None:
    subscription_id = data.get('subscription')
    customer_id = data.get('customer')
    if subscription_id:
        subscription = stripe.Subscription.retrieve(subscription_id)
        subscription_data = subscription.to_dict() if hasattr(subscription, 'to_dict') else subscription
        _upsert_subscription(db, subscription_data, tenant_id, customer_id)


def _handle_subscription_update(db: Session, data: dict, tenant_id: UUID) -> None:
    _upsert_subscription(db, data, tenant_id, data.get('customer'))


def _upsert_subscription(db: Session, subscription_data: dict, tenant_id: UUID, customer_id: str | None) -> None:
    provider_subscription_id = str(subscription_data.get('id') or '')
    if not provider_subscription_id:
        return
    plan_price_id = _resolve_plan_price_id(db, subscription_data)

    existing = db.scalar(
        select(Subscription).where(
            Subscription.tenant_id == tenant_id,
            Subscription.provider_subscription_id == provider_subscription_id,
        )
    )
    if not existing:
        if not plan_price_id:
            return
        existing = Subscription(
            tenant_id=tenant_id,
            plan_id=plan_price_id,
            status='active',
            starts_at=_from_ts(subscription_data.get('start_date')) or datetime.now(timezone.utc),
        )
        db.add(existing)

    if plan_price_id:
        existing.plan_id = plan_price_id
    existing.provider = 'stripe'
    existing.provider_customer_id = str(customer_id) if customer_id else existing.provider_customer_id
    existing.provider_subscription_id = provider_subscription_id
    existing.status = subscription_data.get('status') or existing.status

    price = _extract_price(subscription_data)
    if price:
        existing.currency = price.get('currency')
        recurring = price.get('recurring') or {}
        existing.billing_interval = recurring.get('interval')

    existing.current_period_start = _from_ts(subscription_data.get('current_period_start'))
    existing.current_period_end = _from_ts(subscription_data.get('current_period_end'))
    existing.trial_ends_at = _from_ts(subscription_data.get('trial_end'))
    existing.cancel_at_period_end = bool(subscription_data.get('cancel_at_period_end', False))
    existing.ends_at = _from_ts(subscription_data.get('canceled_at'))
    db.flush()


def _resolve_plan_price_id(db: Session, subscription_data: dict) -> UUID | None:
    price = _extract_price(subscription_data)
    if not price:
        return None
    provider_price_id = price.get('id')
    if not provider_price_id:
        return None
    plan_price = db.scalar(select(PlanPrice).where(PlanPrice.provider_price_id == str(provider_price_id)))
    return plan_price.plan_id if plan_price else None


def _extract_price(subscription_data: dict) -> dict | None:
    items = subscription_data.get('items', {}).get('data') or []
    if not items:
        return None
    price = items[0].get('price') if isinstance(items[0], dict) else None
    if isinstance(price, dict):
        return price
    return None


def _handle_invoice_update(db: Session, data: dict, tenant_id: UUID) -> None:
    provider_invoice_id = str(data.get('id') or '')
    if not provider_invoice_id:
        return
    invoice = db.scalar(
        select(Invoice).where(Invoice.tenant_id == tenant_id, Invoice.provider_invoice_id == provider_invoice_id)
    )
    if not invoice:
        invoice = Invoice(tenant_id=tenant_id, provider='stripe', provider_invoice_id=provider_invoice_id)
        db.add(invoice)

    invoice.status = data.get('status') or invoice.status
    invoice.currency = data.get('currency') or invoice.currency
    invoice.subtotal_amount = Decimal(str((data.get('subtotal') or 0) / 100))
    invoice.total_amount = Decimal(str((data.get('total') or 0) / 100))
    invoice.period_start = _from_ts(data.get('period_start'))
    invoice.period_end = _from_ts(data.get('period_end'))
    invoice.issued_at = _from_ts(data.get('created'))
    invoice.due_at = _from_ts(data.get('due_date'))
    invoice.paid_at = _from_ts(data.get('status_transitions', {}).get('paid_at'))
    invoice.metadata_json = data.get('metadata') or {}

    db.flush()
    db.query(InvoiceLine).where(InvoiceLine.invoice_id == invoice.id).delete()

    lines = data.get('lines', {}).get('data') or []
    for line in lines:
        amount_total = Decimal(str((line.get('amount') or 0) / 100))
        quantity = Decimal(str(line.get('quantity') or 1))
        unit_amount = Decimal(str((line.get('unit_amount') or 0) / 100))
        description = line.get('description') or 'Stripe line item'
        db.add(
            InvoiceLine(
                tenant_id=tenant_id,
                invoice_id=invoice.id,
                description=description,
                quantity=quantity,
                unit_amount=unit_amount,
                total_amount=amount_total,
                currency=invoice.currency,
            )
        )


def _from_ts(timestamp: int | None) -> datetime | None:
    if not timestamp:
        return None
    return datetime.fromtimestamp(int(timestamp), tz=timezone.utc)
