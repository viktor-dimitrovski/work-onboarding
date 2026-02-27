import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
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


class Plan(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'plans'
    __table_args__ = (
        UniqueConstraint('key', name='uq_plans_key'),
    )

    key: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    tenant_type_scope: Mapped[str] = mapped_column(String(20), nullable=False, default='all')
    module_defaults: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    limits_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    subscriptions: Mapped[list['Subscription']] = relationship(
        back_populates='plan', cascade='all, delete-orphan'
    )


class Subscription(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'subscriptions'
    __table_args__ = (
        CheckConstraint(
            "status in ('active', 'trialing', 'canceled')",
            name='subscription_status_values',
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('plans.id', ondelete='RESTRICT'), nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default='active')
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    tenant: Mapped['Tenant'] = relationship(back_populates='subscriptions')
    plan: Mapped['Plan'] = relationship(back_populates='subscriptions')


class TenantModule(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'tenant_modules'
    __table_args__ = (
        UniqueConstraint('tenant_id', 'module_key', name='uq_tenant_modules'),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False
    )
    module_key: Mapped[str] = mapped_column(String(50), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default='plan')

    tenant: Mapped['Tenant'] = relationship(back_populates='modules')


class UsageEvent(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'usage_events'

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True
    )
    event_key: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    quantity: Mapped[float] = mapped_column(nullable=False, default=1.0)
    meta_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)


Index('ix_tenants_slug', Tenant.slug)
Index('ix_tenant_domains_domain', TenantDomain.domain)
Index('ix_tenant_memberships_tenant', TenantMembership.tenant_id)
Index('ix_tenant_memberships_user', TenantMembership.user_id)
Index('ix_groups_tenant', Group.tenant_id)
Index('ix_group_memberships_group', GroupMembership.group_id)
Index('ix_group_memberships_user', GroupMembership.user_id)
Index('ix_plans_key', Plan.key)
Index('ix_subscriptions_tenant', Subscription.tenant_id)
Index('ix_tenant_modules_tenant', TenantModule.tenant_id)
Index('ix_usage_events_tenant', UsageEvent.tenant_id)
