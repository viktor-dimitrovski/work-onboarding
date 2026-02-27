import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.constants import ROLE_VALUES
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.token import RefreshToken


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'users'
    __table_args__ = (
        UniqueConstraint('oauth_provider', 'oauth_provider_id', name='uq_users_oauth_provider'),
    )

    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    oauth_provider: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    oauth_provider_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user_roles: Mapped[list['UserRole']] = relationship(back_populates='user', cascade='all, delete-orphan')
    refresh_tokens: Mapped[list['RefreshToken']] = relationship(back_populates='user', cascade='all, delete-orphan')


class Role(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'roles'
    __table_args__ = (
        CheckConstraint(
            "name in ('super_admin', 'admin', 'mentor', 'employee', 'hr_viewer', 'reviewer')",
            name='role_name_values',
        ),
    )

    name: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)

    user_roles: Mapped[list['UserRole']] = relationship(back_populates='role', cascade='all, delete-orphan')


class UserRole(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'user_roles'
    __table_args__ = (UniqueConstraint('user_id', 'role_id', name='uq_user_roles_user_role'),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('roles.id', ondelete='CASCADE'), nullable=False
    )

    user: Mapped['User'] = relationship(back_populates='user_roles')
    role: Mapped['Role'] = relationship(back_populates='user_roles')


Index('ix_user_roles_user_id', UserRole.user_id)
Index('ix_user_roles_role_id', UserRole.role_id)

if len(ROLE_VALUES) == 0:
    raise RuntimeError('ROLE_VALUES must not be empty')
