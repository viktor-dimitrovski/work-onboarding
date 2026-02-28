from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.multitenancy.deps import TenantContext, require_tenant_membership
from app.multitenancy.permissions import enabled_modules, permissions_for_roles, role_label
from app.db.session import get_db
from app.schemas.tenant import TenantContextOut, TenantOut
from app.services import usage_service


router = APIRouter(prefix='/tenants', tags=['tenants'])


@router.get('/context', response_model=TenantContextOut)
def get_tenant_context(
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
) -> TenantContextOut:
    role = ctx.roles[0] if ctx.roles else None
    permissions = sorted(permissions_for_roles(ctx.roles))
    modules = sorted(enabled_modules(ctx))
    if ctx.membership:
        event = usage_service.record_daily_event(
            db=db,
            tenant_id=ctx.tenant.id,
            event_key='active_user_day',
            actor_user_id=ctx.membership.user_id,
        )
        if event:
            db.commit()
    return TenantContextOut(
        tenant=TenantOut.model_validate(ctx.tenant),
        role=role,
        role_label=role_label(ctx.tenant.tenant_type, role),
        permissions=permissions,
        modules=modules,
    )
