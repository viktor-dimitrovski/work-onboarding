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
    ComplianceTenantDomain,
    ComplianceTenantFramework,
    ComplianceTenantLibraryProfileControl,
    ComplianceTenantProfile,
)


STATUS_SCORES: dict[str, float] = {
    "not_started": 0.0,
    "in_progress": 0.25,
    "partial": 0.5,
    "mostly": 0.75,
    "implemented": 1.0,
    "na": 0.0,
}


@dataclass
class SummaryBucket:
    numerator: float = 0.0
    denominator: float = 0.0

    def add(self, *, score: float, weight: float, include: bool) -> None:
        if not include:
            return
        self.numerator += score * weight
        self.denominator += weight

    def compliance(self) -> float | None:
        if self.denominator <= 0:
            return None
        return self.numerator / self.denominator


def _normalize_status(status_enum: str | None, score: Any) -> tuple[str, float, bool]:
    if not status_enum:
        return "not_started", 0.0, True
    if status_enum == "na":
        return "na", 0.0, False
    return status_enum, float(score or STATUS_SCORES.get(status_enum, 0.0)), True


def _active_profile_key(db: Session, tenant_id: UUID) -> str | None:
    return db.scalar(
        select(ComplianceTenantProfile.profile_key).where(
            ComplianceTenantProfile.tenant_id == tenant_id,
            ComplianceTenantProfile.enabled.is_(True),
        )
    )


def compute_summary(db: Session, *, tenant_id: UUID) -> dict[str, Any]:
    profile_key = _active_profile_key(db, tenant_id)
    if not profile_key:
        empty_bucket = SummaryBucket()
        return {
            "overall": {"key": "overall", "label": "Overall", **_bucket_dict(empty_bucket)},
            "by_framework": [],
            "by_domain": [],
        }

    rows = db.execute(
        select(
            ComplianceTenantControl.control_key,
            ComplianceTenantControl.weight,
            ComplianceTenantControl.domain_code,
            ComplianceTenantDomain.label,
            ComplianceControlStatus.status_enum,
            ComplianceControlStatus.score,
        )
        .join(
            ComplianceTenantLibraryProfileControl,
            and_(
                ComplianceTenantLibraryProfileControl.tenant_id == tenant_id,
                ComplianceTenantLibraryProfileControl.control_key == ComplianceTenantControl.control_key,
            ),
        )
        .join(
            ComplianceTenantDomain,
            and_(
                ComplianceTenantDomain.tenant_id == tenant_id,
                ComplianceTenantDomain.domain_code == ComplianceTenantControl.domain_code,
                ComplianceTenantDomain.is_active.is_(True),
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
            ComplianceTenantLibraryProfileControl.profile_key == profile_key,
        )
    ).all()

    overall_bucket = SummaryBucket()
    domain_buckets: dict[str, SummaryBucket] = {}
    domain_labels: dict[str, str] = {}

    for _, weight, domain_code, domain_label, status_enum, score in rows:
        status, score_value, include = _normalize_status(status_enum, score)
        _ = status  # for clarity
        overall_bucket.add(score=score_value, weight=float(weight), include=include)
        domain_bucket = domain_buckets.setdefault(domain_code, SummaryBucket())
        domain_bucket.add(score=score_value, weight=float(weight), include=include)
        domain_labels[domain_code] = domain_label

    by_domain = [
        {"key": code, "label": domain_labels.get(code, code), **_bucket_dict(bucket)}
        for code, bucket in domain_buckets.items()
    ]

    framework_rows = db.execute(
        select(
            ComplianceTenantFramework.framework_key,
            ComplianceTenantFramework.name,
            ComplianceTenantControl.weight,
            ComplianceControlStatus.status_enum,
            ComplianceControlStatus.score,
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
        .outerjoin(
            ComplianceControlStatus,
            and_(
                ComplianceControlStatus.tenant_id == tenant_id,
                ComplianceControlStatus.control_key == ComplianceTenantControl.control_key,
            ),
        )
        .where(
            ComplianceTenantFramework.tenant_id == tenant_id,
            ComplianceTenantFramework.is_active.is_(True),
            ComplianceTenantControl.is_active.is_(True),
        )
    ).all()

    framework_buckets: dict[str, SummaryBucket] = {}
    framework_labels: dict[str, str] = {}

    for framework_key, framework_name, weight, status_enum, score in framework_rows:
        status, score_value, include = _normalize_status(status_enum, score)
        _ = status
        bucket = framework_buckets.setdefault(framework_key, SummaryBucket())
        bucket.add(score=score_value, weight=float(weight), include=include)
        framework_labels[framework_key] = framework_name

    by_framework = [
        {"key": key, "label": framework_labels.get(key, key), **_bucket_dict(bucket)}
        for key, bucket in framework_buckets.items()
    ]

    return {
        "overall": {"key": "overall", "label": "Overall", **_bucket_dict(overall_bucket)},
        "by_framework": by_framework,
        "by_domain": by_domain,
    }


def compute_framework_summary(db: Session, *, tenant_id: UUID, framework_key: str) -> dict[str, Any] | None:
    framework = db.scalar(
        select(ComplianceTenantFramework).where(
            ComplianceTenantFramework.tenant_id == tenant_id,
            ComplianceTenantFramework.framework_key == framework_key,
            ComplianceTenantFramework.is_active.is_(True),
        )
    )
    if not framework:
        return None

    profile_key = _active_profile_key(db, tenant_id)
    if not profile_key:
        empty_bucket = SummaryBucket()
        return {
            "framework": {"key": framework.framework_key, "label": framework.name, **_bucket_dict(empty_bucket)},
            "by_domain": [],
        }

    rows = db.execute(
        select(
            ComplianceTenantControl.weight,
            ComplianceTenantControl.domain_code,
            ComplianceTenantDomain.label,
            ComplianceControlStatus.status_enum,
            ComplianceControlStatus.score,
        )
        .join(
            ComplianceTenantControlFrameworkRef,
            and_(
                ComplianceTenantControlFrameworkRef.tenant_id == tenant_id,
                ComplianceTenantControlFrameworkRef.control_key == ComplianceTenantControl.control_key,
                ComplianceTenantControlFrameworkRef.is_active.is_(True),
            ),
        )
        .join(
            ComplianceTenantDomain,
            and_(
                ComplianceTenantDomain.tenant_id == tenant_id,
                ComplianceTenantDomain.domain_code == ComplianceTenantControl.domain_code,
                ComplianceTenantDomain.is_active.is_(True),
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
        .outerjoin(
            ComplianceControlStatus,
            and_(
                ComplianceControlStatus.control_key == ComplianceTenantControl.control_key,
                ComplianceControlStatus.tenant_id == tenant_id,
            ),
        )
        .where(
            ComplianceTenantControlFrameworkRef.framework_key == framework.framework_key,
            ComplianceTenantControl.tenant_id == tenant_id,
            ComplianceTenantControl.is_active.is_(True),
        )
    ).all()

    framework_bucket = SummaryBucket()
    domain_buckets: dict[str, SummaryBucket] = {}
    domain_labels: dict[str, str] = {}

    for weight, domain_code, domain_label, status_enum, score in rows:
        status, score_value, include = _normalize_status(status_enum, score)
        _ = status
        framework_bucket.add(score=score_value, weight=float(weight), include=include)
        bucket = domain_buckets.setdefault(domain_code, SummaryBucket())
        bucket.add(score=score_value, weight=float(weight), include=include)
        domain_labels[domain_code] = domain_label

    by_domain = [
        {"key": code, "label": domain_labels.get(code, code), **_bucket_dict(bucket)}
        for code, bucket in domain_buckets.items()
    ]

    return {
        "framework": {
            "key": framework.framework_key,
            "label": framework.name,
            **_bucket_dict(framework_bucket),
        },
        "by_domain": by_domain,
    }


def _bucket_dict(bucket: SummaryBucket) -> dict[str, float | None]:
    return {
        "numerator": bucket.numerator,
        "denominator": bucket.denominator,
        "compliance": bucket.compliance(),
    }
