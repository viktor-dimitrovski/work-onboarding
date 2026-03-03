from __future__ import annotations

from datetime import datetime
import uuid
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import and_, delete, func, select, update
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.models.compliance import (
    ComplianceControlStatus,
    ComplianceEvidence,
    ComplianceClientGroup,
    ComplianceClientMatchResult,
    ComplianceClientMatchRun,
    ComplianceClientRequirement,
    ComplianceClientSetVersion,
    CompliancePracticeItem,
    CompliancePracticeMatchResult,
    CompliancePracticeMatchRun,
    ComplianceTenantControl,
    ComplianceTenantControlFrameworkRef,
    ComplianceTenantDomain,
    ComplianceTenantFramework,
    ComplianceTenantLibraryProfile,
    ComplianceTenantLibraryProfileControl,
    ComplianceTenantLibraryImportBatch,
    ComplianceTenantProfile,
    ComplianceWorkItemLink,
)
from app.models.release_mgmt import ReleaseWorkOrder
from app.models.rbac import User
from app.multitenancy.deps import TenantContext, require_tenant_membership
from app.multitenancy.permissions import require_access
from app.schemas.compliance import (
    ComplianceControlDetail,
    ComplianceControlFrameworkRefOut,
    ComplianceControlListItem,
    ComplianceControlOut,
    ComplianceControlStatusOut,
    ComplianceEvidenceCreateRequest,
    ComplianceEvidenceOut,
    ComplianceClientGroupCreateRequest,
    ComplianceClientGroupDetail,
    ComplianceClientGroupOut,
    ComplianceClientMatchOverrideRequest,
    ComplianceClientMatchResponse,
    ComplianceClientMatchResultOut,
    ComplianceClientMatchRunOut,
    ComplianceClientOverviewItem,
    ComplianceClientOverviewResponse,
    ComplianceClientRequirementOut,
    ComplianceClientVersionCreateRequest,
    ComplianceClientVersionDetail,
    ComplianceClientVersionOut,
    ComplianceClientVersionUpdateRequest,
    ComplianceDashboardResponse,
    ComplianceGapItem,
    ComplianceGapPlanResponse,
    ComplianceFrameworkOut,
    ComplianceFrameworkSummaryResponse,
    ComplianceLibraryDiffResponse,
    ComplianceLibraryImportRequest,
    ComplianceLibraryImportResponse,
    ComplianceLibraryValidateResponse,
    ComplianceLibraryVersionOut,
    ComplianceProfileListResponse,
    ComplianceProfileOut,
    CompliancePracticeApplyRequest,
    CompliancePracticeCreateRequest,
    CompliancePracticeItemOut,
    CompliancePracticeListResponse,
    CompliancePracticeMatchOverrideRequest,
    CompliancePracticeMatchResponse,
    CompliancePracticeMatchResultOut,
    CompliancePracticeMatchRunOut,
    CompliancePracticeUpdateRequest,
    ComplianceProfilePreviewResponse,
    ComplianceProfileFrameworkPreview,
    ComplianceProfileControlLite,
    ComplianceFrameworkRequirementOut,
    ComplianceTenantFrameworkCreateRequest,
    ComplianceTenantFrameworkUpdateRequest,
    ComplianceFrameworkRequirementCreateRequest,
    ComplianceFrameworkRequirementUpdateRequest,
    ComplianceSemanticMatchResponse,
    ComplianceSemanticMatchControlResult,
    ComplianceSemanticMatchFrameworkResult,
    ComplianceRemediationUpdateRequest,
    ComplianceSeedImportRequest,
    ComplianceSeedImportResponse,
    ComplianceSnapshotOut,
    ComplianceSnapshotRequest,
    ComplianceStatusUpdateRequest,
    ComplianceSummaryResponse,
    ComplianceTrendPoint,
    ComplianceTrendResponse,
    ComplianceWorkItemLinkCreateRequest,
    ComplianceWorkItemLinkOut,
    ComplianceWorkOrderCreateRequest,
    ComplianceWorkOrderCreateResponse,
)
from app.services.audit_service import log_action
from app.services.compliance_seed_service import SeedImportError, import_seed_payload, load_seed_payload_from_request
from app.services.compliance_tenant_library_service import (
    TenantLibraryError,
    apply_tenant_library_payload,
    diff_tenant_library_payload,
    list_tenant_library_versions,
    load_tenant_library_payload_from_request,
    validate_tenant_library_payload,
)
from app.services.compliance_summary_service import STATUS_SCORES, compute_framework_summary, compute_summary
from app.services.compliance_gap_service import list_gaps, order_gaps
from app.services.compliance_snapshot_service import create_snapshot, get_trends, latest_snapshot
from app.services.compliance_practice_service import run_practice_match
from app.services.compliance_client_service import parse_requirements, run_client_match
from app.services import work_order_service
from app.services.compliance_profile_preview_service import (
    active_profile_key as _pp_active_profile_key,
    compute_preview_rows,
    framework_implementation_percent,
    framework_practice_metrics,
    profile_controls as _pp_profile_controls,
)


router = APIRouter(prefix="/compliance", tags=["compliance"])

def _require_admin():
    return require_access("compliance", "compliance:admin")


def _active_profile_key(db: Session, tenant_id: UUID) -> str | None:
    return db.scalar(
        select(ComplianceTenantProfile.profile_key).where(
            ComplianceTenantProfile.tenant_id == tenant_id,
            ComplianceTenantProfile.enabled.is_(True),
        )
    )


def _generate_work_order_id() -> str:
    year = datetime.utcnow().year
    suffix = uuid.uuid4().hex[:6].upper()
    return f"WO-{year}-{suffix}"


def _client_compliance(
    db: Session,
    *,
    tenant_id: UUID,
    version_id: UUID,
) -> tuple[float | None, int]:
    requirements = db.scalars(
        select(ComplianceClientRequirement).where(
            ComplianceClientRequirement.tenant_id == tenant_id,
            ComplianceClientRequirement.client_set_version_id == version_id,
        )
    ).all()
    if not requirements:
        return None, 0

    results = db.scalars(
        select(ComplianceClientMatchResult).where(
            ComplianceClientMatchResult.tenant_id == tenant_id,
            ComplianceClientMatchResult.client_requirement_id.in_([r.id for r in requirements]),
        )
    ).all()

    status_map = {
        row.control_key: row.score
        for row in db.scalars(
            select(ComplianceControlStatus).where(ComplianceControlStatus.tenant_id == tenant_id)
        ).all()
    }

    weight_map = {"high": 3, "medium": 2, "low": 1}
    total_weight = 0.0
    total_score = 0.0
    gap_count = 0

    results_by_req: dict[UUID, list[ComplianceClientMatchResult]] = {}
    for result in results:
        results_by_req.setdefault(result.client_requirement_id, []).append(result)

    for req in requirements:
        matches = results_by_req.get(req.id, [])
        best_score = 0.0
        for match in matches:
            best_score = max(best_score, float(status_map.get(match.control_key, 0.0)))
        weight = float(weight_map.get((req.priority or "medium").lower(), 1))
        total_weight += weight
        total_score += best_score * weight
        if best_score < 0.75:
            gap_count += 1

    if total_weight <= 0:
        return None, gap_count
    return total_score / total_weight, gap_count


@router.get("/frameworks", response_model=list[ComplianceFrameworkOut])
def list_frameworks(
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:read")),
) -> list[ComplianceFrameworkOut]:
    frameworks = db.scalars(
        select(ComplianceTenantFramework)
        .where(
            ComplianceTenantFramework.tenant_id == ctx.tenant.id,
            ComplianceTenantFramework.is_active.is_(True),
        )
        .order_by(ComplianceTenantFramework.name.asc())
    ).all()
    return [ComplianceFrameworkOut.model_validate(item) for item in frameworks]


@router.get("/frameworks/{framework_key}", response_model=ComplianceFrameworkOut)
def get_framework(
    framework_key: str,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:read")),
) -> ComplianceFrameworkOut:
    framework = db.scalar(
        select(ComplianceTenantFramework)
        .where(
            ComplianceTenantFramework.tenant_id == ctx.tenant.id,
            ComplianceTenantFramework.framework_key == framework_key,
            ComplianceTenantFramework.is_active.is_(True),
        )
    )
    if not framework:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Framework not found")
    return ComplianceFrameworkOut.model_validate(framework)


@router.get("/profiles", response_model=ComplianceProfileListResponse)
def list_profiles(
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:read")),
) -> ComplianceProfileListResponse:
    profiles = db.scalars(
        select(ComplianceTenantLibraryProfile)
        .where(
            ComplianceTenantLibraryProfile.tenant_id == ctx.tenant.id,
            ComplianceTenantLibraryProfile.is_active.is_(True),
        )
        .order_by(ComplianceTenantLibraryProfile.name.asc())
    ).all()
    active_profile_key = _active_profile_key(db, ctx.tenant.id)
    items = [
        ComplianceProfileOut(
            profile_key=item.profile_key,
            name=item.name,
            description=item.description,
            is_active=item.profile_key == active_profile_key,
        )
        for item in profiles
    ]
    return ComplianceProfileListResponse(items=items)


@router.post("/library/validate", response_model=ComplianceLibraryValidateResponse)
def validate_library(
    payload: ComplianceLibraryImportRequest,
    _ctx: TenantContext = Depends(require_tenant_membership),
    _: Session = Depends(get_db),
    __: User = Depends(get_current_active_user),
    ___: object = Depends(require_access("compliance", "compliance:admin")),
) -> ComplianceLibraryValidateResponse:
    try:
        data, _sha, _source = load_tenant_library_payload_from_request(payload.payload, payload.server_file)
    except TenantLibraryError as exc:
        return ComplianceLibraryValidateResponse(valid=False, errors=[str(exc)], warnings=[])

    errors, warnings = validate_tenant_library_payload(data)
    return ComplianceLibraryValidateResponse(valid=not errors, errors=errors, warnings=warnings)


@router.post("/library/diff", response_model=ComplianceLibraryDiffResponse)
def diff_library(
    payload: ComplianceLibraryImportRequest,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    __: User = Depends(get_current_active_user),
    ___: object = Depends(require_access("compliance", "compliance:admin")),
) -> ComplianceLibraryDiffResponse:
    try:
        data, _sha, _source = load_tenant_library_payload_from_request(payload.payload, payload.server_file)
    except TenantLibraryError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    errors, warnings = validate_tenant_library_payload(data)
    if errors:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"errors": errors, "warnings": warnings})

    diff = diff_tenant_library_payload(db, tenant_id=ctx.tenant.id, payload=data)
    return ComplianceLibraryDiffResponse(**diff)


@router.post("/library/import", response_model=ComplianceLibraryImportResponse)
def import_library(
    payload: ComplianceLibraryImportRequest,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:admin")),
) -> ComplianceLibraryImportResponse:
    try:
        data, sha, source = load_tenant_library_payload_from_request(payload.payload, payload.server_file)
    except TenantLibraryError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    errors, warnings = validate_tenant_library_payload(data)
    if errors:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"errors": errors, "warnings": warnings})

    try:
        batch, counts = apply_tenant_library_payload(
            db,
            tenant_id=ctx.tenant.id,
            payload=data,
            payload_sha=sha,
            source=source,
            version_label=payload.version_label,
            imported_by_user_id=current_user.id,
        )
        db.commit()
    except TenantLibraryError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to import tenant library.",
        ) from exc

    if warnings:
        return ComplianceLibraryImportResponse(batch_id=batch.id, counts={**counts, "warnings": len(warnings)})
    return ComplianceLibraryImportResponse(batch_id=batch.id, counts=counts)


@router.get("/library/versions", response_model=list[ComplianceLibraryVersionOut])
def list_library_versions(
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:admin")),
) -> list[ComplianceLibraryVersionOut]:
    return [ComplianceLibraryVersionOut.model_validate(item) for item in list_tenant_library_versions(db, ctx.tenant.id)]


@router.get("/profile/preview", response_model=ComplianceProfilePreviewResponse)
def get_profile_preview(
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:read")),
) -> ComplianceProfilePreviewResponse:
    profile_key = _pp_active_profile_key(db, tenant_id=ctx.tenant.id)
    if not profile_key:
        return ComplianceProfilePreviewResponse(active_profile_key=None, frameworks=[], profile_controls=[])

    rows = compute_preview_rows(db, tenant_id=ctx.tenant.id, profile_key=profile_key)
    controls = _pp_profile_controls(db, tenant_id=ctx.tenant.id, profile_key=profile_key)
    controls_out = [
        ComplianceProfileControlLite(control_key=ck, code=code, title=title) for ck, code, title in controls
    ]

    by_fw: dict[str, dict[str, Any]] = {}
    for row in rows:
        fw = by_fw.setdefault(
            row.framework_key,
            {
                "framework_key": row.framework_key,
                "name": row.framework_name,
                "requirements": [],
            },
        )
        fw["requirements"].append(
            ComplianceFrameworkRequirementOut(
                control_key=row.control_key,
                control_code=row.control_code,
                control_title=row.control_title,
                ref=row.ref,
                note=row.note,
                implementation_score=row.implementation_score,
                practice_score=row.practice_score,
            )
        )

    frameworks_out: list[ComplianceProfileFrameworkPreview] = []
    for fw_key, item in by_fw.items():
        impl_percent = framework_implementation_percent(db, tenant_id=ctx.tenant.id, framework_key=fw_key)
        coverage, practice_impl, controls_total = framework_practice_metrics(
            db,
            tenant_id=ctx.tenant.id,
            profile_key=profile_key,
            framework_key=fw_key,
        )
        frameworks_out.append(
            ComplianceProfileFrameworkPreview(
                framework_key=fw_key,
                name=item["name"],
                implementation_percent=impl_percent,
                practice_coverage_percent=coverage,
                practice_implementation_percent=practice_impl,
                controls_total=controls_total,
                requirements_total=len(item["requirements"]),
                requirements=item["requirements"],
            )
        )
    frameworks_out.sort(key=lambda f: f.name.lower())

    return ComplianceProfilePreviewResponse(
        active_profile_key=profile_key,
        frameworks=frameworks_out,
        profile_controls=controls_out,
    )


@router.post("/profile/semantic-match", response_model=ComplianceSemanticMatchResponse)
def run_profile_semantic_match(
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:read")),
) -> ComplianceSemanticMatchResponse:
    from app.services.openai_responses_service import call_openai_responses_json

    profile_key = _pp_active_profile_key(db, tenant_id=ctx.tenant.id)
    if not profile_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No active profile found.")

    rows = compute_preview_rows(db, tenant_id=ctx.tenant.id, profile_key=profile_key)
    if not rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Active profile has no controls.")

    practices = db.scalars(
        select(CompliancePracticeItem).where(CompliancePracticeItem.tenant_id == ctx.tenant.id)
    ).all()
    if not practices:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No practice items found. Add practices first.")

    controls_text = "\n".join(
        f"- [{r.framework_name}] {r.control_code}: {r.control_title} (ref: {r.ref})"
        for r in rows
    )
    practices_text = "\n".join(
        f"- [{p.category or 'General'}] {p.title}: {p.description_text}"
        + (f" (status: {p.status}, frameworks: {', '.join(p.frameworks or [])})" if p.status else "")
        for p in practices
    )

    schema = {
        "type": "object",
        "properties": {
            "analysis_summary": {"type": "string"},
            "overall_coverage_percent": {"type": "number"},
            "recommendations": {"type": "array", "items": {"type": "string"}},
            "framework_results": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "framework_key": {"type": "string"},
                        "framework_name": {"type": "string"},
                        "control_results": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "control_key": {"type": "string"},
                                    "control_code": {"type": "string"},
                                    "control_title": {"type": "string"},
                                    "confidence": {"type": "number"},
                                    "covered_by": {"type": "array", "items": {"type": "string"}},
                                    "gap_description": {"type": "string"},
                                },
                                "required": ["control_key", "control_code", "control_title", "confidence", "covered_by", "gap_description"],
                                "additionalProperties": False,
                            },
                        },
                    },
                    "required": ["framework_key", "framework_name", "control_results"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["analysis_summary", "overall_coverage_percent", "recommendations", "framework_results"],
        "additionalProperties": False,
    }

    instructions = (
        "You are a compliance expert. Analyze how well the given internal practices cover the compliance controls.\n"
        "For each control, assess coverage confidence (0.0–1.0): 0=not covered, 0.5=partially covered, 1.0=fully covered.\n"
        "List which practices (by title) cover each control. Provide a gap description for controls below 0.8 confidence.\n"
        "Compute overall_coverage_percent as the average confidence across all controls (0–100).\n"
        "Provide 3–5 actionable recommendations.\n"
        "Return valid JSON only."
    )
    input_text = (
        f"=== ACTIVE PROFILE CONTROLS ===\n{controls_text}\n\n"
        f"=== OUR PRACTICES ===\n{practices_text}"
    )

    result = call_openai_responses_json(
        instructions=instructions,
        input_text=input_text,
        schema_name="ProfileSemanticMatch",
        schema=schema,
        temperature=0.15,
    )

    by_fw_key: dict[str, str] = {r.framework_key: r.framework_name for r in rows}
    by_fw_controls: dict[str, list] = {}
    for r in rows:
        by_fw_controls.setdefault(r.framework_key, []).append(r)

    fw_results_out = []
    for fw_data in result.get("framework_results", []):
        fw_key = fw_data.get("framework_key", "")
        fw_name = fw_data.get("framework_name", by_fw_key.get(fw_key, fw_key))
        ctrl_results = fw_data.get("control_results", [])
        controls_covered = sum(1 for c in ctrl_results if float(c.get("confidence", 0)) >= 0.5)
        fw_results_out.append(
            ComplianceSemanticMatchFrameworkResult(
                framework_key=fw_key,
                framework_name=fw_name,
                coverage_percent=round(
                    (sum(float(c.get("confidence", 0)) for c in ctrl_results) / len(ctrl_results) * 100)
                    if ctrl_results else 0.0,
                    1,
                ),
                controls_covered=controls_covered,
                controls_total=len(ctrl_results),
                controls=[
                    ComplianceSemanticMatchControlResult(
                        control_key=c.get("control_key", ""),
                        control_code=c.get("control_code", ""),
                        control_title=c.get("control_title", ""),
                        framework_key=fw_key,
                        confidence=round(float(c.get("confidence", 0)), 2),
                        covered_by=c.get("covered_by", []),
                        gap_description=c.get("gap_description") or None,
                    )
                    for c in ctrl_results
                ],
            )
        )

    return ComplianceSemanticMatchResponse(
        overall_coverage_percent=round(float(result.get("overall_coverage_percent", 0)), 1),
        frameworks=fw_results_out,
        analysis_summary=result.get("analysis_summary", ""),
        recommendations=result.get("recommendations", []),
        ran_at=datetime.utcnow(),
    )


@router.post("/library/frameworks", response_model=ComplianceFrameworkOut)
def create_library_framework(
    req: ComplianceTenantFrameworkCreateRequest,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
    __: object = Depends(_require_admin()),
) -> ComplianceFrameworkOut:
    existing = db.get(
        ComplianceTenantFramework,
        {"tenant_id": ctx.tenant.id, "framework_key": req.framework_key},
    )
    if existing and existing.is_active:
        raise HTTPException(status_code=409, detail="Framework already exists")

    if not existing:
        existing = ComplianceTenantFramework(
            tenant_id=ctx.tenant.id,
            framework_key=req.framework_key,
            name=req.name,
            full_name=req.full_name,
            version=req.version,
            type=req.type,
            region=req.region,
            tags=req.tags,
            references=req.references,
            is_active=True,
        )
        db.add(existing)
    else:
        existing.name = req.name
        existing.full_name = req.full_name
        existing.version = req.version
        existing.type = req.type
        existing.region = req.region
        existing.tags = req.tags
        existing.references = req.references
        existing.is_active = True

    db.commit()
    log_action(db, user.id, "compliance.library.framework.create", {"framework_key": req.framework_key})
    return ComplianceFrameworkOut.model_validate(existing)


@router.put("/library/frameworks/{framework_key}", response_model=ComplianceFrameworkOut)
def update_library_framework(
    framework_key: str,
    req: ComplianceTenantFrameworkUpdateRequest,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
    __: object = Depends(_require_admin()),
) -> ComplianceFrameworkOut:
    fw = db.get(ComplianceTenantFramework, {"tenant_id": ctx.tenant.id, "framework_key": framework_key})
    if not fw or not fw.is_active:
        raise HTTPException(status_code=404, detail="Framework not found")

    data = req.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(fw, k, v)

    db.commit()
    log_action(db, user.id, "compliance.library.framework.update", {"framework_key": framework_key})
    return ComplianceFrameworkOut.model_validate(fw)


@router.delete("/library/frameworks/{framework_key}", response_class=Response, response_model=None)
def delete_library_framework(
    framework_key: str,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
    __: object = Depends(_require_admin()),
) -> Response:
    fw = db.get(ComplianceTenantFramework, {"tenant_id": ctx.tenant.id, "framework_key": framework_key})
    if not fw or not fw.is_active:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    fw.is_active = False
    db.execute(
        update(ComplianceTenantControlFrameworkRef)
        .where(
            ComplianceTenantControlFrameworkRef.tenant_id == ctx.tenant.id,
            ComplianceTenantControlFrameworkRef.framework_key == framework_key,
        )
        .values(is_active=False)
    )
    db.commit()
    log_action(db, user.id, "compliance.library.framework.delete", {"framework_key": framework_key})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/library/frameworks/{framework_key}/requirements",
    response_model=ComplianceControlFrameworkRefOut,
)
def add_framework_requirement(
    framework_key: str,
    req: ComplianceFrameworkRequirementCreateRequest,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
    __: object = Depends(_require_admin()),
) -> ComplianceControlFrameworkRefOut:
    # ensure framework exists
    fw = db.get(ComplianceTenantFramework, {"tenant_id": ctx.tenant.id, "framework_key": framework_key})
    if not fw or not fw.is_active:
        raise HTTPException(status_code=404, detail="Framework not found")

    ref = db.get(
        ComplianceTenantControlFrameworkRef,
        {
            "tenant_id": ctx.tenant.id,
            "control_key": req.control_key,
            "framework_key": framework_key,
            "ref": req.ref,
        },
    )
    if ref:
        ref.note = req.note
        ref.is_active = True
    else:
        ref = ComplianceTenantControlFrameworkRef(
            tenant_id=ctx.tenant.id,
            control_key=req.control_key,
            framework_key=framework_key,
            ref=req.ref,
            note=req.note,
            is_active=True,
        )
        db.add(ref)

    db.commit()
    log_action(
        db,
        user.id,
        "compliance.library.framework.requirement.create",
        {"framework_key": framework_key, "control_key": req.control_key, "ref": req.ref},
    )
    return ComplianceControlFrameworkRefOut.model_validate(ref)


@router.put(
    "/library/frameworks/{framework_key}/requirements",
    response_model=ComplianceControlFrameworkRefOut,
)
def update_framework_requirement(
    framework_key: str,
    req: ComplianceFrameworkRequirementUpdateRequest,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
    __: object = Depends(_require_admin()),
) -> ComplianceControlFrameworkRefOut:
    existing = db.get(
        ComplianceTenantControlFrameworkRef,
        {
            "tenant_id": ctx.tenant.id,
            "control_key": req.control_key,
            "framework_key": framework_key,
            "ref": req.old_ref,
        },
    )
    if not existing or not existing.is_active:
        raise HTTPException(status_code=404, detail="Requirement not found")

    if req.old_ref != req.new_ref:
        # rename = delete+insert because ref is part of PK
        db.delete(existing)
        replacement = ComplianceTenantControlFrameworkRef(
            tenant_id=ctx.tenant.id,
            control_key=req.control_key,
            framework_key=framework_key,
            ref=req.new_ref,
            note=req.note,
            is_active=True,
        )
        db.add(replacement)
        db.commit()
        log_action(
            db,
            user.id,
            "compliance.library.framework.requirement.rename",
            {
                "framework_key": framework_key,
                "control_key": req.control_key,
                "old_ref": req.old_ref,
                "new_ref": req.new_ref,
            },
        )
        return ComplianceControlFrameworkRefOut.model_validate(replacement)

    existing.note = req.note
    db.commit()
    log_action(
        db,
        user.id,
        "compliance.library.framework.requirement.update",
        {"framework_key": framework_key, "control_key": req.control_key, "ref": req.old_ref},
    )
    return ComplianceControlFrameworkRefOut.model_validate(existing)


@router.delete(
    "/library/frameworks/{framework_key}/requirements",
    response_class=Response,
    response_model=None,
)
def delete_framework_requirement(
    framework_key: str,
    control_key: str = Query(...),
    ref: str = Query(...),
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
    __: object = Depends(_require_admin()),
) -> Response:
    item = db.get(
        ComplianceTenantControlFrameworkRef,
        {
            "tenant_id": ctx.tenant.id,
            "control_key": control_key,
            "framework_key": framework_key,
            "ref": ref,
        },
    )
    if not item:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    db.delete(item)
    db.commit()
    log_action(
        db,
        user.id,
        "compliance.library.framework.requirement.delete",
        {"framework_key": framework_key, "control_key": control_key, "ref": ref},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/library/rollback/{batch_id}", response_model=ComplianceLibraryImportResponse)
def rollback_library(
    batch_id: UUID,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:admin")),
) -> ComplianceLibraryImportResponse:
    batch = db.get(ComplianceTenantLibraryImportBatch, batch_id)
    if not batch or batch.tenant_id != ctx.tenant.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import batch not found")

    try:
        batch, counts = apply_tenant_library_payload(
            db,
            tenant_id=ctx.tenant.id,
            payload=batch.payload_json,
            payload_sha=batch.payload_sha256,
            source="rollback",
            version_label=batch.version_label,
            imported_by_user_id=current_user.id,
        )
        db.commit()
    except TenantLibraryError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to rollback tenant library.",
        ) from exc

    return ComplianceLibraryImportResponse(batch_id=batch.id, counts=counts)


@router.post("/tenant/profiles/{profile_key}:enable", response_model=ComplianceProfileOut)
def enable_profile(
    profile_key: str,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:write")),
) -> ComplianceProfileOut:
    profile = db.scalar(
        select(ComplianceTenantLibraryProfile).where(
            ComplianceTenantLibraryProfile.profile_key == profile_key,
            ComplianceTenantLibraryProfile.is_active.is_(True),
        )
    )
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")

    db.execute(
        update(ComplianceTenantProfile)
        .where(
            ComplianceTenantProfile.tenant_id == ctx.tenant.id,
            ComplianceTenantProfile.enabled.is_(True),
        )
        .values(enabled=False)
    )

    tenant_profile = db.scalar(
        select(ComplianceTenantProfile).where(
            ComplianceTenantProfile.tenant_id == ctx.tenant.id,
            ComplianceTenantProfile.profile_key == profile.profile_key,
        )
    )
    if tenant_profile:
        tenant_profile.enabled = True
    else:
        tenant_profile = ComplianceTenantProfile(
            tenant_id=ctx.tenant.id,
            profile_key=profile.profile_key,
            enabled=True,
        )
        db.add(tenant_profile)

    control_rows = db.execute(
        select(
            ComplianceTenantLibraryProfileControl.control_key,
            ComplianceTenantControl.default_status,
            ComplianceTenantControl.default_score,
        )
        .join(
            ComplianceTenantControl,
            and_(
                ComplianceTenantControl.tenant_id == ctx.tenant.id,
                ComplianceTenantControl.control_key == ComplianceTenantLibraryProfileControl.control_key,
                ComplianceTenantControl.is_active.is_(True),
            ),
        )
        .where(
            ComplianceTenantLibraryProfileControl.tenant_id == ctx.tenant.id,
            ComplianceTenantLibraryProfileControl.profile_key == profile.profile_key,
        )
    ).all()

    control_keys = [row.control_key for row in control_rows]
    existing_keys: set[str] = set()
    if control_keys:
        existing_keys = set(
            db.scalars(
                select(ComplianceControlStatus.control_key).where(
                    ComplianceControlStatus.tenant_id == ctx.tenant.id,
                    ComplianceControlStatus.control_key.in_(control_keys),
                )
            ).all()
        )

    for row in control_rows:
        if row.control_key in existing_keys:
            continue
        status = row.default_status or "not_started"
        score = float(row.default_score or 0.0)
        na_reason = None
        if status == "na" and score != 0:
            score = 0.0
        if status == "na" and not na_reason:
            na_reason = "seed_default"
        db.add(
            ComplianceControlStatus(
                tenant_id=ctx.tenant.id,
                control_key=row.control_key,
                status_enum=status,
                score=score,
                na_reason=na_reason,
                owner_user_id=current_user.id,
                last_reviewed_at=datetime.utcnow(),
            )
        )

    db.commit()
    db.refresh(profile)
    return ComplianceProfileOut(
        profile_key=profile.profile_key,
        name=profile.name,
        description=profile.description,
        is_active=True,
    )


@router.get("/controls", response_model=list[ComplianceControlListItem])
def list_controls(
    domain_code: str | None = Query(default=None),
    criticality: str | None = Query(default=None),
    status_enum: str | None = Query(default=None),
    framework_key: str | None = Query(default=None),
    q: str | None = Query(default=None),
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:read")),
) -> list[ComplianceControlListItem]:
    profile_key = _active_profile_key(db, ctx.tenant.id)
    if not profile_key:
        return []

    evidence_count_sq = (
        select(func.count(ComplianceEvidence.id))
        .where(
            and_(
                ComplianceEvidence.tenant_id == ctx.tenant.id,
                ComplianceEvidence.control_key == ComplianceTenantControl.control_key,
            )
        )
        .scalar_subquery()
    )

    query = (
        select(
            ComplianceTenantControl,
            ComplianceControlStatus,
            evidence_count_sq.label("evidence_count"),
        )
        .join(
            ComplianceTenantLibraryProfileControl,
            and_(
                ComplianceTenantLibraryProfileControl.tenant_id == ctx.tenant.id,
                ComplianceTenantLibraryProfileControl.control_key == ComplianceTenantControl.control_key,
            ),
        )
        .outerjoin(
            ComplianceControlStatus,
            and_(
                ComplianceControlStatus.control_key == ComplianceTenantControl.control_key,
                ComplianceControlStatus.tenant_id == ctx.tenant.id,
            ),
        )
        .where(
            ComplianceTenantControl.tenant_id == ctx.tenant.id,
            ComplianceTenantControl.is_active.is_(True),
            ComplianceTenantLibraryProfileControl.profile_key == profile_key,
        )
    )

    if domain_code:
        query = query.where(ComplianceTenantControl.domain_code == domain_code)
    if criticality:
        query = query.where(ComplianceTenantControl.criticality == criticality)
    if status_enum:
        query = query.where(ComplianceControlStatus.status_enum == status_enum)
    if framework_key:
        query = (
            query.join(
                ComplianceTenantControlFrameworkRef,
                and_(
                    ComplianceTenantControlFrameworkRef.tenant_id == ctx.tenant.id,
                    ComplianceTenantControlFrameworkRef.control_key == ComplianceTenantControl.control_key,
                    ComplianceTenantControlFrameworkRef.is_active.is_(True),
                ),
            )
            .join(
                ComplianceTenantFramework,
                and_(
                    ComplianceTenantFramework.tenant_id == ctx.tenant.id,
                    ComplianceTenantFramework.framework_key == ComplianceTenantControlFrameworkRef.framework_key,
                    ComplianceTenantFramework.is_active.is_(True),
                ),
            )
            .where(ComplianceTenantFramework.framework_key == framework_key)
        )
    if q:
        query = query.where(
            ComplianceTenantControl.title.ilike(f"%{q}%")
            | ComplianceTenantControl.description.ilike(f"%{q}%")
            | ComplianceTenantControl.code.ilike(f"%{q}%")
        )

    rows = db.execute(query.order_by(ComplianceTenantControl.code.asc())).all()
    items: list[ComplianceControlListItem] = []
    for control, status_row, evidence_count in rows:
        status_out = ComplianceControlStatusOut.model_validate(status_row) if status_row else None
        items.append(
            ComplianceControlListItem(
                control=ComplianceControlOut.model_validate(control),
                status=status_out,
                evidence_count=int(evidence_count or 0),
            )
        )
    return items


@router.get("/controls/{control_key}", response_model=ComplianceControlDetail)
def get_control(
    control_key: str,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:read")),
) -> ComplianceControlDetail:
    control = db.scalar(
        select(ComplianceTenantControl).where(
            ComplianceTenantControl.tenant_id == ctx.tenant.id,
            ComplianceTenantControl.control_key == control_key,
            ComplianceTenantControl.is_active.is_(True),
        )
    )
    if not control:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Control not found")

    status_row = db.scalar(
        select(ComplianceControlStatus).where(
            ComplianceControlStatus.tenant_id == ctx.tenant.id,
            ComplianceControlStatus.control_key == control.control_key,
        )
    )

    evidence_rows = db.scalars(
        select(ComplianceEvidence)
        .where(
            ComplianceEvidence.tenant_id == ctx.tenant.id,
            ComplianceEvidence.control_key == control.control_key,
        )
        .order_by(ComplianceEvidence.created_at.desc())
    ).all()

    ref_rows = db.execute(
        select(
            ComplianceTenantControlFrameworkRef.framework_key,
            ComplianceTenantFramework.name,
            ComplianceTenantControlFrameworkRef.ref,
            ComplianceTenantControlFrameworkRef.note,
        )
        .join(
            ComplianceTenantFramework,
            and_(
                ComplianceTenantFramework.tenant_id == ctx.tenant.id,
                ComplianceTenantFramework.framework_key == ComplianceTenantControlFrameworkRef.framework_key,
                ComplianceTenantFramework.is_active.is_(True),
            ),
        )
        .where(
            ComplianceTenantControlFrameworkRef.tenant_id == ctx.tenant.id,
            ComplianceTenantControlFrameworkRef.control_key == control.control_key,
            ComplianceTenantControlFrameworkRef.is_active.is_(True),
        )
        .order_by(ComplianceTenantFramework.name.asc())
    ).all()

    framework_refs = [
        ComplianceControlFrameworkRefOut(
            framework_key=row.framework_key,
            framework_name=row.name,
            ref=row.ref,
            note=row.note,
        )
        for row in ref_rows
    ]

    return ComplianceControlDetail(
        control=ComplianceControlOut.model_validate(control),
        status=ComplianceControlStatusOut.model_validate(status_row) if status_row else None,
        evidence=[ComplianceEvidenceOut.model_validate(item) for item in evidence_rows],
        framework_refs=framework_refs,
    )


@router.put("/controls/{control_key}/status", response_model=ComplianceControlStatusOut)
def update_status(
    control_key: str,
    payload: ComplianceStatusUpdateRequest,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:write")),
) -> ComplianceControlStatusOut:
    if payload.status_enum not in STATUS_SCORES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid status_enum.")
    if payload.status_enum == "na" and not payload.na_reason:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="na_reason is required.")

    control = db.scalar(
        select(ComplianceTenantControl).where(
            ComplianceTenantControl.tenant_id == ctx.tenant.id,
            ComplianceTenantControl.control_key == control_key,
            ComplianceTenantControl.is_active.is_(True),
        )
    )
    if not control:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Control not found")

    score = STATUS_SCORES[payload.status_enum]
    status_row = db.scalar(
        select(ComplianceControlStatus).where(
            ComplianceControlStatus.tenant_id == ctx.tenant.id,
            ComplianceControlStatus.control_key == control.control_key,
        )
    )

    previous_status = status_row.status_enum if status_row else None
    if status_row:
        status_row.status_enum = payload.status_enum
        status_row.score = score
        status_row.notes = payload.notes
        status_row.na_reason = payload.na_reason
        status_row.owner_user_id = current_user.id
        status_row.last_reviewed_at = datetime.utcnow()
    else:
        status_row = ComplianceControlStatus(
            tenant_id=ctx.tenant.id,
            control_key=control.control_key,
            status_enum=payload.status_enum,
            score=score,
            notes=payload.notes,
            na_reason=payload.na_reason,
            owner_user_id=current_user.id,
            last_reviewed_at=datetime.utcnow(),
        )
        db.add(status_row)

    log_action(
        db,
        actor_user_id=current_user.id,
        action="compliance.status.update",
        entity_type="ComplianceControlStatus",
        entity_id=None,
        details={"control_key": control.control_key, "from": previous_status, "to": payload.status_enum},
    )
    try:
        create_snapshot(
            db,
            tenant_id=ctx.tenant.id,
            scope="overall",
            computed_by_user_id=current_user.id,
        )
    except Exception:  # pragma: no cover - snapshot should not block status updates
        pass
    db.commit()
    db.refresh(status_row)
    return ComplianceControlStatusOut.model_validate(status_row)


@router.post("/controls/{control_key}/evidence", response_model=ComplianceEvidenceOut)
def create_evidence(
    control_key: str,
    payload: ComplianceEvidenceCreateRequest,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:write")),
) -> ComplianceEvidenceOut:
    control = db.scalar(
        select(ComplianceTenantControl).where(
            ComplianceTenantControl.tenant_id == ctx.tenant.id,
            ComplianceTenantControl.control_key == control_key,
            ComplianceTenantControl.is_active.is_(True),
        )
    )
    if not control:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Control not found")

    evidence = ComplianceEvidence(
        tenant_id=ctx.tenant.id,
        control_key=control.control_key,
        type=payload.type,
        title=payload.title,
        url=payload.url,
        text=payload.text,
        tags=payload.tags,
        owner_user_id=current_user.id,
        expires_at=payload.expires_at,
    )
    db.add(evidence)
    db.commit()
    db.refresh(evidence)
    return ComplianceEvidenceOut.model_validate(evidence)


@router.delete(
    "/evidence/{evidence_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    response_model=None,
)
def delete_evidence(
    evidence_id: UUID,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:write")),
) -> None:
    evidence = db.scalar(
        select(ComplianceEvidence).where(
            ComplianceEvidence.id == evidence_id,
            ComplianceEvidence.tenant_id == ctx.tenant.id,
        )
    )
    if not evidence:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evidence not found")
    db.delete(evidence)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/summary", response_model=ComplianceSummaryResponse)
def get_summary(
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:read")),
) -> ComplianceSummaryResponse:
    summary = compute_summary(db, tenant_id=ctx.tenant.id)
    return ComplianceSummaryResponse(**summary)


@router.get("/frameworks/{framework_key}/summary", response_model=ComplianceFrameworkSummaryResponse)
def get_framework_summary(
    framework_key: str,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:read")),
) -> ComplianceFrameworkSummaryResponse:
    summary = compute_framework_summary(db, tenant_id=ctx.tenant.id, framework_key=framework_key)
    if not summary:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Framework not found")
    return ComplianceFrameworkSummaryResponse(**summary)


@router.get("/dashboard", response_model=ComplianceDashboardResponse)
def get_dashboard(
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:read")),
) -> ComplianceDashboardResponse:
    summary = compute_summary(db, tenant_id=ctx.tenant.id)
    last_snapshot = latest_snapshot(db, tenant_id=ctx.tenant.id)
    gaps = list_gaps(db, tenant_id=ctx.tenant.id, threshold=0.75)
    ordered_gaps = order_gaps(gaps)
    gaps_by_severity: dict[str, int] = {}
    for gap in gaps:
        key = gap.criticality or "Unknown"
        gaps_by_severity[key] = gaps_by_severity.get(key, 0) + 1

    open_work_items = db.scalar(
        select(func.count(ComplianceWorkItemLink.id)).where(
            ComplianceWorkItemLink.tenant_id == ctx.tenant.id,
            ComplianceWorkItemLink.status.is_(None) | (ComplianceWorkItemLink.status != "closed"),
        )
    ) or 0

    return ComplianceDashboardResponse(
        implementation=summary["overall"],
        coverage_percent=last_snapshot.coverage_percent if last_snapshot else None,
        gaps_by_severity=gaps_by_severity,
        open_work_items=int(open_work_items),
        last_snapshot_at=last_snapshot.computed_at if last_snapshot else None,
        top_gaps=[ComplianceGapItem.model_validate(item) for item in ordered_gaps[:5]],
    )


@router.get("/trends", response_model=ComplianceTrendResponse)
def get_trend_data(
    scope: str = Query(default="overall"),
    window: int = Query(default=90, ge=7, le=365),
    framework_key: str | None = Query(default=None),
    client_set_version_id: UUID | None = Query(default=None),
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:read")),
) -> ComplianceTrendResponse:
    points = get_trends(
        db,
        tenant_id=ctx.tenant.id,
        scope=scope,
        window_days=window,
        framework_key=framework_key,
        client_set_version_id=client_set_version_id,
    )
    return ComplianceTrendResponse(
        scope=scope,
        points=[
            ComplianceTrendPoint(
                computed_at=item.computed_at,
                implementation_percent=item.implementation_percent,
                coverage_percent=item.coverage_percent,
            )
            for item in points
        ],
    )


@router.post("/snapshots/run", response_model=ComplianceSnapshotOut)
def run_snapshot(
    payload: ComplianceSnapshotRequest,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:admin")),
) -> ComplianceSnapshotOut:
    try:
        snapshot = create_snapshot(
            db,
            tenant_id=ctx.tenant.id,
            scope=payload.scope,
            framework_key=payload.framework_key,
            client_set_version_id=payload.client_set_version_id,
            computed_by_user_id=current_user.id,
        )
        if not snapshot:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No active profile to snapshot.")
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Snapshot failed.") from exc

    return ComplianceSnapshotOut.model_validate(snapshot)


@router.get("/gaps", response_model=list[ComplianceGapItem])
def get_gaps(
    threshold: float = Query(default=0.75, ge=0, le=1),
    framework_key: str | None = Query(default=None),
    domain_code: str | None = Query(default=None),
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:read")),
) -> list[ComplianceGapItem]:
    gaps = list_gaps(
        db,
        tenant_id=ctx.tenant.id,
        threshold=threshold,
        framework_key=framework_key,
        domain_code=domain_code,
    )
    return [ComplianceGapItem.model_validate(item) for item in gaps]


@router.post("/gaps/plan", response_model=ComplianceGapPlanResponse)
def get_gap_plan(
    threshold: float = Query(default=0.75, ge=0, le=1),
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:read")),
) -> ComplianceGapPlanResponse:
    gaps = list_gaps(db, tenant_id=ctx.tenant.id, threshold=threshold)
    ordered = order_gaps(gaps)
    return ComplianceGapPlanResponse(items=[ComplianceGapItem.model_validate(item) for item in ordered])


@router.put("/controls/{control_key}/remediation", response_model=ComplianceControlStatusOut)
def update_remediation(
    control_key: str,
    payload: ComplianceRemediationUpdateRequest,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:write")),
) -> ComplianceControlStatusOut:
    control = db.scalar(
        select(ComplianceTenantControl).where(
            ComplianceTenantControl.tenant_id == ctx.tenant.id,
            ComplianceTenantControl.control_key == control_key,
            ComplianceTenantControl.is_active.is_(True),
        )
    )
    if not control:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Control not found")

    status_row = db.scalar(
        select(ComplianceControlStatus).where(
            ComplianceControlStatus.tenant_id == ctx.tenant.id,
            ComplianceControlStatus.control_key == control.control_key,
        )
    )
    if not status_row:
        na_reason = None
        if control.default_status == "na":
            na_reason = "seed_default"
        status_row = ComplianceControlStatus(
            tenant_id=ctx.tenant.id,
            control_key=control.control_key,
            status_enum=control.default_status or "not_started",
            score=float(control.default_score or 0.0),
            na_reason=na_reason,
            owner_user_id=current_user.id,
            last_reviewed_at=datetime.utcnow(),
        )
        db.add(status_row)

    status_row.target_score = payload.target_score
    status_row.priority = payload.priority
    status_row.due_date = payload.due_date
    status_row.remediation_notes = payload.remediation_notes
    status_row.remediation_owner_user_id = payload.remediation_owner_user_id

    db.commit()
    db.refresh(status_row)
    return ComplianceControlStatusOut.model_validate(status_row)


@router.post("/work-items/link", response_model=ComplianceWorkItemLinkOut)
def create_work_item_link(
    payload: ComplianceWorkItemLinkCreateRequest,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:write")),
) -> ComplianceWorkItemLinkOut:
    link = ComplianceWorkItemLink(
        tenant_id=ctx.tenant.id,
        source_type=payload.source_type,
        source_key=payload.source_key,
        link_type=payload.link_type,
        url=payload.url,
        work_order_id=payload.work_order_id,
        status=payload.status,
        created_by_user_id=current_user.id,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return ComplianceWorkItemLinkOut.model_validate(link)


@router.get("/work-items", response_model=list[ComplianceWorkItemLinkOut])
def list_work_item_links(
    source_type: str = Query(...),
    source_key: str = Query(...),
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:read")),
) -> list[ComplianceWorkItemLinkOut]:
    links = db.scalars(
        select(ComplianceWorkItemLink).where(
            ComplianceWorkItemLink.tenant_id == ctx.tenant.id,
            ComplianceWorkItemLink.source_type == source_type,
            ComplianceWorkItemLink.source_key == source_key,
        )
    ).all()
    return [ComplianceWorkItemLinkOut.model_validate(item) for item in links]


@router.delete("/work-items/{link_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response, response_model=None)
def delete_work_item_link(
    link_id: UUID,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:write")),
) -> Response:
    link = db.scalar(
        select(ComplianceWorkItemLink).where(
            ComplianceWorkItemLink.tenant_id == ctx.tenant.id,
            ComplianceWorkItemLink.id == link_id,
        )
    )
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work item link not found")
    db.delete(link)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/work-items/create-work-order", response_model=ComplianceWorkOrderCreateResponse)
def create_work_order_from_gap(
    payload: ComplianceWorkOrderCreateRequest,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:write")),
    ___: object = Depends(require_access("releases", "releases:write")),
) -> ComplianceWorkOrderCreateResponse:
    wo_id = _generate_work_order_id()
    markdown = work_order_service.compile_work_order_markdown(
        wo_id=wo_id,
        title=payload.title,
        services_touched=[],
        body_markdown=payload.description or "",
    )
    wo = ReleaseWorkOrder(
        wo_id=wo_id,
        title=payload.title,
        body_markdown=payload.description or "",
        raw_markdown=markdown,
        sync_status="disabled",
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(wo)
    db.flush()

    link = ComplianceWorkItemLink(
        tenant_id=ctx.tenant.id,
        source_type=payload.source_type,
        source_key=payload.source_key,
        link_type="work_order",
        work_order_id=wo.id,
        created_by_user_id=current_user.id,
    )
    db.add(link)
    db.commit()

    return ComplianceWorkOrderCreateResponse(work_order_id=wo.id, wo_id=wo.wo_id, link_id=link.id)


@router.post("/practices", response_model=CompliancePracticeItemOut)
def create_practice(
    payload: CompliancePracticeCreateRequest,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:write")),
) -> CompliancePracticeItemOut:
    item = CompliancePracticeItem(
        tenant_id=ctx.tenant.id,
        title=payload.title,
        description_text=payload.description_text,
        category=payload.category,
        status=payload.status,
        frequency=payload.frequency,
        evidence=payload.evidence,
        frameworks=payload.frameworks,
        tags=payload.tags,
        owner_user_id=current_user.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return CompliancePracticeItemOut.model_validate(item)


@router.get("/practices", response_model=CompliancePracticeListResponse)
def list_practices(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    q: str | None = Query(default=None),
    category: str | None = Query(default=None),
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:read")),
) -> CompliancePracticeListResponse:
    base_query = select(CompliancePracticeItem).where(CompliancePracticeItem.tenant_id == ctx.tenant.id)
    if category:
        base_query = base_query.where(CompliancePracticeItem.category == category)
    if q:
        base_query = base_query.where(
            CompliancePracticeItem.title.ilike(f"%{q}%")
            | CompliancePracticeItem.description_text.ilike(f"%{q}%")
        )

    total = db.scalar(select(func.count()).select_from(base_query.subquery()))
    items = db.scalars(
        base_query.order_by(CompliancePracticeItem.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return CompliancePracticeListResponse(
        items=[CompliancePracticeItemOut.model_validate(item) for item in items],
        meta={"page": page, "page_size": page_size, "total": int(total or 0)},
    )


@router.put("/practices/{practice_id}", response_model=CompliancePracticeItemOut)
def update_practice(
    practice_id: UUID,
    payload: CompliancePracticeUpdateRequest,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:write")),
) -> CompliancePracticeItemOut:
    item = db.scalar(
        select(CompliancePracticeItem).where(
            CompliancePracticeItem.tenant_id == ctx.tenant.id,
            CompliancePracticeItem.id == practice_id,
        )
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Practice not found")
    if payload.title is not None:
        item.title = payload.title
    if payload.description_text is not None:
        item.description_text = payload.description_text
    if payload.category is not None:
        item.category = payload.category
    if payload.status is not None:
        item.status = payload.status
    if payload.frequency is not None:
        item.frequency = payload.frequency
    if payload.evidence is not None:
        item.evidence = payload.evidence
    if payload.frameworks is not None:
        item.frameworks = payload.frameworks
    if payload.tags is not None:
        item.tags = payload.tags
    item.updated_at = datetime.utcnow()
    item.owner_user_id = current_user.id
    db.commit()
    db.refresh(item)
    return CompliancePracticeItemOut.model_validate(item)


@router.delete(
    "/practices/{practice_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    response_model=None,
)
def delete_practice(
    practice_id: UUID,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:write")),
) -> Response:
    item = db.scalar(
        select(CompliancePracticeItem).where(
            CompliancePracticeItem.tenant_id == ctx.tenant.id,
            CompliancePracticeItem.id == practice_id,
        )
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Practice not found")
    db.delete(item)
    log_action(
        db,
        actor_user_id=current_user.id,
        action="compliance.practice.delete",
        entity_type="CompliancePracticeItem",
        entity_id=item.id,
        details={},
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/practices/{practice_id}/match", response_model=CompliancePracticeMatchResponse)
def match_practice(
    practice_id: UUID,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:write")),
) -> CompliancePracticeMatchResponse:
    item = db.scalar(
        select(CompliancePracticeItem).where(
            CompliancePracticeItem.tenant_id == ctx.tenant.id,
            CompliancePracticeItem.id == practice_id,
        )
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Practice not found")

    run, results = run_practice_match(db, tenant_id=ctx.tenant.id, practice_item=item, run_type="single")
    db.commit()
    return CompliancePracticeMatchResponse(
        run=CompliancePracticeMatchRunOut.model_validate(run),
        results=[CompliancePracticeMatchResultOut.model_validate(r) for r in results],
    )


@router.post("/practices/match/bulk", response_model=list[CompliancePracticeMatchResponse])
def match_practices_bulk(
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:write")),
) -> list[CompliancePracticeMatchResponse]:
    items = db.scalars(
        select(CompliancePracticeItem).where(CompliancePracticeItem.tenant_id == ctx.tenant.id)
    ).all()
    responses: list[CompliancePracticeMatchResponse] = []
    for item in items:
        run, results = run_practice_match(db, tenant_id=ctx.tenant.id, practice_item=item, run_type="bulk")
        responses.append(
            CompliancePracticeMatchResponse(
                run=CompliancePracticeMatchRunOut.model_validate(run),
                results=[CompliancePracticeMatchResultOut.model_validate(r) for r in results],
            )
        )
    db.commit()
    return responses


@router.get("/practices/{practice_id}/results", response_model=list[CompliancePracticeMatchResultOut])
def list_practice_results(
    practice_id: UUID,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:read")),
) -> list[CompliancePracticeMatchResultOut]:
    results = db.scalars(
        select(CompliancePracticeMatchResult)
        .where(
            CompliancePracticeMatchResult.tenant_id == ctx.tenant.id,
            CompliancePracticeMatchResult.practice_item_id == practice_id,
        )
        .order_by(CompliancePracticeMatchResult.created_at.desc())
    ).all()
    return [CompliancePracticeMatchResultOut.model_validate(r) for r in results]


@router.put("/practices/results/{result_id}", response_model=CompliancePracticeMatchResultOut)
def update_practice_result(
    result_id: UUID,
    payload: CompliancePracticeMatchOverrideRequest,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:write")),
) -> CompliancePracticeMatchResultOut:
    result = db.scalar(
        select(CompliancePracticeMatchResult).where(
            CompliancePracticeMatchResult.tenant_id == ctx.tenant.id,
            CompliancePracticeMatchResult.id == result_id,
        )
    )
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match result not found")
    result.accepted = payload.accepted
    result.manual_override = payload.manual_override
    result.override_reason = payload.override_reason
    db.commit()
    db.refresh(result)
    return CompliancePracticeMatchResultOut.model_validate(result)


@router.post("/practices/{practice_id}/apply", response_model=CompliancePracticeMatchResponse)
def apply_practice_mapping(
    practice_id: UUID,
    payload: CompliancePracticeApplyRequest,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:write")),
) -> CompliancePracticeMatchResponse:
    item = db.scalar(
        select(CompliancePracticeItem).where(
            CompliancePracticeItem.tenant_id == ctx.tenant.id,
            CompliancePracticeItem.id == practice_id,
        )
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Practice not found")

    results = db.scalars(
        select(CompliancePracticeMatchResult).where(
            CompliancePracticeMatchResult.tenant_id == ctx.tenant.id,
            CompliancePracticeMatchResult.practice_item_id == practice_id,
            CompliancePracticeMatchResult.id.in_(payload.result_ids),
        )
    ).all()

    if not results:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No matching results to apply.")

    for result in results:
        if payload.add_evidence:
            evidence_items = result.suggested_evidence_json.get("items") if isinstance(result.suggested_evidence_json, dict) else []
            if not evidence_items:
                evidence_items = [{"type": "text", "value": item.description_text}]
            if item.evidence:
                value = str(item.evidence).strip()
                if value:
                    evidence_items = list(evidence_items) + [
                        {"type": "link" if value.startswith("http") else "text", "value": value}
                    ]
            for ev in evidence_items:
                ev_type = ev.get("type") or "text"
                ev_value = ev.get("value") or ""
                evidence = ComplianceEvidence(
                    tenant_id=ctx.tenant.id,
                    control_key=result.control_key,
                    type=ev_type,
                    title=f"Practice: {item.title}",
                    url=ev_value if ev_type == "link" else None,
                    text=ev_value if ev_type == "text" else None,
                    owner_user_id=current_user.id,
                )
                db.add(evidence)

        if payload.set_status:
            if payload.set_status not in STATUS_SCORES:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid status.")
            status_row = db.scalar(
                select(ComplianceControlStatus).where(
                    ComplianceControlStatus.tenant_id == ctx.tenant.id,
                    ComplianceControlStatus.control_key == result.control_key,
                )
            )
            if not status_row:
                status_row = ComplianceControlStatus(
                    tenant_id=ctx.tenant.id,
                    control_key=result.control_key,
                    status_enum=payload.set_status,
                    score=STATUS_SCORES[payload.set_status],
                    owner_user_id=current_user.id,
                    last_reviewed_at=datetime.utcnow(),
                )
                if payload.set_status == "na":
                    status_row.na_reason = "practice_mapping"
                db.add(status_row)
            else:
                status_row.status_enum = payload.set_status
                status_row.score = STATUS_SCORES[payload.set_status]
                status_row.owner_user_id = current_user.id
                status_row.last_reviewed_at = datetime.utcnow()
                if payload.set_status == "na" and not status_row.na_reason:
                    status_row.na_reason = "practice_mapping"

    log_action(
        db,
        actor_user_id=current_user.id,
        action="compliance.practice.apply",
        entity_type="CompliancePracticeItem",
        entity_id=item.id,
        details={"result_ids": [str(r.id) for r in results]},
    )
    try:
        create_snapshot(
            db,
            tenant_id=ctx.tenant.id,
            scope="overall",
            computed_by_user_id=current_user.id,
        )
    except Exception:  # pragma: no cover
        pass
    db.commit()

    run = db.get(CompliancePracticeMatchRun, results[0].run_id) if results else None
    return CompliancePracticeMatchResponse(
        run=CompliancePracticeMatchRunOut.model_validate(run) if run else None,
        results=[CompliancePracticeMatchResultOut.model_validate(r) for r in results],
    )


@router.get("/clients", response_model=ComplianceClientOverviewResponse)
def list_clients(
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:read")),
) -> ComplianceClientOverviewResponse:
    groups = db.scalars(
        select(ComplianceClientGroup).where(ComplianceClientGroup.tenant_id == ctx.tenant.id)
    ).all()
    items: list[ComplianceClientOverviewItem] = []
    for group in groups:
        version = db.scalar(
            select(ComplianceClientSetVersion)
            .where(
                ComplianceClientSetVersion.tenant_id == ctx.tenant.id,
                ComplianceClientSetVersion.client_group_id == group.id,
                ComplianceClientSetVersion.is_active_version.is_(True),
            )
            .order_by(ComplianceClientSetVersion.created_at.desc())
            .limit(1)
        )
        compliance_percent, gap_count = (None, 0)
        if version:
            compliance_percent, gap_count = _client_compliance(
                db,
                tenant_id=ctx.tenant.id,
                version_id=version.id,
            )
        items.append(
            ComplianceClientOverviewItem(
                group=ComplianceClientGroupOut.model_validate(group),
                active_version=ComplianceClientVersionOut.model_validate(version) if version else None,
                compliance_percent=compliance_percent,
                gap_count=gap_count,
            )
        )
    return ComplianceClientOverviewResponse(items=items)


@router.post("/clients", response_model=ComplianceClientGroupOut)
def create_client_group(
    payload: ComplianceClientGroupCreateRequest,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:write")),
) -> ComplianceClientGroupOut:
    group = ComplianceClientGroup(
        tenant_id=ctx.tenant.id,
        country=payload.country,
        bank_name=payload.bank_name,
        project=payload.project,
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    return ComplianceClientGroupOut.model_validate(group)


@router.get("/clients/{group_id}", response_model=ComplianceClientGroupDetail)
def get_client_group(
    group_id: UUID,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:read")),
) -> ComplianceClientGroupDetail:
    group = db.scalar(
        select(ComplianceClientGroup).where(
            ComplianceClientGroup.tenant_id == ctx.tenant.id,
            ComplianceClientGroup.id == group_id,
        )
    )
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client group not found")
    versions = db.scalars(
        select(ComplianceClientSetVersion)
        .where(
            ComplianceClientSetVersion.tenant_id == ctx.tenant.id,
            ComplianceClientSetVersion.client_group_id == group.id,
        )
        .order_by(ComplianceClientSetVersion.created_at.desc())
    ).all()
    return ComplianceClientGroupDetail(
        group=ComplianceClientGroupOut.model_validate(group),
        versions=[ComplianceClientVersionOut.model_validate(v) for v in versions],
    )


@router.post("/clients/{group_id}/versions", response_model=ComplianceClientVersionOut)
def create_client_version(
    group_id: UUID,
    payload: ComplianceClientVersionCreateRequest,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:write")),
) -> ComplianceClientVersionOut:
    group = db.scalar(
        select(ComplianceClientGroup).where(
            ComplianceClientGroup.tenant_id == ctx.tenant.id,
            ComplianceClientGroup.id == group_id,
        )
    )
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client group not found")

    db.execute(
        update(ComplianceClientSetVersion)
        .where(
            ComplianceClientSetVersion.tenant_id == ctx.tenant.id,
            ComplianceClientSetVersion.client_group_id == group.id,
            ComplianceClientSetVersion.is_active_version.is_(True),
        )
        .values(is_active_version=False)
    )

    version = ComplianceClientSetVersion(
        tenant_id=ctx.tenant.id,
        client_group_id=group.id,
        version_label=payload.version_label,
        is_active_version=True,
        created_by_user_id=current_user.id,
        library_batch_id=db.scalar(
            select(ComplianceTenantLibraryImportBatch.id)
            .where(ComplianceTenantLibraryImportBatch.tenant_id == ctx.tenant.id)
            .order_by(ComplianceTenantLibraryImportBatch.imported_at.desc())
            .limit(1)
        ),
    )
    db.add(version)
    db.flush()

    requirements_text = parse_requirements(payload.requirements_text)
    for idx, text_item in enumerate(requirements_text):
        db.add(
            ComplianceClientRequirement(
                tenant_id=ctx.tenant.id,
                client_set_version_id=version.id,
                text=text_item,
                order_index=idx,
            )
        )

    db.commit()
    db.refresh(version)
    return ComplianceClientVersionOut.model_validate(version)


@router.put("/clients/versions/{version_id}", response_model=ComplianceClientVersionOut)
def update_client_version(
    version_id: UUID,
    payload: ComplianceClientVersionUpdateRequest,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:write")),
) -> ComplianceClientVersionOut:
    version = db.scalar(
        select(ComplianceClientSetVersion).where(
            ComplianceClientSetVersion.tenant_id == ctx.tenant.id,
            ComplianceClientSetVersion.id == version_id,
        )
    )
    if not version:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client version not found")
    if payload.version_label is not None:
        version.version_label = payload.version_label
    if payload.requirements_text is not None:
        db.execute(
            delete(ComplianceClientRequirement).where(
                ComplianceClientRequirement.tenant_id == ctx.tenant.id,
                ComplianceClientRequirement.client_set_version_id == version.id,
            )
        )
        for idx, text_item in enumerate(parse_requirements(payload.requirements_text)):
            db.add(
                ComplianceClientRequirement(
                    tenant_id=ctx.tenant.id,
                    client_set_version_id=version.id,
                    text=text_item,
                    order_index=idx,
                )
            )
    db.commit()
    db.refresh(version)
    return ComplianceClientVersionOut.model_validate(version)


@router.get("/clients/versions/{version_id}", response_model=ComplianceClientVersionDetail)
def get_client_version(
    version_id: UUID,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:read")),
) -> ComplianceClientVersionDetail:
    version = db.scalar(
        select(ComplianceClientSetVersion).where(
            ComplianceClientSetVersion.tenant_id == ctx.tenant.id,
            ComplianceClientSetVersion.id == version_id,
        )
    )
    if not version:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client version not found")

    reqs = db.scalars(
        select(ComplianceClientRequirement)
        .where(
            ComplianceClientRequirement.tenant_id == ctx.tenant.id,
            ComplianceClientRequirement.client_set_version_id == version.id,
        )
        .order_by(ComplianceClientRequirement.order_index.asc())
    ).all()
    return ComplianceClientVersionDetail(
        version=ComplianceClientVersionOut.model_validate(version),
        requirements=[ComplianceClientRequirementOut.model_validate(req) for req in reqs],
    )


@router.post("/clients/versions/{version_id}/match", response_model=ComplianceClientMatchResponse)
def match_client_version(
    version_id: UUID,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:write")),
) -> ComplianceClientMatchResponse:
    version = db.scalar(
        select(ComplianceClientSetVersion).where(
            ComplianceClientSetVersion.tenant_id == ctx.tenant.id,
            ComplianceClientSetVersion.id == version_id,
        )
    )
    if not version:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client version not found")

    reqs = db.scalars(
        select(ComplianceClientRequirement).where(
            ComplianceClientRequirement.tenant_id == ctx.tenant.id,
            ComplianceClientRequirement.client_set_version_id == version.id,
        )
    ).all()

    run, results = run_client_match(
        db,
        tenant_id=ctx.tenant.id,
        version=version,
        requirements=reqs,
        run_type="single",
    )
    version.last_matched_at = datetime.utcnow()
    try:
        create_snapshot(
            db,
            tenant_id=ctx.tenant.id,
            scope="client_set",
            client_set_version_id=version.id,
            computed_by_user_id=current_user.id,
        )
    except Exception:  # pragma: no cover
        pass
    db.commit()
    return ComplianceClientMatchResponse(
        run=ComplianceClientMatchRunOut.model_validate(run),
        results=[ComplianceClientMatchResultOut.model_validate(r) for r in results],
    )


@router.post("/clients/match/bulk", response_model=list[ComplianceClientMatchResponse])
def match_clients_bulk(
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:write")),
) -> list[ComplianceClientMatchResponse]:
    versions = db.scalars(
        select(ComplianceClientSetVersion).where(
            ComplianceClientSetVersion.tenant_id == ctx.tenant.id,
            ComplianceClientSetVersion.is_active_version.is_(True),
        )
    ).all()
    responses: list[ComplianceClientMatchResponse] = []
    for version in versions:
        reqs = db.scalars(
            select(ComplianceClientRequirement).where(
                ComplianceClientRequirement.tenant_id == ctx.tenant.id,
                ComplianceClientRequirement.client_set_version_id == version.id,
            )
        ).all()
        run, results = run_client_match(
            db,
            tenant_id=ctx.tenant.id,
            version=version,
            requirements=reqs,
            run_type="bulk",
        )
        version.last_matched_at = datetime.utcnow()
        try:
            create_snapshot(
                db,
                tenant_id=ctx.tenant.id,
                scope="client_set",
                client_set_version_id=version.id,
                computed_by_user_id=current_user.id,
            )
        except Exception:  # pragma: no cover
            pass
        responses.append(
            ComplianceClientMatchResponse(
                run=ComplianceClientMatchRunOut.model_validate(run),
                results=[ComplianceClientMatchResultOut.model_validate(r) for r in results],
            )
        )
    db.commit()
    return responses


@router.get("/clients/versions/{version_id}/results", response_model=list[ComplianceClientMatchResultOut])
def list_client_results(
    version_id: UUID,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:read")),
) -> list[ComplianceClientMatchResultOut]:
    results = db.scalars(
        select(ComplianceClientMatchResult)
        .join(
            ComplianceClientRequirement,
            ComplianceClientRequirement.id == ComplianceClientMatchResult.client_requirement_id,
        )
        .where(
            ComplianceClientMatchResult.tenant_id == ctx.tenant.id,
            ComplianceClientRequirement.client_set_version_id == version_id,
        )
        .order_by(ComplianceClientMatchResult.created_at.desc())
    ).all()
    return [ComplianceClientMatchResultOut.model_validate(r) for r in results]


@router.get("/clients/versions/{version_id}/history", response_model=list[ComplianceClientMatchRunOut])
def list_client_history(
    version_id: UUID,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:read")),
) -> list[ComplianceClientMatchRunOut]:
    runs = db.scalars(
        select(ComplianceClientMatchRun)
        .where(
            ComplianceClientMatchRun.tenant_id == ctx.tenant.id,
            ComplianceClientMatchRun.client_set_version_id == version_id,
        )
        .order_by(ComplianceClientMatchRun.started_at.desc())
    ).all()
    return [ComplianceClientMatchRunOut.model_validate(run) for run in runs]


@router.put("/clients/results/{result_id}", response_model=ComplianceClientMatchResultOut)
def update_client_result(
    result_id: UUID,
    payload: ComplianceClientMatchOverrideRequest,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:write")),
) -> ComplianceClientMatchResultOut:
    result = db.scalar(
        select(ComplianceClientMatchResult).where(
            ComplianceClientMatchResult.tenant_id == ctx.tenant.id,
            ComplianceClientMatchResult.id == result_id,
        )
    )
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match result not found")
    result.accepted = payload.accepted
    result.manual_override = payload.manual_override
    result.override_reason = payload.override_reason
    db.commit()
    db.refresh(result)
    return ComplianceClientMatchResultOut.model_validate(result)


@router.post("/admin/import-seed", response_model=ComplianceSeedImportResponse)
def import_seed(
    payload: ComplianceSeedImportRequest,
    _ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("compliance", "compliance:admin")),
) -> ComplianceSeedImportResponse:
    try:
        data, sha, source = load_seed_payload_from_request(payload.payload, payload.server_file)
    except SeedImportError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    try:
        batch, counts = import_seed_payload(
            db,
            payload=data,
            payload_sha=sha,
            source=source,
            imported_by_user_id=current_user.id,
        )
        db.commit()
    except SeedImportError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to import seed payload.",
        ) from exc

    return ComplianceSeedImportResponse(batch_id=batch.id, counts=counts)
