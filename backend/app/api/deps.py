from collections.abc import Callable
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.security import TokenDecodeError, decode_access_token
from app.db.session import get_db
from app.models.rbac import User, UserRole


oauth2_scheme = OAuth2PasswordBearer(tokenUrl='/api/v1/auth/login')


def get_current_user(db: Session = Depends(get_db), token: str = Depends(oauth2_scheme)) -> User:
    try:
        payload = decode_access_token(token)
        subject = payload.get('sub')
        if not subject:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid access token subject')
        user_id = UUID(subject)
    except (TokenDecodeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid access token') from exc

    user = db.scalar(
        select(User)
        .where(User.id == user_id)
        .options(joinedload(User.user_roles).joinedload(UserRole.role))
    )

    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='User not found')

    return user


def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Inactive user')
    return current_user


def get_user_role_names(current_user: User) -> set[str]:
    return {user_role.role.name for user_role in current_user.user_roles}


def require_roles(*required_roles: str) -> Callable:
    required_set = set(required_roles)

    def role_checker(current_user: User = Depends(get_current_active_user)) -> User:
        user_roles = get_user_role_names(current_user)
        if 'super_admin' in user_roles:
            return current_user

        if not required_set.intersection(user_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail='Insufficient role permissions',
            )
        return current_user

    return role_checker
