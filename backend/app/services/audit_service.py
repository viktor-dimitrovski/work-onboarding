from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.audit import AuditLog


def log_action(
    db: Session,
    *,
    actor_user_id: UUID | None,
    action: str,
    entity_type: str,
    entity_id: UUID | None = None,
    status: str = 'success',
    details: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    safe_details = _json_safe(details or {})
    audit = AuditLog(
        actor_user_id=actor_user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        status=status,
        details_json=safe_details,
        ip_address=ip_address,
    )
    db.add(audit)
    db.flush()
    return audit


def _json_safe(value: Any) -> Any:
    """
    Convert UUID and other non-JSON-serializable types into safe representations.
    """
    if isinstance(value, UUID):
        return str(value)
    try:
        # Lazy import to avoid heavier deps when not needed
        from datetime import datetime

        if isinstance(value, datetime):
            return value.isoformat()
    except Exception:  # pragma: no cover - defensive
        pass
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value
