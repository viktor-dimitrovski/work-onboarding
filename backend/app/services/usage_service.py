from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.tenant import UsageEvent


def record_event(
    db: Session,
    *,
    tenant_id: UUID,
    event_key: str,
    quantity: float = 1.0,
    meta: dict | None = None,
    actor_user_id: UUID | None = None,
) -> UsageEvent:
    event = UsageEvent(
        tenant_id=tenant_id,
        event_key=event_key,
        quantity=quantity,
        meta_json=meta or {},
        actor_user_id=actor_user_id,
    )
    db.add(event)
    db.flush()
    return event


def summarize_usage(
    db: Session,
    *,
    tenant_id: UUID,
    from_date: datetime | None = None,
    to_date: datetime | None = None,
) -> list[tuple[str, float]]:
    query = select(UsageEvent.event_key, func.sum(UsageEvent.quantity)).where(
        UsageEvent.tenant_id == tenant_id
    )
    if from_date:
        query = query.where(UsageEvent.created_at >= from_date)
    if to_date:
        query = query.where(UsageEvent.created_at <= to_date)
    query = query.group_by(UsageEvent.event_key).order_by(UsageEvent.event_key.asc())

    rows = db.execute(query).all()
    return [(row[0], float(row[1] or 0)) for row in rows]


def record_daily_event(
    db: Session,
    *,
    tenant_id: UUID,
    event_key: str,
    actor_user_id: UUID | None,
) -> UsageEvent | None:
    if not actor_user_id:
        return None
    now = datetime.now(timezone.utc)
    start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    existing = db.scalar(
        select(UsageEvent.id).where(
            UsageEvent.tenant_id == tenant_id,
            UsageEvent.event_key == event_key,
            UsageEvent.actor_user_id == actor_user_id,
            UsageEvent.created_at >= start,
            UsageEvent.created_at < end,
        )
    )
    if existing:
        return None
    return record_event(
        db,
        tenant_id=tenant_id,
        event_key=event_key,
        quantity=1.0,
        actor_user_id=actor_user_id,
        meta={'date': start.date().isoformat()},
    )
