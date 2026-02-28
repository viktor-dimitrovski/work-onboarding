import uuid

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Tenant(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'tenants'
    __table_args__ = (
        UniqueConstraint('slug', name='uq_tenants_slug'),
        CheckConstraint(
            "tenant_type in ('company', 'education')",
            name='tenant_type_values',
        ),
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(63), nullable=False, index=True)
    tenant_type: Mapped[str] = mapped_column(String(20), nullable=False, default='company')
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    domains: Mapped[list['TenantDomain']] = relationship(
        back_populates='tenant', cascade='all, delete-orphan'
    )
    memberships: Mapped[list['TenantMembership']] = relationship(
        back_populates='tenant', cascade='all, delete-orphan'
    )
    modules: Mapped[list['TenantModule']] = relationship(
        back_populates='tenant', cascade='all, delete-orphan'
    )
    subscriptions: Mapped[list['Subscription']] = relationship(
        back_populates='tenant', cascade='all, delete-orphan'
    )


class TenantDomain(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'tenant_domains'
    __table_args__ = (
        UniqueConstraint('domain', name='uq_tenant_domains_domain'),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False
    )
    domain: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    tenant: Mapped['Tenant'] = relationship(back_populates='domains')


class TenantMembership(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'tenant_memberships'
    __table_args__ = (
        UniqueConstraint('tenant_id', 'user_id', name='uq_tenant_membership'),
        CheckConstraint(
            "status in ('active', 'invited', 'disabled')",
            name='tenant_membership_status_values',
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False
    )
    role: Mapped[str] = mapped_column(String(50), nullable=False, default='member')
    status: Mapped[str] = mapped_column(String(20), nullable=False, default='active')

    tenant: Mapped['Tenant'] = relationship(back_populates='memberships')


class Group(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'groups'
    __table_args__ = (
        CheckConstraint(
            "group_type in ('team', 'class')",
            name='group_type_values',
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False
    )
    group_type: Mapped[str] = mapped_column(String(20), nullable=False, default='team')
    name: Mapped[str] = mapped_column(String(200), nullable=False)

    memberships: Mapped[list['GroupMembership']] = relationship(
        back_populates='group', cascade='all, delete-orphan'
    )


class GroupMembership(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'group_memberships'
    __table_args__ = (
        UniqueConstraint('group_id', 'user_id', name='uq_group_membership'),
    )

    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('groups.id', ondelete='CASCADE'), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False
    )
    role: Mapped[str | None] = mapped_column(String(50), nullable=True)

    group: Mapped['Group'] = relationship(back_populates='memberships')


Index('ix_tenants_slug', Tenant.slug)
Index('ix_tenant_domains_domain', TenantDomain.domain)
Index('ix_tenant_memberships_tenant', TenantMembership.tenant_id)
Index('ix_tenant_memberships_user', TenantMembership.user_id)
Index('ix_groups_tenant', Group.tenant_id)
Index('ix_group_memberships_group', GroupMembership.group_id)
Index('ix_group_memberships_user', GroupMembership.user_id)
