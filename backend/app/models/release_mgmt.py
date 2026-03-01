from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKeyConstraint, Index, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.mixins import AuditUserMixin, TimestampMixin, UUIDPrimaryKeyMixin


RELEASE_MGMT_SCHEMA = 'release_mgmt'


class ReleaseWorkOrder(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'work_orders'
    __table_args__ = (
        UniqueConstraint('tenant_id', 'id', name='uq_release_mgmt_work_orders_tenant_id'),
        UniqueConstraint('tenant_id', 'wo_id', name='uq_release_mgmt_work_orders_wo_id'),
        CheckConstraint(
            "sync_status in ('pending','synced','failed','disabled')",
            name='ck_release_mgmt_work_orders_sync_status',
        ),
        {'schema': RELEASE_MGMT_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    wo_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    wo_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    status: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    risk: Mapped[str | None] = mapped_column(String(20), nullable=True)
    owner: Mapped[str | None] = mapped_column(String(120), nullable=True)
    requested_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    tenants_impacted: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    target_envs: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    postman_testing_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    body_markdown: Mapped[str] = mapped_column(Text, nullable=False, default='')
    raw_markdown: Mapped[str] = mapped_column(Text, nullable=False, default='')

    git_repo_full_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    git_folder_path: Mapped[str | None] = mapped_column(String(200), nullable=True)
    git_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    git_branch: Mapped[str | None] = mapped_column(String(120), nullable=True)
    git_sha: Mapped[str | None] = mapped_column(String(120), nullable=True)
    pr_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sync_status: Mapped[str] = mapped_column(String(20), nullable=False, default='pending', index=True)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_sync_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    sync_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    services: Mapped[list['ReleaseWorkOrderService']] = relationship(
        back_populates='work_order', cascade='all, delete-orphan'
    )


class ReleaseWorkOrderService(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'work_order_services'
    __table_args__ = (
        ForeignKeyConstraint(
            ['tenant_id', 'work_order_id'],
            [f'{RELEASE_MGMT_SCHEMA}.work_orders.tenant_id', f'{RELEASE_MGMT_SCHEMA}.work_orders.id'],
            ondelete='CASCADE',
        ),
        {'schema': RELEASE_MGMT_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    work_order_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    order_index: Mapped[int] = mapped_column(nullable=False, default=0)
    service_id: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    repo: Mapped[str | None] = mapped_column(String(200), nullable=True)
    change_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    requires_deploy: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    requires_db_migration: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    requires_config_change: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    feature_flags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    release_notes_ref: Mapped[str | None] = mapped_column(Text, nullable=True)

    work_order: Mapped['ReleaseWorkOrder'] = relationship(back_populates='services')


class ReleaseManifest(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'release_manifests'
    __table_args__ = (
        UniqueConstraint('tenant_id', 'rel_id', name='uq_release_mgmt_release_manifests_rel_id'),
        CheckConstraint(
            "sync_status in ('pending','synced','failed','disabled')",
            name='ck_release_mgmt_release_manifests_sync_status',
        ),
        {'schema': RELEASE_MGMT_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    rel_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    env: Mapped[str | None] = mapped_column(String(60), nullable=True)
    window: Mapped[str | None] = mapped_column(String(120), nullable=True)
    includes_work_orders: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    versions: Mapped[dict[str, str]] = mapped_column(JSONB, nullable=False, default=dict)
    release_notes: Mapped[dict[str, str]] = mapped_column(JSONB, nullable=False, default=dict)
    deploy_list: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    raw_markdown: Mapped[str] = mapped_column(Text, nullable=False, default='')

    git_repo_full_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    git_folder_path: Mapped[str | None] = mapped_column(String(200), nullable=True)
    git_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    git_branch: Mapped[str | None] = mapped_column(String(120), nullable=True)
    git_sha: Mapped[str | None] = mapped_column(String(120), nullable=True)
    pr_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sync_status: Mapped[str] = mapped_column(String(20), nullable=False, default='pending', index=True)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_sync_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    sync_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ReleasePlan(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'release_plans'
    __table_args__ = (
        UniqueConstraint('tenant_id', 'assignment_id', name='uq_release_mgmt_release_plans_assignment'),
        ForeignKeyConstraint(
            ['tenant_id', 'assignment_id'],
            ['onboarding_assignments.tenant_id', 'onboarding_assignments.id'],
            ondelete='CASCADE',
        ),
        ForeignKeyConstraint(['release_manager_user_id'], ['users.id'], ondelete='SET NULL'),
        {'schema': RELEASE_MGMT_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    assignment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    environment: Mapped[str | None] = mapped_column(String(60), nullable=True)
    version_tag: Mapped[str | None] = mapped_column(String(80), nullable=True)
    release_manager_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    rel_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    links_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)


Index('ix_release_mgmt_release_plans_tenant', ReleasePlan.tenant_id)
Index('ix_release_mgmt_release_plans_assignment', ReleasePlan.assignment_id)
