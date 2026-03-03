from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.models.mixins import UUIDPrimaryKeyMixin


COMPLIANCE_SCHEMA = 'compliance'


class ComplianceFramework(UUIDPrimaryKeyMixin, Base):
    __tablename__ = 'frameworks'
    __table_args__ = (
        UniqueConstraint('framework_key', name='uq_compliance_frameworks_framework_key'),
        {'schema': COMPLIANCE_SCHEMA},
    )

    framework_key: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    version: Mapped[str | None] = mapped_column(String(60), nullable=True)
    type: Mapped[str | None] = mapped_column(String(60), nullable=True)
    region: Mapped[str | None] = mapped_column(String(80), nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    references: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)


class ComplianceDomain(Base):
    __tablename__ = 'domains'
    __table_args__ = ({'schema': COMPLIANCE_SCHEMA},)

    code: Mapped[str] = mapped_column(String(80), primary_key=True)
    label: Mapped[str] = mapped_column(String(120), nullable=False)


class ComplianceControl(UUIDPrimaryKeyMixin, Base):
    __tablename__ = 'controls'
    __table_args__ = (
        UniqueConstraint('control_key', name='uq_compliance_controls_control_key'),
        UniqueConstraint('code', name='uq_compliance_controls_code'),
        CheckConstraint(
            "criticality in ('Low','Medium','High')",
            name='ck_compliance_controls_criticality',
        ),
        CheckConstraint(
            "default_status in ('not_started','in_progress','partial','mostly','implemented','na')",
            name='ck_compliance_controls_default_status',
        ),
        {'schema': COMPLIANCE_SCHEMA},
    )

    control_key: Mapped[str] = mapped_column(String(120), nullable=False)
    code: Mapped[str] = mapped_column(String(60), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    domain_code: Mapped[str] = mapped_column(
        String(80), ForeignKey(f'{COMPLIANCE_SCHEMA}.domains.code'), nullable=False
    )
    criticality: Mapped[str] = mapped_column(String(10), nullable=False)
    weight: Mapped[int] = mapped_column(nullable=False, default=1)
    evidence_expected: Mapped[str] = mapped_column(Text, nullable=False)
    default_status: Mapped[str] = mapped_column(String(20), nullable=False, default='not_started')
    default_score: Mapped[float] = mapped_column(nullable=False, default=0.0)


class ComplianceControlFrameworkRef(Base):
    __tablename__ = 'control_framework_refs'
    __table_args__ = (
        {'schema': COMPLIANCE_SCHEMA},
    )

    control_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(f'{COMPLIANCE_SCHEMA}.controls.id', ondelete='CASCADE'),
        primary_key=True,
    )
    framework_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(f'{COMPLIANCE_SCHEMA}.frameworks.id', ondelete='CASCADE'),
        primary_key=True,
    )
    ref: Mapped[str] = mapped_column(String(200), primary_key=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class ComplianceProfile(UUIDPrimaryKeyMixin, Base):
    __tablename__ = 'profiles'
    __table_args__ = (
        UniqueConstraint('profile_key', name='uq_compliance_profiles_profile_key'),
        {'schema': COMPLIANCE_SCHEMA},
    )

    profile_key: Mapped[str] = mapped_column(String(120), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)


class ComplianceProfileControl(Base):
    __tablename__ = 'profile_controls'
    __table_args__ = (
        {'schema': COMPLIANCE_SCHEMA},
    )

    profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(f'{COMPLIANCE_SCHEMA}.profiles.id', ondelete='CASCADE'),
        primary_key=True,
    )
    control_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(f'{COMPLIANCE_SCHEMA}.controls.id', ondelete='CASCADE'),
        primary_key=True,
    )
    sort_order: Mapped[int | None] = mapped_column(nullable=True)


class ComplianceSeedImportBatch(UUIDPrimaryKeyMixin, Base):
    __tablename__ = 'seed_import_batches'
    __table_args__ = ({'schema': COMPLIANCE_SCHEMA},)

    dataset: Mapped[str] = mapped_column(String(160), nullable=False)
    schema_version: Mapped[str] = mapped_column(String(20), nullable=False)
    exported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source: Mapped[str] = mapped_column(String(80), nullable=False)
    payload_sha256: Mapped[str] = mapped_column(String(128), nullable=False)
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa.text('now()')
    )
    imported_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)


class ComplianceTenantLibraryImportBatch(UUIDPrimaryKeyMixin, Base):
    __tablename__ = 'tenant_library_import_batches'
    __table_args__ = ({'schema': COMPLIANCE_SCHEMA},)

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    schema_version: Mapped[str] = mapped_column(String(30), nullable=False)
    dataset: Mapped[str] = mapped_column(String(160), nullable=False)
    exported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    version_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    source: Mapped[str] = mapped_column(String(80), nullable=False)
    payload_sha256: Mapped[str] = mapped_column(String(128), nullable=False)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa.text('now()')
    )
    imported_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)


class ComplianceTenantFramework(Base):
    __tablename__ = 'tenant_frameworks'
    __table_args__ = ({'schema': COMPLIANCE_SCHEMA},)

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        primary_key=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    framework_key: Mapped[str] = mapped_column(String(80), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    version: Mapped[str | None] = mapped_column(String(60), nullable=True)
    type: Mapped[str | None] = mapped_column(String(60), nullable=True)
    region: Mapped[str | None] = mapped_column(String(80), nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    references: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class ComplianceTenantDomain(Base):
    __tablename__ = 'tenant_domains'
    __table_args__ = ({'schema': COMPLIANCE_SCHEMA},)

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        primary_key=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    domain_code: Mapped[str] = mapped_column(String(80), primary_key=True)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class ComplianceTenantControl(Base):
    __tablename__ = 'tenant_controls'
    __table_args__ = (
        UniqueConstraint('tenant_id', 'code', name='uq_compliance_tenant_controls_code'),
        CheckConstraint(
            "criticality in ('Low','Medium','High')",
            name='ck_compliance_tenant_controls_criticality',
        ),
        CheckConstraint(
            "default_status in ('not_started','in_progress','partial','mostly','implemented','na')",
            name='ck_compliance_tenant_controls_default_status',
        ),
        {'schema': COMPLIANCE_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        primary_key=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    control_key: Mapped[str] = mapped_column(String(120), primary_key=True)
    code: Mapped[str] = mapped_column(String(60), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    domain_code: Mapped[str] = mapped_column(String(80), nullable=False)
    criticality: Mapped[str] = mapped_column(String(10), nullable=False)
    weight: Mapped[int] = mapped_column(nullable=False, default=1)
    evidence_expected: Mapped[str] = mapped_column(Text, nullable=False)
    default_status: Mapped[str] = mapped_column(String(20), nullable=False, default='not_started')
    default_score: Mapped[float] = mapped_column(nullable=False, default=0.0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class ComplianceTenantControlFrameworkRef(Base):
    __tablename__ = 'tenant_control_framework_refs'
    __table_args__ = ({'schema': COMPLIANCE_SCHEMA},)

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        primary_key=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    control_key: Mapped[str] = mapped_column(String(120), primary_key=True)
    framework_key: Mapped[str] = mapped_column(String(80), primary_key=True)
    ref: Mapped[str] = mapped_column(String(200), primary_key=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class ComplianceTenantLibraryProfile(Base):
    __tablename__ = 'tenant_library_profiles'
    __table_args__ = ({'schema': COMPLIANCE_SCHEMA},)

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        primary_key=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    profile_key: Mapped[str] = mapped_column(String(120), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class ComplianceTenantLibraryProfileControl(Base):
    __tablename__ = 'tenant_profile_controls'
    __table_args__ = ({'schema': COMPLIANCE_SCHEMA},)

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        primary_key=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    profile_key: Mapped[str] = mapped_column(String(120), primary_key=True)
    control_key: Mapped[str] = mapped_column(String(120), primary_key=True)
    sort_order: Mapped[int | None] = mapped_column(nullable=True)


class ComplianceTenantProfile(Base):
    __tablename__ = 'tenant_profiles'
    __table_args__ = (
        {'schema': COMPLIANCE_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        primary_key=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    profile_key: Mapped[str] = mapped_column(String(120), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class ComplianceControlStatus(Base):
    __tablename__ = 'control_status'
    __table_args__ = (
        CheckConstraint(
            "status_enum in ('not_started','in_progress','partial','mostly','implemented','na')",
            name='ck_compliance_control_status_status_enum',
        ),
        CheckConstraint(
            'score >= 0 AND score <= 1',
            name='ck_compliance_control_status_score_range',
        ),
        CheckConstraint(
            "status_enum <> 'na' OR (na_reason IS NOT NULL AND score = 0)",
            name='ck_compliance_control_status_na_rule',
        ),
        {'schema': COMPLIANCE_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        primary_key=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    control_key: Mapped[str] = mapped_column(String(120), primary_key=True)
    control_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(f'{COMPLIANCE_SCHEMA}.controls.id', ondelete='SET NULL'),
        nullable=True,
    )
    status_enum: Mapped[str] = mapped_column(String(20), nullable=False, default='not_started')
    score: Mapped[float] = mapped_column(nullable=False, default=0.0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    na_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_score: Mapped[float | None] = mapped_column(nullable=True)
    priority: Mapped[str | None] = mapped_column(String(20), nullable=True)
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    remediation_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    remediation_owner_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)


class ComplianceEvidence(UUIDPrimaryKeyMixin, Base):
    __tablename__ = 'evidence'
    __table_args__ = (
        CheckConstraint(
            "type in ('link','text')",
            name='ck_compliance_evidence_type',
        ),
        CheckConstraint(
            "(type = 'link' AND url IS NOT NULL) OR (type = 'text' AND text IS NOT NULL)",
            name='ck_compliance_evidence_type_fields',
        ),
        {'schema': COMPLIANCE_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    control_key: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    control_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(f'{COMPLIANCE_SCHEMA}.controls.id', ondelete='SET NULL'),
        nullable=True,
    )
    type: Mapped[str] = mapped_column(String(12), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa.text('now()')
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ComplianceSnapshot(UUIDPrimaryKeyMixin, Base):
    __tablename__ = 'compliance_snapshots'
    __table_args__ = (
        CheckConstraint(
            "scope in ('overall','framework','client_set')",
            name='ck_compliance_snapshots_scope',
        ),
        {'schema': COMPLIANCE_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    scope: Mapped[str] = mapped_column(String(30), nullable=False)
    profile_key: Mapped[str] = mapped_column(String(120), nullable=False)
    framework_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    client_set_version_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    library_batch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    implementation_percent: Mapped[float | None] = mapped_column(nullable=True)
    coverage_percent: Mapped[float | None] = mapped_column(nullable=True)
    metrics_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    input_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa.text('now()')
    )
    computed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)


class ComplianceWorkItemLink(UUIDPrimaryKeyMixin, Base):
    __tablename__ = 'work_item_links'
    __table_args__ = (
        CheckConstraint(
            "source_type in ('control','gap','practice','client_requirement')",
            name='ck_compliance_work_item_links_source_type',
        ),
        CheckConstraint(
            "link_type in ('jira','work_order','track')",
            name='ck_compliance_work_item_links_link_type',
        ),
        {'schema': COMPLIANCE_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    source_type: Mapped[str] = mapped_column(String(30), nullable=False)
    source_key: Mapped[str] = mapped_column(String(200), nullable=False)
    link_type: Mapped[str] = mapped_column(String(30), nullable=False)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    work_order_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa.text('now()')
    )


class CompliancePracticeItem(UUIDPrimaryKeyMixin, Base):
    __tablename__ = 'practice_items'
    __table_args__ = ({'schema': COMPLIANCE_SCHEMA},)

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description_text: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str | None] = mapped_column(String(60), nullable=True)
    frequency: Mapped[str | None] = mapped_column(String(60), nullable=True)
    evidence: Mapped[str | None] = mapped_column(Text, nullable=True)
    frameworks: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa.text('now()')
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa.text('now()')
    )


class CompliancePracticeMatchRun(UUIDPrimaryKeyMixin, Base):
    __tablename__ = 'practice_match_runs'
    __table_args__ = (
        CheckConstraint(
            "run_type in ('single','bulk')",
            name='ck_compliance_practice_match_runs_type',
        ),
        CheckConstraint(
            "status in ('pending','running','success','failed')",
            name='ck_compliance_practice_match_runs_status',
        ),
        {'schema': COMPLIANCE_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    run_type: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default='pending')
    model_info_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    input_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ComplianceSemanticMatchRun(UUIDPrimaryKeyMixin, Base):
    __tablename__ = 'semantic_match_runs'
    __table_args__ = (
        CheckConstraint(
            "status in ('success','failed')",
            name='ck_compliance_semantic_match_runs_status',
        ),
        {'schema': COMPLIANCE_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    profile_key: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default='success')
    model_info_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    input_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    result_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa.text('now()')
    )
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CompliancePracticeMatchResult(UUIDPrimaryKeyMixin, Base):
    __tablename__ = 'practice_match_results'
    __table_args__ = ({'schema': COMPLIANCE_SCHEMA},)

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    practice_item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    control_key: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    confidence: Mapped[float] = mapped_column(nullable=False, default=0.0)
    coverage_score: Mapped[float] = mapped_column(nullable=False, default=0.0)
    rationale: Mapped[str] = mapped_column(Text, nullable=False, default='')
    suggested_evidence_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    accepted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    manual_override: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    override_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa.text('now()')
    )


class ComplianceClientGroup(UUIDPrimaryKeyMixin, Base):
    __tablename__ = 'client_groups'
    __table_args__ = ({'schema': COMPLIANCE_SCHEMA},)

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    country: Mapped[str | None] = mapped_column(String(80), nullable=True)
    bank_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    project: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa.text('now()')
    )


class ComplianceClientSetVersion(UUIDPrimaryKeyMixin, Base):
    __tablename__ = 'client_set_versions'
    __table_args__ = ({'schema': COMPLIANCE_SCHEMA},)

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    client_group_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    version_label: Mapped[str] = mapped_column(String(60), nullable=False)
    is_active_version: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa.text('now()')
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    last_matched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    library_batch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)


class ComplianceClientRequirement(UUIDPrimaryKeyMixin, Base):
    __tablename__ = 'client_requirements'
    __table_args__ = ({'schema': COMPLIANCE_SCHEMA},)

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    client_set_version_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    priority: Mapped[str | None] = mapped_column(String(20), nullable=True)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    order_index: Mapped[int] = mapped_column(nullable=False, default=0)
    coverage_percent: Mapped[float | None] = mapped_column(nullable=True)
    coverage_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ComplianceClientMatchRun(UUIDPrimaryKeyMixin, Base):
    __tablename__ = 'client_match_runs'
    __table_args__ = (
        CheckConstraint(
            "run_type in ('single','bulk')",
            name='ck_compliance_client_match_runs_type',
        ),
        CheckConstraint(
            "status in ('pending','running','success','failed')",
            name='ck_compliance_client_match_runs_status',
        ),
        {'schema': COMPLIANCE_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    client_set_version_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    run_type: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default='pending')
    model_info_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    input_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ComplianceClientMatchResult(UUIDPrimaryKeyMixin, Base):
    __tablename__ = 'client_match_results'
    __table_args__ = ({'schema': COMPLIANCE_SCHEMA},)

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    client_requirement_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    control_key: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    confidence: Mapped[float] = mapped_column(nullable=False, default=0.0)
    coverage_score: Mapped[float] = mapped_column(nullable=False, default=0.0)
    rationale: Mapped[str] = mapped_column(Text, nullable=False, default='')
    suggested_evidence_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    accepted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    manual_override: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    override_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa.text('now()')
    )


class ComplianceControlEmbedding(UUIDPrimaryKeyMixin, Base):
    __tablename__ = 'control_embeddings'
    __table_args__ = (
        UniqueConstraint('tenant_id', 'control_key', 'model', name='uq_compliance_control_embeddings_unique'),
        {'schema': COMPLIANCE_SCHEMA},
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    control_key: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    model: Mapped[str] = mapped_column(String(80), nullable=False)
    embedding_json: Mapped[list[float]] = mapped_column(JSONB, nullable=False, default=list)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa.text('now()')
    )


Index(
    'ix_compliance_control_framework_refs_control_framework',
    ComplianceControlFrameworkRef.control_id,
    ComplianceControlFrameworkRef.framework_id,
)
Index(
    'ix_compliance_control_status_tenant_status',
    ComplianceControlStatus.tenant_id,
    ComplianceControlStatus.status_enum,
)
Index(
    'ix_compliance_control_status_tenant_control',
    ComplianceControlStatus.tenant_id,
    ComplianceControlStatus.control_key,
)
Index(
    'ix_compliance_evidence_tenant_control_created',
    ComplianceEvidence.tenant_id,
    ComplianceEvidence.control_key,
    ComplianceEvidence.created_at,
)
Index(
    'ix_compliance_snapshots_tenant_scope_time',
    ComplianceSnapshot.tenant_id,
    ComplianceSnapshot.scope,
    ComplianceSnapshot.computed_at,
)
Index(
    'ix_compliance_work_item_links_source',
    ComplianceWorkItemLink.tenant_id,
    ComplianceWorkItemLink.source_type,
    ComplianceWorkItemLink.source_key,
)
Index(
    'ix_compliance_practice_match_results_item',
    CompliancePracticeMatchResult.tenant_id,
    CompliancePracticeMatchResult.practice_item_id,
)
Index(
    'ix_compliance_practice_match_results_control',
    CompliancePracticeMatchResult.tenant_id,
    CompliancePracticeMatchResult.control_key,
)
Index(
    'ix_compliance_client_requirements_version',
    ComplianceClientRequirement.tenant_id,
    ComplianceClientRequirement.client_set_version_id,
)
Index(
    'ix_compliance_client_match_results_requirement',
    ComplianceClientMatchResult.tenant_id,
    ComplianceClientMatchResult.client_requirement_id,
)
Index(
    'ix_compliance_client_match_results_control',
    ComplianceClientMatchResult.tenant_id,
    ComplianceClientMatchResult.control_key,
)
Index(
    'ix_compliance_control_embeddings_control',
    ComplianceControlEmbedding.tenant_id,
    ComplianceControlEmbedding.control_key,
)
