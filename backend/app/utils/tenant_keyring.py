"""In-memory per-tenant key cache.

This cache is process-local and is cleared on restart.
"""

from __future__ import annotations

import threading
import uuid


_lock = threading.RLock()
_keys: dict[tuple[uuid.UUID, str], bytes] = {}


def store_key(tenant_id: uuid.UUID, key_id: str, key: bytes) -> None:
    with _lock:
        _keys[(tenant_id, key_id)] = key


def get_key(tenant_id: uuid.UUID, key_id: str) -> bytes | None:
    with _lock:
        return _keys.get((tenant_id, key_id))


def is_unlocked(tenant_id: uuid.UUID, key_id: str) -> bool:
    return get_key(tenant_id, key_id) is not None


def lock_tenant(tenant_id: uuid.UUID, key_id: str | None = None) -> None:
    with _lock:
        if key_id is None:
            for k in list(_keys.keys()):
                if k[0] == tenant_id:
                    _keys.pop(k, None)
            return
        _keys.pop((tenant_id, key_id), None)
