from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.models.rbac import User
from app.models.tenant import TenantMembership
from app.multitenancy.deps import TenantContext, require_tenant_membership
from app.multitenancy.permissions import require_access
from app.schemas.common import PaginationMeta
from app.schemas.user import TenantMembershipUpdate, UserAddExisting, UserCreate, UserListResponse, UserOut
from app.services import audit_service, user_service


router = APIRouter(prefix='/users', tags=['users'])


def _to_user_out(user: User, *, tenant_role: str | None = None, tenant_status: str | None = None) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_active=user.is_active,
        roles=user_service.get_user_roles(user),
        tenant_role=tenant_role,
        tenant_status=tenant_status,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


@router.get('', response_model=UserListResponse)
def list_users(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    role: str | None = Query(default=None),
    include_disabled: bool = Query(default=False),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('users', 'users:read')),
) -> UserListResponse:
    users, total = user_service.list_tenant_users(
        db,
        tenant_id=ctx.tenant.id,
        page=page,
        page_size=page_size,
        role=role,
    )
    if not include_disabled:
        users = [row for row in users if row[2] == 'active']
    return UserListResponse(
        items=[
            _to_user_out(user, tenant_role=tenant_role, tenant_status=tenant_status)
            for user, tenant_role, tenant_status in users
        ],
        meta=PaginationMeta(page=page, page_size=page_size, total=total),
    )


@router.post('', response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('users', 'users:write')),
) -> UserOut:
    user = user_service.create_user(db, payload=payload, actor_user_id=current_user.id)
    tenant_role = payload.tenant_role or 'member'
    db.add(
        TenantMembership(
            tenant_id=ctx.tenant.id,
            user_id=user.id,
            role=tenant_role,
            status='active',
        )
    )
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='user_create',
        entity_type='user',
        entity_id=user.id,
        details={'email': user.email, 'roles': user_service.get_user_roles(user), 'tenant_role': tenant_role},
    )
    db.commit()

    return _to_user_out(user, tenant_role=tenant_role)


@router.post('/add-existing', response_model=UserOut)
def add_existing_user_to_tenant(
    payload: UserAddExisting,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('users', 'users:write')),
) -> UserOut:
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='User not found')

    membership = db.scalar(
        select(TenantMembership).where(
            TenantMembership.tenant_id == ctx.tenant.id,
            TenantMembership.user_id == user.id,
        )
    )
    if not membership:
        membership = TenantMembership(
            tenant_id=ctx.tenant.id,
            user_id=user.id,
            role=payload.tenant_role or 'member',
            status='active',
        )
        db.add(membership)
    else:
        membership.role = payload.tenant_role or membership.role
        membership.status = 'active'

    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='tenant_user_add',
        entity_type='user',
        entity_id=user.id,
        details={'email': user.email, 'tenant_role': membership.role},
    )
    db.commit()
    return _to_user_out(user, tenant_role=membership.role, tenant_status=membership.status)


@router.put('/{user_id}/membership', response_model=UserOut)
def update_tenant_membership(
    user_id: str,
    payload: TenantMembershipUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('users', 'users:write')),
) -> UserOut:
    membership = db.scalar(
        select(TenantMembership).where(
            TenantMembership.tenant_id == ctx.tenant.id,
            TenantMembership.user_id == user_id,
        )
    )
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Membership not found')

    if payload.role is not None:
        membership.role = payload.role
    if payload.status is not None:
        membership.status = payload.status

    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='tenant_membership_update',
        entity_type='user',
        entity_id=membership.user_id,
        details={'tenant_role': membership.role, 'tenant_status': membership.status},
    )
    db.commit()

    user = db.scalar(select(User).where(User.id == membership.user_id))
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='User not found')
    return _to_user_out(user, tenant_role=membership.role, tenant_status=membership.status)


@router.delete('/{user_id}/membership', status_code=status.HTTP_204_NO_CONTENT)
def remove_user_from_tenant(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('users', 'users:write')),
) -> None:
    membership = db.scalar(
        select(TenantMembership).where(
            TenantMembership.tenant_id == ctx.tenant.id,
            TenantMembership.user_id == user_id,
        )
    )
    if not membership:
        return

    db.delete(membership)
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='tenant_user_remove',
        entity_type='user',
        entity_id=membership.user_id,
        details={},
    )
    db.commit()
