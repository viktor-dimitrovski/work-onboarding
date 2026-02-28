import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.mixins import AuditUserMixin, TimestampMixin, UUIDPrimaryKeyMixin


class TrackTemplate(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'track_templates'

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    role_target: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    estimated_duration_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    purpose: Mapped[str] = mapped_column(String(30), nullable=False, default='onboarding')
    track_type: Mapped[str] = mapped_column(String(30), nullable=False, default='GENERAL', index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    versions: Mapped[list['TrackVersion']] = relationship(
        back_populates='template', cascade='all, delete-orphan', order_by='TrackVersion.version_number'
    )


class TrackVersion(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'track_versions'
    __table_args__ = (
        ForeignKeyConstraint(
            ['tenant_id', 'template_id'],
            ['track_templates.tenant_id', 'track_templates.id'],
            ondelete='CASCADE',
        ),
        UniqueConstraint('template_id', 'version_number', name='uq_track_versions_template_version'),
        CheckConstraint("status in ('draft', 'published', 'archived')", name='track_version_status_values'),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    template_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default='draft', index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    estimated_duration_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    purpose: Mapped[str] = mapped_column(String(30), nullable=False, default='onboarding')
    track_type: Mapped[str] = mapped_column(String(30), nullable=False, default='GENERAL', index=True)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    template: Mapped['TrackTemplate'] = relationship(back_populates='versions')
    phases: Mapped[list['TrackPhase']] = relationship(
        back_populates='track_version', cascade='all, delete-orphan', order_by='TrackPhase.order_index'
    )


class TrackPhase(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'track_phases'
    __table_args__ = (
        ForeignKeyConstraint(
            ['tenant_id', 'track_version_id'],
            ['track_versions.tenant_id', 'track_versions.id'],
            ondelete='CASCADE',
        ),
        UniqueConstraint('track_version_id', 'order_index', name='uq_track_phases_version_order'),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    track_version_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    source_phase_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)

    track_version: Mapped['TrackVersion'] = relationship(back_populates='phases')
    tasks: Mapped[list['TrackTask']] = relationship(
        back_populates='track_phase', cascade='all, delete-orphan', order_by='TrackTask.order_index'
    )


class TrackTask(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'track_tasks'
    __table_args__ = (
        ForeignKeyConstraint(
            ['tenant_id', 'track_phase_id'],
            ['track_phases.tenant_id', 'track_phases.id'],
            ondelete='CASCADE',
        ),
        UniqueConstraint('track_phase_id', 'order_index', name='uq_track_tasks_phase_order'),
        CheckConstraint(
            "task_type in ('read_material', 'video', 'checklist', 'quiz', 'code_assignment', 'external_link', 'mentor_approval', 'file_upload', 'assessment_test')",
            name='track_task_type_values',
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    track_phase_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    source_task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    task_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    estimated_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    passing_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column('metadata', JSONB, nullable=False, default=dict)
    due_days_offset: Mapped[int | None] = mapped_column(Integer, nullable=True)

    track_phase: Mapped['TrackPhase'] = relationship(back_populates='tasks')
    resources: Mapped[list['TaskResource']] = relationship(
        back_populates='task', cascade='all, delete-orphan', order_by='TaskResource.order_index'
    )


class TaskResource(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'task_resources'
    __table_args__ = (
        ForeignKeyConstraint(
            ['tenant_id', 'task_id'],
            ['track_tasks.tenant_id', 'track_tasks.id'],
            ondelete='CASCADE',
        ),
        CheckConstraint(
            "resource_type in ('markdown_text', 'rich_text', 'pdf_link', 'video_link', 'external_url', 'code_snippet')",
            name='task_resource_type_values',
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    task_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    metadata_json: Mapped[dict[str, Any]] = mapped_column('metadata', JSONB, nullable=False, default=dict)

    task: Mapped['TrackTask'] = relationship(back_populates='resources')


Index('ix_track_versions_template_id', TrackVersion.template_id)
Index('ix_track_phases_track_version_id', TrackPhase.track_version_id)
Index('ix_track_tasks_track_phase_id', TrackTask.track_phase_id)
Index('ix_task_resources_task_id', TaskResource.task_id)
