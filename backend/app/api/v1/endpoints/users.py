from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_user_role_names
from app.core.config import settings
from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.rbac import User
from app.models.tenant import TenantMembership
from app.multitenancy.deps import TenantContext, require_tenant_membership
from app.multitenancy.permissions import ROLE_MODULE_REQUIREMENTS, enabled_modules, require_access, require_permission, validate_roles_for_tenant
from app.schemas.audit import AuditLogListResponse, AuditLogOut
from app.schemas.common import PaginationMeta
from app.schemas.user import TenantMembershipUpdate, UserAddExisting, UserCreate, UserListResponse, UserOut
from app.services import audit_service, auth_service, email_service, user_service


router = APIRouter(prefix='/users', tags=['users'])


def _tenant_url(slug: str, path: str = '/dashboard') -> str:
    base = settings.BASE_DOMAINS.split(',')[0].strip()
    return f'https://{slug}.{base}{path}'


def _check_roles_allowed(roles: list[str], ctx: TenantContext, current_user: User) -> None:
    """Raise 400 if any role requires a module that is disabled for the tenant,
    or if the caller tries to grant module-specific roles they don't hold.
    Super_admin bypasses all checks."""
    if 'super_admin' in get_user_role_names(current_user):
        return
    invalid = validate_roles_for_tenant(roles, enabled_modules(ctx))
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f'Roles not allowed (module disabled): {", ".join(invalid)}',
        )
    caller_roles = set(ctx.roles or [])
    # tenant_admin can grant tenant_admin to peers (identity-level, no module escalation).
    # Every other role — including supervisor — requires the caller to hold it.
    FREELY_GRANTABLE = {'tenant_admin'}
    escalated = [
        r for r in roles
        if r not in FREELY_GRANTABLE and r not in caller_roles
    ]
    if escalated:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f'Cannot grant roles you do not hold: {", ".join(escalated)}',
        )


def _to_user_out(
    user: User,
    *,
    tenant_roles: list[str] | None = None,
    tenant_status: str | None = None,
) -> UserOut:
    roles = [r for r in (tenant_roles or []) if isinstance(r, str) and r.strip()]
    primary_role = roles[0] if roles else None
    return UserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_active=user.is_active,
        roles=user_service.get_user_roles(user),
        last_login_at=user.last_login_at,
        tenant_role=primary_role,
        tenant_roles=roles,
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
    __: object = Depends(require_permission('users:read')),
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
            _to_user_out(user, tenant_roles=tenant_roles, tenant_status=tenant_status)
            for user, tenant_roles, tenant_status in users
        ],
        meta=PaginationMeta(page=page, page_size=page_size, total=total),
    )


@router.post('', response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_permission('users:write')),
) -> UserOut:
    email = payload.email.lower()
    tenant_roles = [r.strip().lower() for r in (payload.tenant_roles or []) if r.strip()]
    if not tenant_roles and payload.tenant_role:
        tenant_roles = [payload.tenant_role.strip().lower()]
    tenant_roles = list(dict.fromkeys(tenant_roles))
    if not tenant_roles:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='At least one tenant role is required')
    _check_roles_allowed(tenant_roles, ctx, current_user)

    user = db.scalar(select(User).where(User.email == email))
    created = False
    if not user:
        if not payload.full_name or not payload.password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail='full_name and password are required when creating a new user',
            )
        user = user_service.create_user(db, payload=payload, actor_user_id=current_user.id)
        created = True

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
            role=tenant_roles[0],
            roles_json=tenant_roles,
            status='active',
        )
        db.add(membership)
    else:
        membership.role = tenant_roles[0]
        membership.roles_json = tenant_roles
        membership.status = 'active'

    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='user_create',
        entity_type='user',
        entity_id=user.id,
        details={
            'email': user.email,
            'created': created,
            'roles': user_service.get_user_roles(user),
            'tenant_roles': tenant_roles,
        },
    )

    raw_token: str | None = None
    if created:
        raw_token = auth_service.create_password_set_token(db, user=user, purpose='invitation', expires_hours=72)

    db.commit()

    if created and raw_token:
        set_password_url = f'{_tenant_url(ctx.tenant.slug, "/set-password")}?token={raw_token}'
        email_service.send_invitation(
            to_email=user.email,
            to_name=user.full_name or '',
            tenant_name=ctx.tenant.name,
            set_password_url=set_password_url,
            roles=tenant_roles,
        )
    elif not created:
        email_service.send_tenant_welcome(
            to_email=user.email,
            to_name=user.full_name or '',
            tenant_name=ctx.tenant.name,
            tenant_url=_tenant_url(ctx.tenant.slug),
            roles=tenant_roles,
        )

    return _to_user_out(user, tenant_roles=tenant_roles, tenant_status=membership.status if membership else None)


@router.post('/add-existing', response_model=UserOut)
def add_existing_user_to_tenant(
    payload: UserAddExisting,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_permission('users:write')),
) -> UserOut:
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='User not found')

    tenant_roles = [r.strip().lower() for r in (payload.tenant_roles or []) if r.strip()]
    if not tenant_roles and payload.tenant_role:
        tenant_roles = [payload.tenant_role.strip().lower()]
    tenant_roles = list(dict.fromkeys(tenant_roles))
    if not tenant_roles:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='At least one tenant role is required')
    _check_roles_allowed(tenant_roles, ctx, current_user)

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
            role=tenant_roles[0],
            roles_json=tenant_roles,
            status='active',
        )
        db.add(membership)
    else:
        membership.role = tenant_roles[0]
        membership.roles_json = tenant_roles
        membership.status = 'active'

    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='tenant_user_add',
        entity_type='user',
        entity_id=user.id,
        details={'email': user.email, 'tenant_roles': tenant_roles},
    )
    db.commit()

    email_service.send_tenant_welcome(
        to_email=user.email,
        to_name=user.full_name or '',
        tenant_name=ctx.tenant.name,
        tenant_url=_tenant_url(ctx.tenant.slug),
        roles=tenant_roles,
    )

    return _to_user_out(user, tenant_roles=membership.roles(), tenant_status=membership.status)


@router.put('/{user_id}/membership', response_model=UserOut)
def update_tenant_membership(
    user_id: str,
    payload: TenantMembershipUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_permission('users:write')),
) -> UserOut:
    if str(user_id) == str(current_user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Cannot modify your own roles')

    membership = db.scalar(
        select(TenantMembership).where(
            TenantMembership.tenant_id == ctx.tenant.id,
            TenantMembership.user_id == user_id,
        )
    )
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Membership not found')

    if payload.roles is not None:
        roles = [r.strip().lower() for r in payload.roles if isinstance(r, str) and r.strip()]
        roles = list(dict.fromkeys(roles))
        if not roles:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='At least one tenant role is required')
        _check_roles_allowed(roles, ctx, current_user)
        membership.roles_json = roles
        membership.role = roles[0]
    elif payload.role is not None:
        _check_roles_allowed([payload.role.strip().lower()], ctx, current_user)
        membership.role = payload.role.strip().lower()
        membership.roles_json = [membership.role]
    if payload.status is not None:
        membership.status = payload.status
    if payload.full_name is not None:
        user_for_name = db.scalar(select(User).where(User.id == membership.user_id))
        if user_for_name:
            user_for_name.full_name = payload.full_name

    updated_roles = membership.roles()
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='tenant_membership_update',
        entity_type='user',
        entity_id=membership.user_id,
        details={
            'tenant_roles': updated_roles,
            'tenant_status': membership.status,
        },
    )
    db.commit()

    user = db.scalar(select(User).where(User.id == membership.user_id))
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='User not found')

    if payload.roles is not None or payload.role is not None:
        email_service.send_roles_updated(
            to_email=user.email,
            to_name=user.full_name or '',
            tenant_name=ctx.tenant.name,
            tenant_url=_tenant_url(ctx.tenant.slug),
            roles=updated_roles,
        )

    return _to_user_out(user, tenant_roles=membership.roles(), tenant_status=membership.status)


@router.delete('/{user_id}/membership', status_code=status.HTTP_204_NO_CONTENT)
def remove_user_from_tenant(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_permission('users:write')),
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


def _display_name(user: User | None) -> str | None:
    if not user:
        return None
    return (user.full_name or '').strip() or (user.email or '').strip() or None


@router.get('/{user_id}/activity', response_model=AuditLogListResponse)
def user_activity(
    user_id: UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('settings', 'settings:manage')),
    ___: TenantContext = Depends(require_tenant_membership),
) -> AuditLogListResponse:
    base = select(AuditLog).where(or_(AuditLog.actor_user_id == user_id, AuditLog.entity_id == user_id))
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    rows = (
        db.scalars(base.order_by(AuditLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    )

    actor_ids: set[UUID] = {row.actor_user_id for row in rows if row.actor_user_id}
    users_by_id: dict[UUID, User] = {}
    if actor_ids:
        users_by_id = {row.id: row for row in db.scalars(select(User).where(User.id.in_(list(actor_ids)))).all()}

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
