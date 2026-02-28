from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal, set_tenant_id
from app.models.tenant import Tenant
from app.modules.billing.models import LedgerEntry, Meter, MeterRate, OutboxEvent, Subscription, UsageEvent
from app.modules.billing.providers import get_provider_adapter
from app.modules.billing.rating import compute_units, load_rule

MAX_ATTEMPTS = 5


def process_due_outbox_events(batch_size: int | None = None) -> int:
    db = SessionLocal()
    processed = 0
    try:
        tenant_ids = db.scalars(select(Tenant.id).order_by(Tenant.created_at.asc())).all()
        for tenant_id in tenant_ids:
            processed += _process_tenant_events(
                db, tenant_id=tenant_id, batch_size=batch_size or settings.BILLING_OUTBOX_BATCH_SIZE
            )
        return processed
    finally:
        db.close()


def _process_tenant_events(db: Session, *, tenant_id: UUID, batch_size: int) -> int:
    now = datetime.now(timezone.utc)
    set_tenant_id(db, str(tenant_id))
    events = db.scalars(
        select(OutboxEvent)
        .where(
            OutboxEvent.status.in_(['pending', 'retry']),
            (OutboxEvent.next_attempt_at.is_(None) | (OutboxEvent.next_attempt_at <= now)),
        )
        .order_by(OutboxEvent.created_at.asc())
        .limit(batch_size)
        .with_for_update(skip_locked=True)
    ).all()

    processed = 0
    for event in events:
        set_tenant_id(db, str(tenant_id))
        event.status = 'processing'
        db.flush()
        try:
            _handle_event(db, event)
            event.status = 'done'
            event.last_error = None
            processed += 1
        except Exception as exc:  # noqa: BLE001
            event.attempt_count = int(event.attempt_count or 0) + 1
            event.last_error = str(exc)[:500]
            if event.attempt_count >= MAX_ATTEMPTS:
                event.status = 'failed'
            else:
                event.status = 'retry'
                backoff = min(60, 2 ** event.attempt_count)
                event.next_attempt_at = now + timedelta(minutes=backoff)
        db.commit()
    return processed


def _handle_event(db: Session, event: OutboxEvent) -> None:
    if event.event_type == 'usage.recorded':
        _handle_usage_recorded(db, event)
        return
    raise ValueError(f'Unhandled billing outbox event type: {event.event_type}')


def _handle_usage_recorded(db: Session, event: OutboxEvent) -> None:
    usage_event_id = event.payload_json.get('usage_event_id')
    if not usage_event_id:
        raise ValueError('usage_event_id missing from outbox payload')

    usage_event = db.scalar(select(UsageEvent).where(UsageEvent.id == UUID(str(usage_event_id))))
    if not usage_event:
        raise ValueError('usage event not found')

    meter = db.scalar(
        select(Meter).where(Meter.event_key == usage_event.event_key, Meter.is_active.is_(True))
    )
    if not meter:
        return

    rate = db.scalar(
        select(MeterRate)
        .where(
            MeterRate.meter_id == meter.id,
            MeterRate.is_active.is_(True),
            MeterRate.effective_from <= usage_event.occurred_at,
            (MeterRate.effective_until.is_(None) | (MeterRate.effective_until >= usage_event.occurred_at)),
        )
        .order_by(MeterRate.effective_from.desc())
    )
    currency = rate.currency if rate else 'usd'
    unit_price = rate.unit_price if rate else Decimal('0')

    rule = load_rule(meter.rule_json)
    units = compute_units(usage_event.quantity, usage_event.meta_json, rule)
    amount = units * Decimal(str(unit_price))

    idempotency_key = f'usage:{usage_event.id}'
    existing = db.scalar(
        select(LedgerEntry.id).where(
            LedgerEntry.tenant_id == usage_event.tenant_id,
            LedgerEntry.idempotency_key == idempotency_key,
        )
    )
    if not existing:
        entry = LedgerEntry(
            tenant_id=usage_event.tenant_id,
            meter_id=meter.id,
            usage_event_id=usage_event.id,
            subscription_id=_resolve_subscription_id(db, usage_event.tenant_id),
            units=units,
            amount=amount,
            currency=currency,
            occurred_at=usage_event.occurred_at,
            idempotency_key=idempotency_key,
            description=f'Usage for {usage_event.event_key}',
        )
        db.add(entry)
        db.flush()

    _maybe_sync_stripe_usage(db, meter, usage_event, units, currency)


def _resolve_subscription_id(db: Session, tenant_id: UUID) -> UUID | None:
    subscription = db.scalar(
        select(Subscription)
        .where(Subscription.tenant_id == tenant_id)
        .order_by(Subscription.starts_at.desc())
    )
    return subscription.id if subscription else None


def _maybe_sync_stripe_usage(
    db: Session, meter: Meter, usage_event: UsageEvent, units: Decimal, currency: str
) -> None:
    if settings.BILLING_PROVIDER != 'stripe':
        return
    adapter = get_provider_adapter()
    if not adapter:
        return

    subscription = db.scalar(
        select(Subscription)
        .where(Subscription.tenant_id == usage_event.tenant_id)
        .order_by(Subscription.starts_at.desc())
    )
    if not subscription or not subscription.provider_subscription_id:
        return

    stripe_item_id = (meter.rule_json or {}).get('stripe_usage_item_id')
    if not stripe_item_id:
        return

    adapter.record_metered_usage(
        subscription_id=subscription.provider_subscription_id,
        subscription_item_id=stripe_item_id,
        units=units,
        occurred_at=usage_event.occurred_at,
        currency=currency,
    )
