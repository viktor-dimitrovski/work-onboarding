from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    hash_token,
    verify_password,
)
from app.models.rbac import User, UserRole
from app.models.token import RefreshToken


class AuthError(Exception):
    pass


def get_user_with_roles(db: Session, user_id: UUID) -> User | None:
    return db.scalar(
        select(User)
        .where(User.id == user_id)
        .options(joinedload(User.user_roles).joinedload(UserRole.role))
    )


def authenticate_user(db: Session, email: str, password: str) -> User | None:
    user = db.scalar(
        select(User)
        .where(User.email == email.lower())
        .options(joinedload(User.user_roles).joinedload(UserRole.role))
    )
    if not user:
        return None
    if not user.is_active:
        return None
    if not user.hashed_password:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


def _token_expiration(days: int) -> datetime:
    return datetime.now(UTC) + timedelta(days=days)


def issue_token_pair(
    db: Session,
    *,
    user: User,
    ip_address: str | None,
    user_agent: str | None,
) -> tuple[str, str]:
    access_token = create_access_token(str(user.id))
    refresh_token = create_refresh_token(str(user.id))

    refresh_entity = RefreshToken(
        user_id=user.id,
        token_hash=hash_token(refresh_token),
        expires_at=_token_expiration(settings.REFRESH_TOKEN_EXPIRE_DAYS),
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(refresh_entity)

    user.last_login_at = datetime.now(UTC)
    db.flush()
    return access_token, refresh_token


def refresh_token_pair(
    db: Session,
    *,
    refresh_token: str,
    ip_address: str | None,
    user_agent: str | None,
) -> tuple[User, str, str]:
    payload = decode_refresh_token(refresh_token)
    user_id = payload.get('sub')
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid refresh token')

    token_hash = hash_token(refresh_token)
    token_entity = db.scalar(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked_at.is_(None),
            RefreshToken.expires_at > datetime.now(UTC),
        )
    )

    if not token_entity:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Refresh token revoked or expired')

    user = get_user_with_roles(db, UUID(user_id))
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='User not active')

    token_entity.revoked_at = datetime.now(UTC)
    access_token, new_refresh = issue_token_pair(
        db,
        user=user,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.flush()

    return user, access_token, new_refresh


def revoke_refresh_token(db: Session, *, refresh_token: str) -> bool:
    token_hash = hash_token(refresh_token)
    token_entity = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    if not token_entity:
        return False

    if token_entity.revoked_at is None:
        token_entity.revoked_at = datetime.now(UTC)
        db.flush()
    return True
