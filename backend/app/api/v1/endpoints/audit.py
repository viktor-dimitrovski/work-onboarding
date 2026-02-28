from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.rbac import User
from app.multitenancy.deps import TenantContext, require_tenant_membership
from app.multitenancy.permissions import require_access
from app.schemas.audit import AuditLogListResponse, AuditLogOut
from app.schemas.common import PaginationMeta


router = APIRouter(prefix='/audit-log', tags=['audit-log'])


def _display_name(user: User | None) -> str | None:
    if not user:
        return None
    return (user.full_name or '').strip() or (user.email or '').strip() or None


@router.get('', response_model=AuditLogListResponse)
def list_audit_log(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    action: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('settings', 'settings:manage')),
    ___: TenantContext = Depends(require_tenant_membership),
) -> AuditLogListResponse:
    base = select(AuditLog)
    if action:
        base = base.where(AuditLog.action == action)
    if entity_type:
        base = base.where(AuditLog.entity_type == entity_type)
    if status:
        base = base.where(AuditLog.status == status)
    if start:
        base = base.where(AuditLog.created_at >= start)
    if end:
        base = base.where(AuditLog.created_at <= end)

    total = db.scalar(select(func.count()).select_from(base.subquery()))
    rows = (
        db.scalars(base.order_by(AuditLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    )

    user_ids: set[UUID] = {row.actor_user_id for row in rows if row.actor_user_id}
    users_by_id: dict[UUID, User] = {}
    if user_ids:
        users = db.scalars(select(User).where(User.id.in_(list(user_ids)))).all()
        users_by_id = {row.id: row for row in users}

    items = [
        AuditLogOut(
            id=row.id,
            actor_user_id=row.actor_user_id,
            actor_name=_display_name(users_by_id.get(row.actor_user_id)),
            actor_email=users_by_id.get(row.actor_user_id).email if users_by_id.get(row.actor_user_id) else None,
            action=row.action,
            entity_type=row.entity_type,
            entity_id=row.entity_id,
            status=row.status,
            details=row.details_json or {},
            ip_address=row.ip_address,
            created_at=row.created_at,
        )
        for row in rows
    ]

    return AuditLogListResponse(
        items=items,
        meta=PaginationMeta(page=page, page_size=page_size, total=int(total or 0)),
    )
