from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models.compliance import (
    ComplianceControlStatus,
    ComplianceTenantControl,
    ComplianceTenantControlFrameworkRef,
    ComplianceTenantFramework,
    ComplianceTenantLibraryProfileControl,
    ComplianceTenantProfile,
)
from app.services.compliance_summary_service import STATUS_SCORES


@dataclass
class GapItem:
    control_key: str
    code: str
    title: str
    domain_code: str
    criticality: str
    weight: int
    status_enum: str | None
    score: float
    gap_score: float
    priority: str | None
    due_date: Any
    remediation_notes: str | None
    remediation_owner_user_id: UUID | None
    framework_keys: list[str]


def list_gaps(
    db: Session,
    *,
    tenant_id: UUID,
    threshold: float,
    framework_key: str | None = None,
    domain_code: str | None = None,
) -> list[GapItem]:
    profile_key = _active_profile_key(db, tenant_id)
    if not profile_key:
        return []

    framework_map = _framework_map(db, tenant_id=tenant_id, profile_key=profile_key)

    query = (
        select(
            ComplianceTenantControl.control_key,
            ComplianceTenantControl.code,
            ComplianceTenantControl.title,
            ComplianceTenantControl.domain_code,
            ComplianceTenantControl.criticality,
            ComplianceTenantControl.weight,
            ComplianceTenantControl.default_status,
            ComplianceTenantControl.default_score,
            ComplianceControlStatus.status_enum,
            ComplianceControlStatus.score,
            ComplianceControlStatus.priority,
            ComplianceControlStatus.due_date,
            ComplianceControlStatus.remediation_notes,
            ComplianceControlStatus.remediation_owner_user_id,
        )
        .join(
            ComplianceTenantLibraryProfileControl,
            and_(
                ComplianceTenantLibraryProfileControl.tenant_id == tenant_id,
                ComplianceTenantLibraryProfileControl.control_key == ComplianceTenantControl.control_key,
                ComplianceTenantLibraryProfileControl.profile_key == profile_key,
            ),
        )
        .outerjoin(
            ComplianceControlStatus,
            and_(
                ComplianceControlStatus.tenant_id == tenant_id,
                ComplianceControlStatus.control_key == ComplianceTenantControl.control_key,
            ),
        )
        .where(
            ComplianceTenantControl.tenant_id == tenant_id,
            ComplianceTenantControl.is_active.is_(True),
        )
    )

    if domain_code:
        query = query.where(ComplianceTenantControl.domain_code == domain_code)

    if framework_key:
        query = (
            query.join(
                ComplianceTenantControlFrameworkRef,
                and_(
                    ComplianceTenantControlFrameworkRef.tenant_id == tenant_id,
                    ComplianceTenantControlFrameworkRef.control_key == ComplianceTenantControl.control_key,
                    ComplianceTenantControlFrameworkRef.is_active.is_(True),
                ),
            )
            .join(
                ComplianceTenantFramework,
                and_(
                    ComplianceTenantFramework.tenant_id == tenant_id,
                    ComplianceTenantFramework.framework_key == ComplianceTenantControlFrameworkRef.framework_key,
                    ComplianceTenantFramework.is_active.is_(True),
                ),
            )
            .where(ComplianceTenantFramework.framework_key == framework_key)
        )

    rows = db.execute(query).all()
    gaps: list[GapItem] = []
    for row in rows:
        (
            control_key,
            code,
            title,
            domain,
            criticality,
            weight,
            default_status,
            default_score,
            status_enum,
            score,
            priority,
            due_date,
            remediation_notes,
            remediation_owner_user_id,
        ) = row
        resolved_status = status_enum or default_status or "not_started"
        resolved_score = float(score if status_enum else default_score or STATUS_SCORES.get(resolved_status, 0.0))
        if resolved_status == "na":
            continue
        if resolved_score >= threshold:
            continue
        gaps.append(
            GapItem(
                control_key=control_key,
                code=code,
                title=title,
                domain_code=domain,
                criticality=criticality,
                weight=int(weight or 0),
                status_enum=resolved_status,
                score=resolved_score,
                gap_score=max(0.0, 1.0 - resolved_score),
                priority=priority,
                due_date=due_date,
                remediation_notes=remediation_notes,
                remediation_owner_user_id=remediation_owner_user_id,
                framework_keys=framework_map.get(control_key, []),
            )
        )
    return gaps


def order_gaps(gaps: list[GapItem]) -> list[GapItem]:
    priority_rank = {"high": 0, "medium": 1, "low": 2}
    criticality_rank = {"High": 0, "Medium": 1, "Low": 2}

    def _key(item: GapItem) -> tuple:
        priority_score = priority_rank.get((item.priority or "").lower(), 9)
        crit_score = criticality_rank.get(item.criticality, 9)
        return (priority_score, crit_score, -item.weight, item.score)

    return sorted(gaps, key=_key)


def _active_profile_key(db: Session, tenant_id: UUID) -> str | None:
    return db.scalar(
        select(ComplianceTenantProfile.profile_key).where(
            ComplianceTenantProfile.tenant_id == tenant_id,
            ComplianceTenantProfile.enabled.is_(True),
        )
    )


def _framework_map(db: Session, *, tenant_id: UUID, profile_key: str) -> dict[str, list[str]]:
    rows = db.execute(
        select(
            ComplianceTenantLibraryProfileControl.control_key,
            ComplianceTenantControlFrameworkRef.framework_key,
        )
        .join(
            ComplianceTenantControlFrameworkRef,
            and_(
                ComplianceTenantControlFrameworkRef.tenant_id == tenant_id,
                ComplianceTenantControlFrameworkRef.control_key == ComplianceTenantLibraryProfileControl.control_key,
                ComplianceTenantControlFrameworkRef.is_active.is_(True),
            ),
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
            ComplianceTenantLibraryProfileControl.tenant_id == tenant_id,
            ComplianceTenantLibraryProfileControl.profile_key == profile_key,
        )
    ).all()

    mapping: dict[str, list[str]] = {}
    for control_key, framework_key in rows:
        mapping.setdefault(control_key, []).append(framework_key)
    return mapping
