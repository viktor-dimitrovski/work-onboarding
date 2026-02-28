from __future__ import annotations

from app.modules.billing.celery_app import celery_app
from app.modules.billing.outbox import process_due_outbox_events


@celery_app.task(name='app.modules.billing.tasks.process_billing_outbox')
def process_billing_outbox() -> int:
    return process_due_outbox_events()
