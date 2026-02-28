from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.modules.billing.models import OutboxEvent, UsageEvent


class BillingEmitter:
    @staticmethod
    def emit_usage(
        db: Session,
        *,
        tenant_id: UUID,
        event_key: str,
        quantity: float = 1.0,
        meta: dict | None = None,
        actor_user_id: UUID | None = None,
        occurred_at: datetime | None = None,
        idempotency_key: str | None = None,
    ) -> UsageEvent:
        event = UsageEvent(
            tenant_id=tenant_id,
            event_key=event_key,
            quantity=quantity,
            meta_json=meta or {},
            actor_user_id=actor_user_id,
            occurred_at=occurred_at or datetime.now(timezone.utc),
            idempotency_key=idempotency_key,
        )
        db.add(event)
        db.flush()

        outbox = OutboxEvent(
            tenant_id=tenant_id,
            event_type='usage.recorded',
            payload_json={
                'usage_event_id': str(event.id),
                'tenant_id': str(tenant_id),
                'event_key': event_key,
            },
            status='pending',
            attempt_count=0,
            next_attempt_at=datetime.now(timezone.utc),
            dedupe_key=idempotency_key or str(event.id),
        )
        db.add(outbox)
        db.flush()
        return event
