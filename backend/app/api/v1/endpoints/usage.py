from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.models.rbac import User
from app.multitenancy.deps import TenantContext, require_tenant_membership
from app.multitenancy.permissions import require_access
from app.schemas.tenant import UsageEventSummary, UsageSummaryResponse
from app.services import usage_service


router = APIRouter(prefix='/usage', tags=['usage'])


@router.get('/summary', response_model=UsageSummaryResponse)
def usage_summary(
    from_date: datetime | None = Query(default=None),
    to_date: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('billing', 'billing:read')),
) -> UsageSummaryResponse:
    items = usage_service.summarize_usage(db, tenant_id=ctx.tenant.id, from_date=from_date, to_date=to_date)
    return UsageSummaryResponse(
        tenant_id=ctx.tenant.id,
        from_date=from_date,
        to_date=to_date,
        items=[UsageEventSummary(event_key=key, total_quantity=total) for key, total in items],
    )
