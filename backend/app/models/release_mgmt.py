from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, ForeignKeyConstraint, Index, Integer, String, Text, UniqueConstraint, text
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
    branch: Mapped[str | None] = mapped_column(String(120), nullable=True)
    release_notes_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    release_note_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('release_mgmt.release_notes.id', ondelete='SET NULL'),
        nullable=True,
        index=True,
    )

    work_order: Mapped['ReleaseWorkOrder'] = relationship(back_populates='services')
    release_note: Mapped['ReleaseNote | None'] = relationship()


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


class DataCenter(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'data_centers'
    __table_args__ = (
        UniqueConstraint('tenant_id', 'slug', name='uq_release_mgmt_data_centers_slug'),
        {'schema': RELEASE_MGMT_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    location: Mapped[str | None] = mapped_column(String(120), nullable=True)
    cluster_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    k8s_context: Mapped[str | None] = mapped_column(String(120), nullable=True)
    environment: Mapped[str] = mapped_column(String(30), nullable=False, default='production')
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_dr: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    platform_releases: Mapped[list['PlatformRelease']] = relationship(back_populates='data_center')
    dc_deployments: Mapped[list['WODCDeployment']] = relationship(back_populates='data_center')
    deployment_runs: Mapped[list['DeploymentRun']] = relationship(back_populates='data_center')


class ReleaseNote(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'release_notes'
    __table_args__ = (
        UniqueConstraint('tenant_id', 'repo', 'branch', 'tag', name='uq_release_mgmt_release_notes_version'),
        CheckConstraint("status in ('draft','published','approved')", name='ck_release_mgmt_release_notes_status'),
        CheckConstraint("component_type in ('service','config')", name='ck_release_mgmt_release_notes_component_type'),
        {'schema': RELEASE_MGMT_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    repo: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    branch: Mapped[str | None] = mapped_column(String(120), nullable=True)
    service_name: Mapped[str] = mapped_column(String(200), nullable=False)
    component_type: Mapped[str] = mapped_column(String(20), nullable=False, default='service')
    tag: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default='draft', index=True)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    items: Mapped[list['ReleaseNoteItem']] = relationship(
        back_populates='release_note',
        cascade='all, delete-orphan',
        order_by='ReleaseNoteItem.order_index',
    )
    authors: Mapped[list['ReleaseNoteAuthor']] = relationship(
        back_populates='release_note',
        cascade='all, delete-orphan',
    )


class ReleaseNoteItem(Base):
    __tablename__ = 'release_note_items'
    __table_args__ = (
        CheckConstraint(
            "item_type in ('feature','bug_fix','security','api_change','breaking_change','config_change')",
            name='ck_release_mgmt_release_note_items_type',
        ),
        {'schema': RELEASE_MGMT_SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    release_note_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('release_mgmt.release_notes.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    item_type: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    migration_step: Mapped[str | None] = mapped_column(Text, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text('now()'))

    release_note: Mapped['ReleaseNote'] = relationship(back_populates='items')


class ReleaseNoteAuthor(Base):
    __tablename__ = 'release_note_authors'
    __table_args__ = (
        {'schema': RELEASE_MGMT_SCHEMA},
    )

    release_note_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('release_mgmt.release_notes.id', ondelete='CASCADE'),
        primary_key=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text('now()'))

    release_note: Mapped['ReleaseNote'] = relationship(back_populates='authors')


class PlatformRelease(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'platform_releases'
    __table_args__ = (
        CheckConstraint(
            "release_type in ('quarterly','ad_hoc','security','bugfix')",
            name='ck_release_mgmt_platform_releases_type',
        ),
        CheckConstraint(
            "status in ('planned','draft','preparation','cab_approved','deploying','deployed','closed')",
            name='ck_release_mgmt_platform_releases_status',
        ),
        {'schema': RELEASE_MGMT_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    release_type: Mapped[str] = mapped_column(String(20), nullable=False, default='quarterly', index=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default='draft', index=True)
    environment: Mapped[str | None] = mapped_column(String(60), nullable=True)
    data_center_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('release_mgmt.data_centers.id', ondelete='SET NULL'),
        nullable=True,
    )
    cab_approver_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    cab_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cab_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    generated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    services_snapshot: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    changelog_snapshot: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    deploy_steps_snapshot: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    deployed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deployed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    planned_start: Mapped['date | None'] = mapped_column(Date, nullable=True, index=True)
    planned_end: Mapped['date | None'] = mapped_column(Date, nullable=True)
    planning_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    data_center: Mapped['DataCenter | None'] = relationship(back_populates='platform_releases')
    work_orders: Mapped[list['PlatformReleaseWorkOrder']] = relationship(
        back_populates='platform_release',
        cascade='all, delete-orphan',
    )
    dc_deployments: Mapped[list['WODCDeployment']] = relationship(back_populates='platform_release')
    deployment_runs: Mapped[list['DeploymentRun']] = relationship(
        back_populates='platform_release',
        cascade='all, delete-orphan',
    )


class PlatformReleaseWorkOrder(Base):
    __tablename__ = 'platform_release_work_orders'
    __table_args__ = (
        {'schema': RELEASE_MGMT_SCHEMA},
    )

    platform_release_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('release_mgmt.platform_releases.id', ondelete='CASCADE'),
        primary_key=True,
    )
    work_order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('release_mgmt.work_orders.id', ondelete='CASCADE'),
        primary_key=True,
    )
    included_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text('now()'))
    included_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    platform_release: Mapped['PlatformRelease'] = relationship(back_populates='work_orders')
    work_order: Mapped['ReleaseWorkOrder'] = relationship()


class WODCDeployment(UUIDPrimaryKeyMixin, Base):
    __tablename__ = 'wo_dc_deployments'
    __table_args__ = (
        CheckConstraint(
            "status in ('pending','deploying','deployed','failed','rolled_back')",
            name='ck_release_mgmt_wo_dc_deployments_status',
        ),
        {'schema': RELEASE_MGMT_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    work_order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('release_mgmt.work_orders.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    data_center_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('release_mgmt.data_centers.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    platform_release_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('release_mgmt.platform_releases.id', ondelete='SET NULL'),
        nullable=True,
    )
    environment: Mapped[str | None] = mapped_column(String(60), nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default='pending')
    deployed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deployed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text('now()'))

    data_center: Mapped['DataCenter'] = relationship(back_populates='dc_deployments')
    platform_release: Mapped['PlatformRelease | None'] = relationship(back_populates='dc_deployments')


class DeploymentRun(UUIDPrimaryKeyMixin, Base):
    __tablename__ = 'deployment_runs'
    __table_args__ = (
        CheckConstraint(
            "status in ('pending','in_progress','completed','partial','aborted')",
            name='ck_release_mgmt_deployment_runs_status',
        ),
        {'schema': RELEASE_MGMT_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    platform_release_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('release_mgmt.platform_releases.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    data_center_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('release_mgmt.data_centers.id', ondelete='CASCADE'),
        nullable=False,
    )
    environment: Mapped[str] = mapped_column(String(60), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default='pending', index=True)
    started_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text('now()'))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reopened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reopened_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    reopen_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text('now()'))

    platform_release: Mapped['PlatformRelease'] = relationship(back_populates='deployment_runs')
    data_center: Mapped['DataCenter'] = relationship(back_populates='deployment_runs')
    items: Mapped[list['DeploymentRunItem']] = relationship(
        back_populates='deployment_run',
        cascade='all, delete-orphan',
        order_by='DeploymentRunItem.group_key, DeploymentRunItem.step_index',
    )


class DeploymentRunItem(Base):
    __tablename__ = 'deployment_run_items'
    __table_args__ = (
        CheckConstraint(
            "status in ('pending','in_progress','done','blocked','postponed','skipped')",
            name='ck_release_mgmt_deployment_run_items_status',
        ),
        {'schema': RELEASE_MGMT_SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    deployment_run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('release_mgmt.deployment_runs.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    group_key: Mapped[str] = mapped_column(String(300), nullable=False)
    group_label: Mapped[str] = mapped_column(String(300), nullable=False)
    step_index: Mapped[int] = mapped_column(Integer, nullable=False)
    item_title: Mapped[str] = mapped_column(String(500), nullable=False)
    migration_step: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default='pending', index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    marked_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    marked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    deployment_run: Mapped['DeploymentRun'] = relationship(back_populates='items')
