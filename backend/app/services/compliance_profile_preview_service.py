from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models.compliance import (
    ComplianceControlStatus,
    CompliancePracticeItem,
    CompliancePracticeMatchResult,
    ComplianceTenantControl,
    ComplianceTenantControlFrameworkRef,
    ComplianceTenantFramework,
    ComplianceTenantLibraryProfileControl,
    ComplianceTenantProfile,
)
from app.services.compliance_summary_service import compute_framework_summary


STATUS_SCORES_PRACTICE: dict[str, float] = {
    "Planned": 0.0,
    "In Progress": 0.25,
    "Partially Implemented": 0.5,
    "Fully Implemented": 1.0,
    "Continuous/Optimized": 1.0,
}


@dataclass
class RequirementRow:
    framework_key: str
    framework_name: str
    control_key: str
    control_code: str
    control_title: str
    ref: str
    note: str | None
    implementation_score: float | None
    practice_score: float | None


def active_profile_key(db: Session, *, tenant_id: UUID) -> str | None:
    return db.scalar(
        select(ComplianceTenantProfile.profile_key).where(
            ComplianceTenantProfile.tenant_id == tenant_id,
            ComplianceTenantProfile.enabled.is_(True),
        )
    )


def profile_controls(db: Session, *, tenant_id: UUID, profile_key: str) -> list[tuple[str, str, str]]:
    rows = db.execute(
        select(
            ComplianceTenantControl.control_key,
            ComplianceTenantControl.code,
            ComplianceTenantControl.title,
        )
        .join(
            ComplianceTenantLibraryProfileControl,
            and_(
                ComplianceTenantLibraryProfileControl.tenant_id == tenant_id,
                ComplianceTenantLibraryProfileControl.control_key == ComplianceTenantControl.control_key,
                ComplianceTenantLibraryProfileControl.profile_key == profile_key,
            ),
        )
        .where(
            ComplianceTenantControl.tenant_id == tenant_id,
            ComplianceTenantControl.is_active.is_(True),
        )
        .order_by(ComplianceTenantControl.code.asc())
    ).all()
    return [(r.control_key, r.code, r.title) for r in rows]


def compute_preview_rows(
    db: Session,
    *,
    tenant_id: UUID,
    profile_key: str,
) -> list[RequirementRow]:
    # Practice score per control = max(status_score(practice_item.status)) for accepted matches
    practice_rows = db.execute(
        select(
            CompliancePracticeMatchResult.control_key,
            CompliancePracticeItem.status,
        )
        .join(
            CompliancePracticeItem,
            and_(
                CompliancePracticeItem.id == CompliancePracticeMatchResult.practice_item_id,
                CompliancePracticeItem.tenant_id == tenant_id,
            ),
        )
        .where(
            CompliancePracticeMatchResult.tenant_id == tenant_id,
            CompliancePracticeMatchResult.accepted.is_(True),
        )
    ).all()
    practice_score: dict[str, float] = {}
    for control_key, status in practice_rows:
        score = STATUS_SCORES_PRACTICE.get(str(status or "").strip(), 0.0)
        practice_score[control_key] = max(practice_score.get(control_key, 0.0), score)

    # Implementation score per control (control_status.score)
    impl_rows = db.execute(
        select(ComplianceControlStatus.control_key, ComplianceControlStatus.score).where(
            ComplianceControlStatus.tenant_id == tenant_id
        )
    ).all()
    impl_score = {row.control_key: float(row.score or 0.0) for row in impl_rows}

    rows = db.execute(
        select(
            ComplianceTenantFramework.framework_key,
            ComplianceTenantFramework.name,
            ComplianceTenantControlFrameworkRef.control_key,
            ComplianceTenantControl.code,
            ComplianceTenantControl.title,
            ComplianceTenantControlFrameworkRef.ref,
            ComplianceTenantControlFrameworkRef.note,
        )
        .join(
            ComplianceTenantControlFrameworkRef,
            and_(
                ComplianceTenantControlFrameworkRef.tenant_id == tenant_id,
                ComplianceTenantControlFrameworkRef.framework_key == ComplianceTenantFramework.framework_key,
                ComplianceTenantControlFrameworkRef.is_active.is_(True),
            ),
        )
        .join(
            ComplianceTenantControl,
            and_(
                ComplianceTenantControl.tenant_id == tenant_id,
                ComplianceTenantControl.control_key == ComplianceTenantControlFrameworkRef.control_key,
                ComplianceTenantControl.is_active.is_(True),
            ),
        )
        .join(
            ComplianceTenantLibraryProfileControl,
            and_(
                ComplianceTenantLibraryProfileControl.tenant_id == tenant_id,
                ComplianceTenantLibraryProfileControl.control_key == ComplianceTenantControl.control_key,
                ComplianceTenantLibraryProfileControl.profile_key == profile_key,
            ),
        )
        .where(
            ComplianceTenantFramework.tenant_id == tenant_id,
            ComplianceTenantFramework.is_active.is_(True),
        )
        .order_by(ComplianceTenantFramework.name.asc(), ComplianceTenantControl.code.asc())
    ).all()

    out: list[RequirementRow] = []
    for fw_key, fw_name, control_key, code, title, ref, note in rows:
        out.append(
            RequirementRow(
                framework_key=fw_key,
                framework_name=fw_name,
                control_key=control_key,
                control_code=code,
                control_title=title,
                ref=ref,
                note=note,
                implementation_score=impl_score.get(control_key),
                practice_score=practice_score.get(control_key),
            )
        )
    return out


def framework_practice_metrics(
    db: Session,
    *,
    tenant_id: UUID,
    profile_key: str,
    framework_key: str,
) -> tuple[float | None, float | None, int]:
    controls = db.execute(
        select(ComplianceTenantControl.control_key, ComplianceTenantControl.weight)
        .join(
            ComplianceTenantLibraryProfileControl,
            and_(
                ComplianceTenantLibraryProfileControl.tenant_id == tenant_id,
                ComplianceTenantLibraryProfileControl.control_key == ComplianceTenantControl.control_key,
                ComplianceTenantLibraryProfileControl.profile_key == profile_key,
            ),
        )
        .join(
            ComplianceTenantControlFrameworkRef,
            and_(
                ComplianceTenantControlFrameworkRef.tenant_id == tenant_id,
                ComplianceTenantControlFrameworkRef.control_key == ComplianceTenantControl.control_key,
                ComplianceTenantControlFrameworkRef.framework_key == framework_key,
                ComplianceTenantControlFrameworkRef.is_active.is_(True),
            ),
        )
        .where(
            ComplianceTenantControl.tenant_id == tenant_id,
            ComplianceTenantControl.is_active.is_(True),
        )
        .distinct()
    ).all()
    if not controls:
        return None, None, 0

    # Coverage: any accepted practice match
    covered_keys = set(
        db.execute(
            select(CompliancePracticeMatchResult.control_key)
            .where(
                CompliancePracticeMatchResult.tenant_id == tenant_id,
                CompliancePracticeMatchResult.accepted.is_(True),
            )
            .distinct()
        ).scalars().all()
    )
    total_controls = len(controls)
    coverage = len([ck for ck, _w in controls if ck in covered_keys]) / total_controls

    # Practice implementation %: weighted avg of best mapped practice status score, default 0
    best_scores = _best_practice_scores(db, tenant_id=tenant_id)
    numerator = 0.0
    denom = 0.0
    for ck, w in controls:
        weight = float(w or 1)
        denom += weight
        numerator += best_scores.get(ck, 0.0) * weight
    impl = numerator / denom if denom > 0 else None
    return coverage, impl, total_controls


def _best_practice_scores(db: Session, *, tenant_id: UUID) -> dict[str, float]:
    rows = db.execute(
        select(
            CompliancePracticeMatchResult.control_key,
            CompliancePracticeItem.status,
        )
        .join(
            CompliancePracticeItem,
            and_(
                CompliancePracticeItem.id == CompliancePracticeMatchResult.practice_item_id,
                CompliancePracticeItem.tenant_id == tenant_id,
            ),
        )
        .where(
            CompliancePracticeMatchResult.tenant_id == tenant_id,
            CompliancePracticeMatchResult.accepted.is_(True),
        )
    ).all()
    best: dict[str, float] = {}
    for control_key, status in rows:
        score = STATUS_SCORES_PRACTICE.get(str(status or "").strip(), 0.0)
        best[control_key] = max(best.get(control_key, 0.0), score)
    return best


def framework_implementation_percent(db: Session, *, tenant_id: UUID, framework_key: str) -> float | None:
    summary = compute_framework_summary(db, tenant_id=tenant_id, framework_key=framework_key)
    if not summary:
        return None
    return summary["framework"]["compliance"]

