from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, require_roles
from app.db.session import get_db
from app.models.rbac import User
from app.schemas.common import PaginationMeta
from app.schemas.user import UserCreate, UserListResponse, UserOut
from app.services import audit_service, user_service


router = APIRouter(prefix='/users', tags=['users'])


def _to_user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_active=user.is_active,
        roles=user_service.get_user_roles(user),
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


@router.get('', response_model=UserListResponse)
def list_users(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    role: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles('super_admin', 'admin', 'hr_viewer')),
) -> UserListResponse:
    users, total = user_service.list_users(db, page=page, page_size=page_size, role=role)
    return UserListResponse(
        items=[_to_user_out(user) for user in users],
        meta=PaginationMeta(page=page, page_size=page_size, total=total),
    )


@router.post('', response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('super_admin', 'admin')),
) -> UserOut:
    user = user_service.create_user(db, payload=payload, actor_user_id=current_user.id)
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='user_create',
        entity_type='user',
        entity_id=user.id,
        details={'email': user.email, 'roles': user_service.get_user_roles(user)},
    )
    db.commit()

    return _to_user_out(user)
