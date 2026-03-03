from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models.compliance import (
    ComplianceClientMatchResult,
    ComplianceControlStatus,
    CompliancePracticeMatchResult,
    ComplianceSnapshot,
    ComplianceTenantControl,
    ComplianceTenantControlFrameworkRef,
    ComplianceTenantFramework,
    ComplianceTenantLibraryImportBatch,
    ComplianceTenantLibraryProfileControl,
    ComplianceTenantProfile,
)
from app.services.compliance_summary_service import compute_framework_summary, compute_summary


@dataclass
class SnapshotMetrics:
    implementation_percent: float | None
    coverage_percent: float | None
    metrics_json: dict[str, Any]


def create_snapshot(
    db: Session,
    *,
    tenant_id: UUID,
    scope: str,
    computed_by_user_id: UUID | None,
    framework_key: str | None = None,
    client_set_version_id: UUID | None = None,
) -> ComplianceSnapshot | None:
    profile_key = _active_profile_key(db, tenant_id)
    if not profile_key:
        return None
    if scope == "framework" and not framework_key:
        raise ValueError("framework_key is required for framework snapshots.")
    if scope == "client_set" and not client_set_version_id:
        raise ValueError("client_set_version_id is required for client_set snapshots.")

    metrics = _compute_metrics(
        db,
        tenant_id=tenant_id,
        profile_key=profile_key,
        scope=scope,
        framework_key=framework_key,
    )

    input_hash = _compute_input_hash(
        db,
        tenant_id=tenant_id,
        profile_key=profile_key,
        scope=scope,
        framework_key=framework_key,
        client_set_version_id=client_set_version_id,
    )

    batch_id = db.scalar(
        select(ComplianceTenantLibraryImportBatch.id)
        .where(ComplianceTenantLibraryImportBatch.tenant_id == tenant_id)
        .order_by(ComplianceTenantLibraryImportBatch.imported_at.desc())
        .limit(1)
    )

    snapshot = ComplianceSnapshot(
        tenant_id=tenant_id,
        scope=scope,
        profile_key=profile_key,
        framework_key=framework_key,
        client_set_version_id=client_set_version_id,
        library_batch_id=batch_id,
        implementation_percent=metrics.implementation_percent,
        coverage_percent=metrics.coverage_percent,
        metrics_json=metrics.metrics_json,
        input_hash=input_hash,
        computed_by_user_id=computed_by_user_id,
    )
    db.add(snapshot)
    db.flush()
    return snapshot


def get_trends(
    db: Session,
    *,
    tenant_id: UUID,
    scope: str,
    window_days: int,
    framework_key: str | None = None,
    client_set_version_id: UUID | None = None,
) -> list[ComplianceSnapshot]:
    since = datetime.utcnow() - timedelta(days=window_days)
    query = (
        select(ComplianceSnapshot)
        .where(
            ComplianceSnapshot.tenant_id == tenant_id,
            ComplianceSnapshot.scope == scope,
            ComplianceSnapshot.computed_at >= since,
        )
        .order_by(ComplianceSnapshot.computed_at.asc())
    )
    if framework_key:
        query = query.where(ComplianceSnapshot.framework_key == framework_key)
    if client_set_version_id:
        query = query.where(ComplianceSnapshot.client_set_version_id == client_set_version_id)
    return db.scalars(query).all()


def latest_snapshot(db: Session, *, tenant_id: UUID) -> ComplianceSnapshot | None:
    return db.scalar(
        select(ComplianceSnapshot)
        .where(ComplianceSnapshot.tenant_id == tenant_id)
        .order_by(ComplianceSnapshot.computed_at.desc())
        .limit(1)
    )


def _active_profile_key(db: Session, tenant_id: UUID) -> str | None:
    return db.scalar(
        select(ComplianceTenantProfile.profile_key).where(
            ComplianceTenantProfile.tenant_id == tenant_id,
            ComplianceTenantProfile.enabled.is_(True),
        )
    )


def _compute_metrics(
    db: Session,
    *,
    tenant_id: UUID,
    profile_key: str,
    scope: str,
    framework_key: str | None,
) -> SnapshotMetrics:
    if scope == "framework" and framework_key:
        summary = compute_framework_summary(db, tenant_id=tenant_id, framework_key=framework_key)
        implementation = summary["framework"]["compliance"] if summary else None
        metrics_json = {
            "implementation": summary["framework"] if summary else {},
            "by_domain": summary.get("by_domain", []) if summary else [],
        }
    else:
        summary = compute_summary(db, tenant_id=tenant_id)
        implementation = summary["overall"]["compliance"]
        metrics_json = {
            "implementation": summary["overall"],
            "by_framework": summary.get("by_framework", []),
            "by_domain": summary.get("by_domain", []),
        }

    coverage = _compute_coverage_percent(
        db,
        tenant_id=tenant_id,
        profile_key=profile_key,
        framework_key=framework_key if scope == "framework" else None,
    )
    metrics_json["coverage_percent"] = coverage

    status_counts = _status_distribution(
        db,
        tenant_id=tenant_id,
        profile_key=profile_key,
        framework_key=framework_key if scope == "framework" else None,
    )
    metrics_json["status_counts"] = status_counts

    return SnapshotMetrics(implementation_percent=implementation, coverage_percent=coverage, metrics_json=metrics_json)


def _compute_input_hash(
    db: Session,
    *,
    tenant_id: UUID,
    profile_key: str,
    scope: str,
    framework_key: str | None,
    client_set_version_id: UUID | None,
) -> str:
    status_rows = _status_state(
        db,
        tenant_id=tenant_id,
        profile_key=profile_key,
        framework_key=framework_key if scope == "framework" else None,
    )
    data = {
        "scope": scope,
        "profile_key": profile_key,
        "framework_key": framework_key,
        "client_set_version_id": str(client_set_version_id) if client_set_version_id else None,
        "statuses": status_rows,
    }
    payload = json.dumps(data, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _status_state(
    db: Session,
    *,
    tenant_id: UUID,
    profile_key: str,
    framework_key: str | None,
) -> list[dict[str, Any]]:
    query = (
        select(
            ComplianceTenantControl.control_key,
            ComplianceTenantControl.default_status,
            ComplianceTenantControl.default_score,
            ComplianceControlStatus.status_enum,
            ComplianceControlStatus.score,
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
    state: list[dict[str, Any]] = []
    for control_key, default_status, default_score, status_enum, score in rows:
        resolved_status = status_enum or default_status or "not_started"
        resolved_score = float(score if status_enum else default_score or 0.0)
        if resolved_status == "na":
            resolved_score = 0.0
        state.append({"control_key": control_key, "status": resolved_status, "score": resolved_score})
    return sorted(state, key=lambda item: item["control_key"])


def _status_distribution(
    db: Session,
    *,
    tenant_id: UUID,
    profile_key: str,
    framework_key: str | None,
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in _status_state(
        db,
        tenant_id=tenant_id,
        profile_key=profile_key,
        framework_key=framework_key,
    ):
        status = row["status"]
        counts[status] = counts.get(status, 0) + 1
    return counts


def _compute_coverage_percent(
    db: Session,
    *,
    tenant_id: UUID,
    profile_key: str,
    framework_key: str | None,
) -> float | None:
    control_query = (
        select(ComplianceTenantLibraryProfileControl.control_key)
        .where(
            ComplianceTenantLibraryProfileControl.tenant_id == tenant_id,
            ComplianceTenantLibraryProfileControl.profile_key == profile_key,
        )
        .distinct()
    )
    if framework_key:
        control_query = (
            control_query.join(
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
            .where(ComplianceTenantFramework.framework_key == framework_key)
        )

    profile_controls = [row[0] for row in db.execute(control_query).all()]
    if not profile_controls:
        return None

    accepted_practice = db.execute(
        select(CompliancePracticeMatchResult.control_key)
        .where(
            CompliancePracticeMatchResult.tenant_id == tenant_id,
            CompliancePracticeMatchResult.accepted.is_(True),
        )
        .distinct()
    ).scalars().all()
    accepted_client = db.execute(
        select(ComplianceClientMatchResult.control_key)
        .where(
            ComplianceClientMatchResult.tenant_id == tenant_id,
            ComplianceClientMatchResult.accepted.is_(True),
        )
        .distinct()
    ).scalars().all()

    accepted_controls = set(accepted_practice) | set(accepted_client)
    covered = len([ck for ck in profile_controls if ck in accepted_controls])
    return covered / len(profile_controls)
