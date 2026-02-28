from __future__ import annotations

from celery import Celery

from app.core.config import settings

celery_app = Celery(
    'billing',
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
)

celery_app.conf.update(
    task_default_queue='billing',
    broker_connection_retry_on_startup=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)

celery_app.conf.beat_schedule = {
    'billing-outbox-dispatch': {
        'task': 'app.modules.billing.tasks.process_billing_outbox',
        'schedule': settings.BILLING_OUTBOX_INTERVAL_SECONDS,
    }
}
