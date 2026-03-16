"""Optional Redis client.

Reuses the same Redis URL already configured for Celery.  Uses DB 1 to
keep import-job keys separate from Celery's own keys (which default to DB 0).

If Redis is not reachable (e.g. bare-metal deployments without Redis), the
module sets ``redis_client = None`` and callers are expected to fall back to
an in-process store.
"""
from __future__ import annotations

import logging

import redis

from app.core.config import settings

logger = logging.getLogger(__name__)


def _make_client() -> redis.Redis | None:
    """Build a Redis client from CELERY_BROKER_URL (DB 1) and verify connectivity."""
    url = settings.CELERY_BROKER_URL
    # Switch to DB 1 so import-job keys don't collide with Celery's DB 0 keys
    if url.endswith('/0'):
        url = url[:-1] + '1'
    elif not url.split('/')[-1].isdigit():
        url = url.rstrip('/') + '/1'

    try:
        client = redis.from_url(url, decode_responses=True, socket_connect_timeout=2)
        client.ping()  # fail fast if Redis is not reachable
        return client
    except Exception as exc:
        logger.warning('Redis not available (%s) – import-job progress will use in-memory fallback.', exc)
        return None


# Module-level singleton – None when Redis is unavailable
redis_client: redis.Redis | None = _make_client()
