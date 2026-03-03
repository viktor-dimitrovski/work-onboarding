from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import BaseSchema
from app.schemas.common import PaginationMeta


class ComplianceFrameworkOut(BaseSchema):
    framework_key: str
    name: str
    full_name: str | None = None
    version: str | None = None
    type: str | None = None
    region: str | None = None
    tags: list[str] = Field(default_factory=list)
    references: list[dict[str, Any]] = Field(default_factory=list)


class ComplianceDomainOut(BaseSchema):
    code: str
    label: str


class ComplianceControlOut(BaseSchema):
    control_key: str
    code: str
    title: str
    description: str
    domain_code: str
    criticality: str
    weight: int
    evidence_expected: str
    default_status: str
    default_score: float


class ComplianceControlFrameworkRefOut(BaseSchema):
    framework_key: str
    framework_name: str
    ref: str
    note: str | None = None


class ComplianceControlStatusOut(BaseSchema):
    control_key: str
    status_enum: str
    score: float
    notes: str | None = None
    owner_user_id: UUID | None = None
    last_reviewed_at: datetime | None = None
    na_reason: str | None = None
    target_score: float | None = None
    priority: str | None = None
    due_date: datetime | None = None
    remediation_notes: str | None = None
    remediation_owner_user_id: UUID | None = None


class ComplianceEvidenceOut(BaseSchema):
    id: UUID
    control_key: str
    type: str
    title: str
    url: str | None = None
    text: str | None = None
    tags: list[str] = Field(default_factory=list)
    owner_user_id: UUID | None = None
    created_at: datetime
    expires_at: datetime | None = None


class ComplianceControlListItem(BaseSchema):
    control: ComplianceControlOut
    status: ComplianceControlStatusOut | None = None
    evidence_count: int = 0


class ComplianceControlDetail(BaseSchema):
    control: ComplianceControlOut
    status: ComplianceControlStatusOut | None = None
    evidence: list[ComplianceEvidenceOut] = Field(default_factory=list)
    framework_refs: list[ComplianceControlFrameworkRefOut] = Field(default_factory=list)


class ComplianceProfileOut(BaseSchema):
    profile_key: str
    name: str
    description: str
    is_active: bool = False


class ComplianceProfileListResponse(BaseSchema):
    items: list[ComplianceProfileOut]


class ComplianceStatusUpdateRequest(BaseModel):
    status_enum: str
    notes: str | None = None
    na_reason: str | None = None


class ComplianceEvidenceCreateRequest(BaseModel):
    type: str
    title: str
    url: str | None = None
    text: str | None = None
    tags: list[str] = Field(default_factory=list)
    expires_at: datetime | None = None


class ComplianceSeedImportRequest(BaseModel):
    payload: dict[str, Any] | None = None
    server_file: str | None = None


class ComplianceLibraryImportRequest(BaseModel):
    payload: dict[str, Any] | None = None
    server_file: str | None = None
    version_label: str | None = None


class ComplianceLibraryImportResponse(BaseSchema):
    batch_id: UUID
    counts: dict[str, int]


class ComplianceLibraryValidateResponse(BaseSchema):
    valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ComplianceLibraryDiffResponse(BaseSchema):
    added: dict[str, int]
    updated: dict[str, int]
    deactivated: dict[str, int]


class ComplianceLibraryVersionOut(BaseSchema):
    id: UUID
    schema_version: str
    dataset: str
    exported_at: datetime
    version_label: str | None = None
    source: str
    payload_sha256: str
    imported_at: datetime
    imported_by_user_id: UUID | None = None


class ComplianceRemediationUpdateRequest(BaseModel):
    target_score: float | None = None
    priority: str | None = None
    due_date: datetime | None = None
    remediation_notes: str | None = None
    remediation_owner_user_id: UUID | None = None


class ComplianceGapItem(BaseSchema):
    control_key: str
    code: str
    title: str
    domain_code: str
    criticality: str
    weight: int
    status_enum: str | None
    score: float
    gap_score: float
    priority: str | None = None
    due_date: datetime | None = None
    remediation_notes: str | None = None
    remediation_owner_user_id: UUID | None = None
    framework_keys: list[str] = Field(default_factory=list)


class ComplianceGapPlanResponse(BaseSchema):
    items: list[ComplianceGapItem]


class ComplianceWorkItemLinkCreateRequest(BaseModel):
    source_type: str
    source_key: str
    link_type: str
    url: str | None = None
    work_order_id: UUID | None = None
    status: str | None = None


class ComplianceWorkItemLinkOut(BaseSchema):
    id: UUID
    source_type: str
    source_key: str
    link_type: str
    url: str | None = None
    work_order_id: UUID | None = None
    status: str | None = None
    created_at: datetime


class ComplianceWorkOrderCreateRequest(BaseModel):
    source_type: str
    source_key: str
    title: str
    description: str | None = None


class ComplianceWorkOrderCreateResponse(BaseSchema):
    work_order_id: UUID
    wo_id: str
    link_id: UUID


class ComplianceDashboardResponse(BaseSchema):
    implementation: ComplianceSummaryItem
    coverage_percent: float | None
    gaps_by_severity: dict[str, int]
    open_work_items: int
    last_snapshot_at: datetime | None
    top_gaps: list[ComplianceGapItem] = Field(default_factory=list)


class ComplianceTrendPoint(BaseSchema):
    computed_at: datetime
    implementation_percent: float | None
    coverage_percent: float | None


class ComplianceTrendResponse(BaseSchema):
    scope: str
    points: list[ComplianceTrendPoint]


class ComplianceSnapshotRequest(BaseModel):
    scope: str = "overall"
    framework_key: str | None = None
    client_set_version_id: UUID | None = None


class ComplianceSnapshotOut(BaseSchema):
    id: UUID
    scope: str
    computed_at: datetime
    implementation_percent: float | None
    coverage_percent: float | None


class CompliancePracticeItemOut(BaseSchema):
    id: UUID
    title: str
    description_text: str
    category: str | None = None
    status: str | None = None
    frequency: str | None = None
    evidence: str | None = None
    frameworks: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    owner_user_id: UUID | None = None
    created_at: datetime
    updated_at: datetime


class CompliancePracticeListResponse(BaseSchema):
    items: list[CompliancePracticeItemOut]
    meta: PaginationMeta


class ComplianceTenantFrameworkCreateRequest(BaseModel):
    framework_key: str
    name: str
    full_name: str | None = None
    version: str | None = None
    type: str | None = None
    region: str | None = None
    tags: list[str] = Field(default_factory=list)
    references: list[dict[str, Any]] = Field(default_factory=list)


class ComplianceTenantFrameworkUpdateRequest(BaseModel):
    name: str | None = None
    full_name: str | None = None
    version: str | None = None
    type: str | None = None
    region: str | None = None
    tags: list[str] | None = None
    references: list[dict[str, Any]] | None = None


class ComplianceFrameworkRequirementOut(BaseSchema):
    control_key: str
    control_code: str
    control_title: str
    ref: str
    note: str | None = None
    implementation_score: float | None = None
    practice_score: float | None = None


class ComplianceFrameworkRequirementCreateRequest(BaseModel):
    control_key: str
    ref: str
    note: str | None = None


class ComplianceFrameworkRequirementUpdateRequest(BaseModel):
    control_key: str
    old_ref: str
    new_ref: str
    note: str | None = None


class ComplianceProfileControlLite(BaseSchema):
    control_key: str
    code: str
    title: str


class ComplianceProfileFrameworkPreview(BaseSchema):
    framework_key: str
    name: str
    implementation_percent: float | None
    practice_coverage_percent: float | None
    practice_implementation_percent: float | None
    controls_total: int
    requirements_total: int
    requirements: list[ComplianceFrameworkRequirementOut] = Field(default_factory=list)


class ComplianceProfilePreviewResponse(BaseSchema):
    active_profile_key: str | None = None
    frameworks: list[ComplianceProfileFrameworkPreview] = Field(default_factory=list)
    profile_controls: list[ComplianceProfileControlLite] = Field(default_factory=list)


class ComplianceSemanticMatchControlResult(BaseSchema):
    control_key: str
    control_code: str
    control_title: str
    framework_key: str
    confidence: float
    covered_by: list[str] = Field(default_factory=list)
    gap_description: str | None = None


class ComplianceSemanticMatchFrameworkResult(BaseSchema):
    framework_key: str
    framework_name: str
    coverage_percent: float
    controls_covered: int
    controls_total: int
    controls: list[ComplianceSemanticMatchControlResult] = Field(default_factory=list)


class ComplianceSemanticMatchResponse(BaseSchema):
    overall_coverage_percent: float
    frameworks: list[ComplianceSemanticMatchFrameworkResult] = Field(default_factory=list)
    analysis_summary: str
    recommendations: list[str] = Field(default_factory=list)
    ran_at: datetime


class CompliancePracticeCreateRequest(BaseModel):
    title: str
    description_text: str
    category: str
    status: str
    frequency: str
    evidence: str | None = None
    frameworks: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class CompliancePracticeUpdateRequest(BaseModel):
    title: str | None = None
    description_text: str | None = None
    category: str | None = None
    status: str | None = None
    frequency: str | None = None
    evidence: str | None = None
    frameworks: list[str] | None = None
    tags: list[str] | None = None


class CompliancePracticeMatchRunOut(BaseSchema):
    id: UUID
    run_type: str
    status: str
    started_at: datetime | None = None
    finished_at: datetime | None = None
    model_info_json: dict[str, Any] = Field(default_factory=dict)


class CompliancePracticeMatchResultOut(BaseSchema):
    id: UUID
    practice_item_id: UUID
    control_key: str
    confidence: float
    coverage_score: float
    rationale: str
    suggested_evidence_json: dict[str, Any] = Field(default_factory=dict)
    accepted: bool
    manual_override: bool
    override_reason: str | None = None
    created_at: datetime


class CompliancePracticeMatchResponse(BaseSchema):
    run: CompliancePracticeMatchRunOut | None
    results: list[CompliancePracticeMatchResultOut]


class CompliancePracticeMatchOverrideRequest(BaseModel):
    accepted: bool
    manual_override: bool = True
    override_reason: str | None = None


class CompliancePracticeApplyRequest(BaseModel):
    result_ids: list[UUID]
    add_evidence: bool = True
    set_status: str | None = None


class ComplianceClientGroupOut(BaseSchema):
    id: UUID
    country: str | None = None
    bank_name: str | None = None
    project: str | None = None
    created_at: datetime


class ComplianceClientGroupCreateRequest(BaseModel):
    country: str | None = None
    bank_name: str | None = None
    project: str | None = None


class ComplianceClientVersionOut(BaseSchema):
    id: UUID
    client_group_id: UUID
    version_label: str
    is_active_version: bool
    created_at: datetime
    last_matched_at: datetime | None = None


class ComplianceClientVersionCreateRequest(BaseModel):
    version_label: str
    requirements_text: str


class ComplianceClientVersionUpdateRequest(BaseModel):
    version_label: str | None = None
    requirements_text: str | None = None


class ComplianceClientRequirementOut(BaseSchema):
    id: UUID
    text: str
    priority: str | None = None
    category: str | None = None
    order_index: int


class ComplianceClientMatchRunOut(BaseSchema):
    id: UUID
    client_set_version_id: UUID
    run_type: str
    status: str
    started_at: datetime | None = None
    finished_at: datetime | None = None
    model_info_json: dict[str, Any] = Field(default_factory=dict)


class ComplianceClientMatchResultOut(BaseSchema):
    id: UUID
    client_requirement_id: UUID
    control_key: str
    confidence: float
    coverage_score: float
    rationale: str
    suggested_evidence_json: dict[str, Any] = Field(default_factory=dict)
    accepted: bool
    manual_override: bool
    override_reason: str | None = None
    created_at: datetime


class ComplianceClientMatchResponse(BaseSchema):
    run: ComplianceClientMatchRunOut | None
    results: list[ComplianceClientMatchResultOut]


class ComplianceClientMatchOverrideRequest(BaseModel):
    accepted: bool
    manual_override: bool = True
    override_reason: str | None = None


class ComplianceClientOverviewItem(BaseSchema):
    group: ComplianceClientGroupOut
    active_version: ComplianceClientVersionOut | None
    compliance_percent: float | None
    gap_count: int


class ComplianceClientOverviewResponse(BaseSchema):
    items: list[ComplianceClientOverviewItem]


class ComplianceClientVersionDetail(BaseSchema):
    version: ComplianceClientVersionOut
    requirements: list[ComplianceClientRequirementOut]


class ComplianceClientGroupDetail(BaseSchema):
    group: ComplianceClientGroupOut
    versions: list[ComplianceClientVersionOut]


class ComplianceSeedImportResponse(BaseSchema):
    batch_id: UUID
    counts: dict[str, int]


class ComplianceSummaryItem(BaseSchema):
    key: str
    label: str
    numerator: float
    denominator: float
    compliance: float | None


class ComplianceSummaryResponse(BaseSchema):
    overall: ComplianceSummaryItem
    by_framework: list[ComplianceSummaryItem]
    by_domain: list[ComplianceSummaryItem]


class ComplianceFrameworkSummaryResponse(BaseSchema):
    framework: ComplianceSummaryItem
    by_domain: list[ComplianceSummaryItem]
