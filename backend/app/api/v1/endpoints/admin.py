from datetime import datetime, timezone
import re
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db, set_tenant_id
from app.core.config import settings
from app.models.rbac import User
from app.models.tenant import Tenant, TenantMembership
from app.modules.billing.models import Plan, Subscription, TenantModule
from app.modules.billing.service import sync_modules_from_plan
from app.multitenancy.deps import require_product_admin_host
from app.multitenancy.permissions import ROLE_MODULE_REQUIREMENTS, validate_roles_for_tenant
from app.services import auth_service, email_service
from app.schemas.tenant import (
    PlanCreate,
    PlanUpdate,
    PlanOut,
    TenantAdminInvite,
    TenantChangePlan,
    TenantCreate,
    TenantListResponse,
    TenantMemberOut,
    TenantMemberStatusUpdate,
    TenantModuleOut,
    TenantModuleUpdate,
    TenantOut,
    TenantUpdate,
    TenantSummaryOut,
    UserTenantMembershipOut,
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
        set_tenant_id(db, str(tenant.id))
        db.add(
            Subscription(
                tenant_id=tenant.id,
                plan_id=plan.id,
                status='active',
                starts_at=datetime.now(timezone.utc),
            )
        )
        sync_modules_from_plan(db, tenant_id=tenant.id, plan=plan)

    raw_token: str | None = None
    admin_user: User | None = None
    is_new_admin = False
    if payload.admin_email:
        set_tenant_id(db, str(tenant.id))
        admin_email = payload.admin_email.lower()
        admin_user = db.scalar(select(User).where(User.email == admin_email))
        if not admin_user:
            admin_user = User(
                email=admin_email,
                full_name=payload.admin_full_name or admin_email,
                hashed_password=None,
                is_active=True,
                password_change_required=True,
            )
            db.add(admin_user)
            db.flush()
            is_new_admin = True

        db.add(TenantMembership(
            tenant_id=tenant.id,
            user_id=admin_user.id,
            role='tenant_admin',
            roles_json=['tenant_admin'],
            status='active',
        ))

        if is_new_admin:
            raw_token = auth_service.create_password_set_token(db, user=admin_user, purpose='invitation', expires_hours=72)

    db.commit()

    if admin_user and is_new_admin and raw_token:
        base = settings.BASE_DOMAINS.split(',')[0].strip()
        set_password_url = f'https://{slug}.{base}/set-password?token={raw_token}'
        email_service.send_invitation(
            to_email=admin_user.email,
            to_name=admin_user.full_name or '',
            tenant_name=tenant.name,
            set_password_url=set_password_url,
            roles=['tenant_admin'],
        )
    elif admin_user and not is_new_admin:
        base = settings.BASE_DOMAINS.split(',')[0].strip()
        email_service.send_tenant_welcome(
            to_email=admin_user.email,
            to_name=admin_user.full_name or '',
            tenant_name=tenant.name,
            tenant_url=f'https://{slug}.{base}/dashboard',
            roles=['tenant_admin'],
        )

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


@router.delete('/plans/{plan_id}', status_code=status.HTTP_204_NO_CONTENT, response_model=None, dependencies=[Depends(require_product_admin_host)])
def delete_plan(
    plan_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles('super_admin')),
) -> None:
    plan = db.scalar(select(Plan).where(Plan.id == plan_id))
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Plan not found')
    active_subs = db.scalar(
        select(func.count()).select_from(Subscription).where(
            Subscription.plan_id == plan_id,
            Subscription.status.in_(['active', 'trialing']),
        )
    ) or 0
    if active_subs > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f'Cannot delete plan with {active_subs} active subscription(s). Deactivate it instead.',
        )
    db.delete(plan)
    db.commit()


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


@router.put('/tenants/{tenant_id}/plan', response_model=PlanOut, dependencies=[Depends(require_product_admin_host)])
def change_tenant_plan(
    tenant_id: UUID,
    payload: TenantChangePlan,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles('super_admin')),
) -> PlanOut:
    tenant = db.scalar(select(Tenant).where(Tenant.id == tenant_id))
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Tenant not found')

    plan = db.scalar(select(Plan).where(Plan.id == payload.plan_id, Plan.is_active == True))  # noqa: E712
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Plan not found or inactive')

    set_tenant_id(db, str(tenant_id))

    # Cancel current active subscription(s) and create a new one for the new plan.
    active_subs = db.scalars(
        select(Subscription).where(
            Subscription.tenant_id == tenant_id,
            Subscription.status.in_(['active', 'trialing']),
        )
    ).all()
    now = datetime.now(timezone.utc)
    for sub in active_subs:
        sub.status = 'canceled'
        sub.ends_at = now

    db.add(Subscription(
        tenant_id=tenant_id,
        plan_id=plan.id,
        status='active',
        starts_at=now,
    ))

    sync_modules_from_plan(db, tenant_id=tenant_id, plan=plan)
    db.commit()
    return PlanOut.model_validate(plan)


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

    extra_roles = [r.strip().lower() for r in (payload.roles or []) if r.strip()]
    extra_roles = [r for r in extra_roles if r != 'tenant_admin']
    all_roles = list(dict.fromkeys(['tenant_admin'] + extra_roles))

    tenant_module_rows = db.scalars(
        select(TenantModule).where(TenantModule.tenant_id == tenant_id, TenantModule.enabled == True)  # noqa: E712
    ).all()
    tenant_modules = {m.module_key for m in tenant_module_rows}
    invalid = validate_roles_for_tenant(all_roles, tenant_modules)
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f'Roles not allowed (module disabled): {", ".join(invalid)}',
        )

    is_new = False
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if not user:
        user = User(
            email=payload.email.lower(),
            full_name=payload.full_name,
            hashed_password=None,
            is_active=True,
            password_change_required=True,
        )
        db.add(user)
        db.flush()
        is_new = True

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
                role=all_roles[0],
                roles_json=all_roles,
                status='active',
            )
        )

    raw_token: str | None = None
    if is_new:
        raw_token = auth_service.create_password_set_token(db, user=user, purpose='invitation', expires_hours=72)

    db.commit()

    if is_new and raw_token:
        base = settings.BASE_DOMAINS.split(',')[0].strip()
        set_password_url = f'https://{tenant.slug}.{base}/set-password?token={raw_token}'
        email_service.send_invitation(
            to_email=user.email,
            to_name=user.full_name or '',
            tenant_name=tenant.name,
            set_password_url=set_password_url,
            roles=all_roles,
        )
    elif not is_new:
        base = settings.BASE_DOMAINS.split(',')[0].strip()
        email_service.send_tenant_welcome(
            to_email=user.email,
            to_name=user.full_name or '',
            tenant_name=tenant.name,
            tenant_url=f'https://{tenant.slug}.{base}/dashboard',
            roles=all_roles,
        )

    return {'status': 'ok'}


# ── Tenant member management ──────────────────────────────────────────


@router.get('/tenants/{tenant_id}/members', response_model=list[TenantMemberOut], dependencies=[Depends(require_product_admin_host)])
def list_tenant_members(
    tenant_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles('super_admin')),
) -> list[TenantMemberOut]:
    tenant = db.scalar(select(Tenant).where(Tenant.id == tenant_id))
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Tenant not found')

    set_tenant_id(db, str(tenant_id))
    memberships = db.scalars(
        select(TenantMembership).where(TenantMembership.tenant_id == tenant_id)
    ).all()

    items: list[TenantMemberOut] = []
    for m in memberships:
        user = db.scalar(select(User).where(User.id == m.user_id))
        if not user:
            continue
        items.append(TenantMemberOut(
            id=m.id,
            user_id=user.id,
            email=user.email,
            full_name=user.full_name,
            roles=m.roles(),
            status=m.status,
            created_at=m.created_at,
        ))
    return items


@router.patch('/tenants/{tenant_id}/members/{membership_id}', response_model=TenantMemberOut, dependencies=[Depends(require_product_admin_host)])
def update_tenant_member(
    tenant_id: UUID,
    membership_id: UUID,
    payload: TenantMemberStatusUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles('super_admin')),
) -> TenantMemberOut:
    if payload.status is not None and payload.status not in ('active', 'disabled'):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Status must be 'active' or 'disabled'")

    set_tenant_id(db, str(tenant_id))
    membership = db.scalar(
        select(TenantMembership).where(
            TenantMembership.id == membership_id,
            TenantMembership.tenant_id == tenant_id,
        )
    )
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Membership not found')

    if payload.status is not None:
        membership.status = payload.status
    if payload.full_name is not None:
        user = db.scalar(select(User).where(User.id == membership.user_id))
        if user:
            user.full_name = payload.full_name
    db.commit()
    db.refresh(membership)

    user = db.scalar(select(User).where(User.id == membership.user_id))
    return TenantMemberOut(
        id=membership.id,
        user_id=membership.user_id,
        email=user.email if user else '',
        full_name=user.full_name if user else None,
        roles=membership.roles(),
        status=membership.status,
        created_at=membership.created_at,
    )


@router.delete(
    '/tenants/{tenant_id}/members/{membership_id}',
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    dependencies=[Depends(require_product_admin_host)],
)
def remove_tenant_member(
    tenant_id: UUID,
    membership_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles('super_admin')),
) -> None:
    set_tenant_id(db, str(tenant_id))
    membership = db.scalar(
        select(TenantMembership).where(
            TenantMembership.id == membership_id,
            TenantMembership.tenant_id == tenant_id,
        )
    )
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Membership not found')
    db.delete(membership)
    db.commit()


@router.get('/users/{user_id}/memberships', response_model=list[UserTenantMembershipOut], dependencies=[Depends(require_product_admin_host)])
def list_user_memberships(
    user_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles('super_admin')),
) -> list[UserTenantMembershipOut]:
    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='User not found')

    current_tenant_id = db.execute(select(func.current_setting('app.tenant_id', True))).scalar()
    tenants = db.scalars(select(Tenant).order_by(Tenant.created_at.asc())).all()
    items: list[UserTenantMembershipOut] = []
    try:
        for tenant in tenants:
            set_tenant_id(db, str(tenant.id))
            membership = db.scalar(
                select(TenantMembership).where(
                    TenantMembership.tenant_id == tenant.id,
                    TenantMembership.user_id == user.id,
                )
            )
            if membership:
                items.append(
                    UserTenantMembershipOut(
                        tenant=TenantSummaryOut(
                            id=tenant.id,
                            name=tenant.name,
                            slug=tenant.slug,
                            tenant_type=tenant.tenant_type,
                            is_active=tenant.is_active,
                        ),
                        status=membership.status,
                        roles=membership.roles(),
                    )
                )
    finally:
        if current_tenant_id:
            set_tenant_id(db, str(current_tenant_id))
    return items
