from datetime import datetime, timezone
import re
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.security import hash_password
from app.db.session import get_db, set_tenant_id
from app.core.config import settings
from app.models.rbac import User
from app.models.tenant import Tenant, TenantMembership
from app.modules.billing.models import Plan, Subscription, TenantModule
from app.multitenancy.deps import require_product_admin_host
from app.schemas.tenant import (
    PlanCreate,
    PlanUpdate,
    PlanOut,
    TenantAdminInvite,
    TenantCreate,
    TenantListResponse,
    TenantModuleOut,
    TenantModuleUpdate,
    TenantOut,
    TenantUpdate,
)
from app.schemas.common import PaginationMeta


router = APIRouter(prefix='/admin', tags=['admin'])


def _validate_slug(slug: str) -> str:
    normalized = (slug or '').strip().lower()
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?', normalized):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid tenant slug')
    reserved = {item.strip().lower() for item in settings.RESERVED_SUBDOMAINS.split(',') if item.strip()}
    if normalized in reserved:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Slug is reserved')
    return normalized


def _validate_plan_key(key: str) -> str:
    normalized = (key or '').strip().lower()
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{1,48}[a-z0-9]', normalized):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid plan key')
    return normalized


@router.get('/tenants', response_model=TenantListResponse, dependencies=[Depends(require_product_admin_host)])
def list_tenants(
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles('super_admin')),
) -> TenantListResponse:
    offset = (page - 1) * page_size
    total = db.scalar(select(func.count()).select_from(Tenant))
    rows = db.scalars(
        select(Tenant).order_by(Tenant.created_at.desc()).offset(offset).limit(page_size)
    ).all()
    return TenantListResponse(
        items=[TenantOut.model_validate(row) for row in rows],
        meta=PaginationMeta(page=page, page_size=page_size, total=int(total or 0)),
    )


@router.post('/tenants', response_model=TenantOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_product_admin_host)])
def create_tenant(
    payload: TenantCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles('super_admin')),
) -> TenantOut:
    slug = _validate_slug(payload.slug)
    existing = db.scalar(select(Tenant).where(Tenant.slug == slug))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Tenant slug already exists')

    tenant = Tenant(
        name=payload.name,
        slug=slug,
        tenant_type=payload.tenant_type,
        is_active=payload.is_active,
    )
    db.add(tenant)
    db.flush()

    if payload.plan_id:
        plan = db.scalar(select(Plan).where(Plan.id == payload.plan_id))
        if not plan:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Plan not found')
        db.add(
            Subscription(
                tenant_id=tenant.id,
                plan_id=plan.id,
                status='active',
                starts_at=datetime.now(timezone.utc),
            )
        )

    db.commit()
    return TenantOut.model_validate(tenant)


@router.put('/tenants/{tenant_id}', response_model=TenantOut, dependencies=[Depends(require_product_admin_host)])
def update_tenant(
    tenant_id: UUID,
    payload: TenantUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles('super_admin')),
) -> TenantOut:
    tenant = db.scalar(select(Tenant).where(Tenant.id == tenant_id))
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Tenant not found')

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(tenant, field, value)

    db.commit()
    return TenantOut.model_validate(tenant)


@router.get('/plans', response_model=list[PlanOut], dependencies=[Depends(require_product_admin_host)])
def list_plans(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles('super_admin')),
) -> list[PlanOut]:
    plans = db.scalars(select(Plan).order_by(Plan.name.asc())).all()
    return [PlanOut.model_validate(plan) for plan in plans]


@router.post('/plans', response_model=PlanOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_product_admin_host)])
def create_plan(
    payload: PlanCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles('super_admin')),
) -> PlanOut:
    key = _validate_plan_key(payload.key)
    existing = db.scalar(select(Plan).where(Plan.key == key))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Plan key already exists')

    plan = Plan(
        key=key,
        name=payload.name,
        tenant_type_scope=payload.tenant_type_scope,
        module_defaults=payload.module_defaults,
        limits_json=payload.limits_json,
        is_active=payload.is_active,
    )
    db.add(plan)
    db.commit()
    return PlanOut.model_validate(plan)


@router.put('/plans/{plan_id}', response_model=PlanOut, dependencies=[Depends(require_product_admin_host)])
def update_plan(
    plan_id: UUID,
    payload: PlanUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles('super_admin')),
) -> PlanOut:
    plan = db.scalar(select(Plan).where(Plan.id == plan_id))
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Plan not found')

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(plan, field, value)
    db.commit()
    return PlanOut.model_validate(plan)


@router.get('/tenants/{tenant_id}/modules', response_model=list[TenantModuleOut], dependencies=[Depends(require_product_admin_host)])
def list_tenant_modules(
    tenant_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles('super_admin')),
) -> list[TenantModuleOut]:
    set_tenant_id(db, str(tenant_id))
    rows = db.scalars(select(TenantModule).where(TenantModule.tenant_id == tenant_id)).all()
    return [TenantModuleOut(module_key=row.module_key, enabled=row.enabled, source=row.source) for row in rows]


@router.put('/tenants/{tenant_id}/modules', response_model=list[TenantModuleOut], dependencies=[Depends(require_product_admin_host)])
def update_tenant_modules(
    tenant_id: UUID,
    payload: list[TenantModuleUpdate],
    db: Session = Depends(get_db),
    _: User = Depends(require_roles('super_admin')),
) -> list[TenantModuleOut]:
    set_tenant_id(db, str(tenant_id))
    db.query(TenantModule).where(TenantModule.tenant_id == tenant_id).delete()
    for item in payload:
        db.add(
            TenantModule(
                tenant_id=tenant_id,
                module_key=item.module_key,
                enabled=item.enabled,
                source='override',
            )
        )
    db.commit()
    rows = db.scalars(select(TenantModule).where(TenantModule.tenant_id == tenant_id)).all()
    return [TenantModuleOut(module_key=row.module_key, enabled=row.enabled, source=row.source) for row in rows]


@router.post('/tenants/{tenant_id}/admins', dependencies=[Depends(require_product_admin_host)])
def invite_tenant_admin(
    tenant_id: UUID,
    payload: TenantAdminInvite,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles('super_admin')),
) -> dict[str, str]:
    tenant = db.scalar(select(Tenant).where(Tenant.id == tenant_id))
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Tenant not found')

    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if not user:
        if not payload.password:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Password required for new user')
        user = User(
            email=payload.email.lower(),
            full_name=payload.full_name,
            hashed_password=hash_password(payload.password),
            is_active=True,
        )
        db.add(user)
        db.flush()

    set_tenant_id(db, str(tenant_id))
    membership = db.scalar(
        select(TenantMembership).where(
            TenantMembership.tenant_id == tenant_id,
            TenantMembership.user_id == user.id,
        )
    )
    if not membership:
        db.add(
            TenantMembership(
                tenant_id=tenant_id,
                user_id=user.id,
                role='tenant_admin',
                status='active',
            )
        )
    db.commit()
    return {'status': 'ok'}
