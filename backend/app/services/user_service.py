from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.core.security import hash_password
from app.models.rbac import Role, User, UserRole
from app.models.tenant import TenantMembership
from app.schemas.user import UserCreate


def _normalize_roles(role_names: list[str]) -> list[str]:
    return sorted({role.strip().lower() for role in role_names if role.strip()})


def _user_to_roles(user: User) -> list[str]:
    return [user_role.role.name for user_role in user.user_roles]


def create_user(db: Session, *, payload: UserCreate, actor_user_id: UUID | None) -> User:
    existing = db.scalar(select(User).where(User.email == payload.email.lower()))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Email already registered')

    user = User(
        email=payload.email.lower(),
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
        is_active=True,
        password_change_required=True,
    )
    db.add(user)
    db.flush()

    # Global identity roles (user_roles) — only super_admin exists today. Tenant-scoped
    # permissions live on TenantMembership.roles_json; do NOT default to legacy "employee".
    roles = _normalize_roles(payload.roles or [])
    if roles:
        role_rows = db.scalars(select(Role).where(Role.name.in_(roles))).all()
        if len(role_rows) != len(roles):
            found = {row.name for row in role_rows}
            missing = sorted(set(roles) - found)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f'Invalid roles: {", ".join(missing)}',
            )

        for role in role_rows:
            db.add(UserRole(user_id=user.id, role_id=role.id))

    db.flush()
    db.refresh(user)
    return db.scalar(
        select(User)
        .where(User.id == user.id)
        .options(joinedload(User.user_roles).joinedload(UserRole.role))
    )


def list_users(
    db: Session,
    *,
    page: int,
    page_size: int,
    role: str | None,
) -> tuple[list[User], int]:
    base_query = select(User).options(joinedload(User.user_roles).joinedload(UserRole.role))

    if role:
        base_query = base_query.join(User.user_roles).join(UserRole.role).where(Role.name == role)

    total = db.scalar(select(func.count()).select_from(base_query.subquery()))
    rows = db.scalars(
        base_query.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).unique().all()
    return rows, int(total or 0)


def list_tenant_users(
    db: Session,
    *,
    tenant_id: UUID,
    page: int,
    page_size: int,
    role: str | None,
) -> tuple[list[tuple[User, list[str], str]], int]:
    count_query = (
        select(func.count())
        .select_from(User)
        .join(TenantMembership, TenantMembership.user_id == User.id)
        .where(TenantMembership.tenant_id == tenant_id)
    )
    if role:
        count_query = count_query.where(TenantMembership.roles_json.contains([role]))
    total = db.scalar(count_query)

    page_query = (
        select(User.id, TenantMembership.roles_json, TenantMembership.status)
        .join(TenantMembership, TenantMembership.user_id == User.id)
        .where(TenantMembership.tenant_id == tenant_id)
    )
    if role:
        page_query = page_query.where(TenantMembership.roles_json.contains([role]))

    page_rows = db.execute(
        page_query.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()

    user_ids = [row[0] for row in page_rows]
    users_by_id: dict[UUID, User] = {}
    if user_ids:
        users = (
            db.scalars(
                select(User)
                .where(User.id.in_(user_ids))
                .options(joinedload(User.user_roles).joinedload(UserRole.role))
            )
            .unique()
            .all()
        )
        users_by_id = {row.id: row for row in users}

    rows: list[tuple[User, list[str], str]] = []
    for user_id, roles_json, status in page_rows:
        user = users_by_id.get(user_id)
        if not user:
            continue
        roles = [r for r in (roles_json or []) if isinstance(r, str) and r.strip()]
        rows.append((user, roles, status))

    return rows, int(total or 0)


def get_user_roles(user: User) -> list[str]:
    return _user_to_roles(user)
