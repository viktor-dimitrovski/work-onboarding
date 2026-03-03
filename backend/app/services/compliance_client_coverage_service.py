from __future__ import annotations

from collections import defaultdict
from typing import Any
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models.compliance import (
    ComplianceClientMatchResult,
    ComplianceClientRequirement,
    ComplianceControlStatus,
    ComplianceEvidence,
    ComplianceTenantControl,
    ComplianceTenantControlFrameworkRef,
    ComplianceTenantFramework,
)
from app.schemas.compliance import (
    ComplianceClientCoverageResponse,
    ComplianceClientRequirementCoverage,
    ComplianceClientRequirementCoverageControl,
    ComplianceControlFrameworkRefOut,
    ComplianceEvidenceSummaryOut,
)


def compute_client_coverage(
    db: Session,
    *,
    tenant_id: UUID,
    version_id: UUID,
) -> tuple[ComplianceClientCoverageResponse, dict[UUID, float]]:
    requirements = db.scalars(
        select(ComplianceClientRequirement)
        .where(
            ComplianceClientRequirement.tenant_id == tenant_id,
            ComplianceClientRequirement.client_set_version_id == version_id,
        )
        .order_by(ComplianceClientRequirement.order_index.asc())
    ).all()
    if not requirements:
        return ComplianceClientCoverageResponse(), {}

    req_ids = [req.id for req in requirements]
    results = db.scalars(
        select(ComplianceClientMatchResult).where(
            ComplianceClientMatchResult.tenant_id == tenant_id,
            ComplianceClientMatchResult.client_requirement_id.in_(req_ids),
            ComplianceClientMatchResult.accepted.is_(True),
        )
    ).all()

    results_by_req: dict[UUID, list[ComplianceClientMatchResult]] = defaultdict(list)
    control_keys: set[str] = set()
    for result in results:
        results_by_req[result.client_requirement_id].append(result)
        if result.control_key:
            control_keys.add(result.control_key)

    if not control_keys:
        empty_requirements = [
            ComplianceClientRequirementCoverage(
                requirement_id=req.id,
                requirement_text=req.text,
                coverage_percent=0.0,
                match_confidence=None,
                controls=[],
                evidence=[],
                evidence_count=0,
            )
            for req in requirements
        ]
        coverage_map = {req.id: 0.0 for req in requirements}
        return ComplianceClientCoverageResponse(
            overall_percent=0.0,
            coverage_percent=0.0,
            requirements=empty_requirements,
        ), coverage_map

    control_rows = db.execute(
        select(
            ComplianceTenantControl.control_key,
            ComplianceTenantControl.code,
            ComplianceTenantControl.title,
            ComplianceTenantControl.default_score,
        ).where(
            ComplianceTenantControl.tenant_id == tenant_id,
            ComplianceTenantControl.control_key.in_(control_keys),
            ComplianceTenantControl.is_active.is_(True),
        )
    ).all()
    control_info: dict[str, dict[str, Any]] = {
        row.control_key: {
            "code": row.code,
            "title": row.title,
            "default_score": float(row.default_score or 0.0),
        }
        for row in control_rows
    }

    status_rows = db.execute(
        select(ComplianceControlStatus.control_key, ComplianceControlStatus.score).where(
            ComplianceControlStatus.tenant_id == tenant_id,
            ComplianceControlStatus.control_key.in_(control_keys),
        )
    ).all()
    control_scores = {
        row.control_key: float(row.score or 0.0) for row in status_rows if row.control_key
    }
    for key, info in control_info.items():
        if key not in control_scores:
            control_scores[key] = float(info.get("default_score", 0.0))

    framework_rows = db.execute(
        select(
            ComplianceTenantControlFrameworkRef.control_key,
            ComplianceTenantControlFrameworkRef.framework_key,
            ComplianceTenantFramework.name,
            ComplianceTenantControlFrameworkRef.ref,
            ComplianceTenantControlFrameworkRef.note,
        )
        .join(
            ComplianceTenantFramework,
            and_(
                ComplianceTenantFramework.tenant_id == tenant_id,
                ComplianceTenantFramework.framework_key == ComplianceTenantControlFrameworkRef.framework_key,
                ComplianceTenantFramework.is_active.is_(True),
            ),
        )
        .where(
            ComplianceTenantControlFrameworkRef.tenant_id == tenant_id,
            ComplianceTenantControlFrameworkRef.control_key.in_(control_keys),
            ComplianceTenantControlFrameworkRef.is_active.is_(True),
        )
    ).all()
    framework_refs: dict[str, list[ComplianceControlFrameworkRefOut]] = defaultdict(list)
    for control_key, framework_key, framework_name, ref, note in framework_rows:
        framework_refs[control_key].append(
            ComplianceControlFrameworkRefOut(
                framework_key=framework_key,
                framework_name=framework_name,
                ref=ref,
                note=note,
            )
        )

    evidence_rows = db.scalars(
        select(ComplianceEvidence).where(
            ComplianceEvidence.tenant_id == tenant_id,
            ComplianceEvidence.control_key.in_(control_keys),
        )
    ).all()
    evidence_map: dict[str, list[ComplianceEvidenceSummaryOut]] = defaultdict(list)
    for ev in evidence_rows:
        evidence_map[ev.control_key].append(
            ComplianceEvidenceSummaryOut(
                id=ev.id,
                control_key=ev.control_key,
                type=ev.type,
                title=ev.title,
                url=ev.url,
            )
        )

    weight_map = {"high": 3, "medium": 2, "low": 1}
    total_weight = 0.0
    total_score = 0.0
    covered_requirements = 0
    coverage_map: dict[UUID, float] = {}
    requirement_payloads: list[ComplianceClientRequirementCoverage] = []

    for req in requirements:
        req_results = results_by_req.get(req.id, [])
        best_impl_score = 0.0
        best_confidence = None
        controls_payload: list[ComplianceClientRequirementCoverageControl] = []
        evidence_by_id: dict[UUID, ComplianceEvidenceSummaryOut] = {}

        for result in req_results:
            info = control_info.get(result.control_key)
            if not info:
                continue
            match_conf = float(result.confidence or 0.0)
            match_cov = float(result.coverage_score or 0.0) or match_conf
            impl_score = float(control_scores.get(result.control_key, 0.0))
            best_impl_score = max(best_impl_score, impl_score)
            best_confidence = max(best_confidence or 0.0, match_conf)

            controls_payload.append(
                ComplianceClientRequirementCoverageControl(
                    control_key=result.control_key,
                    control_code=info["code"],
                    control_title=info["title"],
                    match_confidence=match_conf,
                    match_coverage_score=match_cov,
                    accepted=True,
                    implementation_score=impl_score,
                    framework_refs=framework_refs.get(result.control_key, []),
                )
            )

            for ev in evidence_map.get(result.control_key, []):
                evidence_by_id[ev.id] = ev

        controls_payload.sort(key=lambda item: item.match_confidence, reverse=True)
        evidence_list = list(evidence_by_id.values())

        if controls_payload:
            covered_requirements += 1

        coverage_percent = best_impl_score if controls_payload else 0.0
        coverage_map[req.id] = coverage_percent

        requirement_payloads.append(
            ComplianceClientRequirementCoverage(
                requirement_id=req.id,
                requirement_text=req.text,
                coverage_percent=coverage_percent,
                match_confidence=best_confidence,
                controls=controls_payload,
                evidence=evidence_list,
                evidence_count=len(evidence_list),
            )
        )

        weight = float(weight_map.get((req.priority or "medium").lower(), 1))
        total_weight += weight
        total_score += coverage_percent * weight

    overall_percent = total_score / total_weight if total_weight > 0 else None
    coverage_percent = covered_requirements / len(requirements) if requirements else None

    return (
        ComplianceClientCoverageResponse(
            overall_percent=overall_percent,
            coverage_percent=coverage_percent,
            requirements=requirement_payloads,
        ),
        coverage_map,
    )
