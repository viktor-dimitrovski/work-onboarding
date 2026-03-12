"""Plan limit enforcement utilities.

Limits are defined in ``Plan.limits_json`` and checked at the service layer
*before* the guarded operation executes.  A value of ``-1`` means unlimited.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

from fastapi import Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.assessment import AssessmentTest
from app.models.tenant import TenantMembership
from app.models.track import TrackTemplate
from app.modules.billing.models import Plan, Subscription, UsageEvent

logger = logging.getLogger(__name__)

UNLIMITED = -1


@dataclass(frozen=True)
class LimitResult:
    allowed: bool
    limit: int
    current: int
    limit_key: str

    @property
    def remaining(self) -> int:
        if self.limit == UNLIMITED:
            return UNLIMITED
        return max(0, self.limit - self.current)


def _current_plan(db: Session, tenant_id: UUID) -> Plan | None:
    sub = db.scalar(
        select(Subscription)
        .where(
            Subscription.tenant_id == tenant_id,
            Subscription.status.in_(['active', 'trialing']),
        )
        .order_by(Subscription.starts_at.desc())
    )
    if not sub:
        return None
    return db.scalar(select(Plan).where(Plan.id == sub.plan_id))


def _get_limit(plan: Plan | None, key: str) -> int:
    if not plan:
        return UNLIMITED
    limits: dict = plan.limits_json or {}
    val = limits.get(key)
    if val is None:
        return UNLIMITED
    return int(val)


def _current_month_range() -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    if now.month == 12:
        end = datetime(now.year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(now.year, now.month + 1, 1, tzinfo=timezone.utc)
    return start, end


def _monthly_usage_count(db: Session, tenant_id: UUID, event_key: str) -> int:
    start, end = _current_month_range()
    total = db.scalar(
        select(func.coalesce(func.sum(UsageEvent.quantity), 0)).where(
            UsageEvent.tenant_id == tenant_id,
            UsageEvent.event_key == event_key,
            UsageEvent.occurred_at >= start,
            UsageEvent.occurred_at < end,
        )
    )
    return int(total or 0)


# ── Per-limit checkers ──────────────────────────────────────────────

def check_max_users(db: Session, tenant_id: UUID) -> LimitResult:
    plan = _current_plan(db, tenant_id)
    limit = _get_limit(plan, 'max_users')
    if limit == UNLIMITED:
        return LimitResult(allowed=True, limit=UNLIMITED, current=0, limit_key='max_users')
    current = db.scalar(
        select(func.count()).select_from(TenantMembership).where(
            TenantMembership.tenant_id == tenant_id,
            TenantMembership.status == 'active',
        )
    ) or 0
    return LimitResult(allowed=int(current) < limit, limit=limit, current=int(current), limit_key='max_users')


def check_max_tracks(db: Session, tenant_id: UUID) -> LimitResult:
    plan = _current_plan(db, tenant_id)
    limit = _get_limit(plan, 'max_tracks')
    if limit == UNLIMITED:
        return LimitResult(allowed=True, limit=UNLIMITED, current=0, limit_key='max_tracks')
    current = db.scalar(
        select(func.count()).select_from(TrackTemplate).where(
            TrackTemplate.tenant_id == tenant_id,
        )
    ) or 0
    return LimitResult(allowed=int(current) < limit, limit=limit, current=int(current), limit_key='max_tracks')


def check_max_assessments(db: Session, tenant_id: UUID) -> LimitResult:
    plan = _current_plan(db, tenant_id)
    limit = _get_limit(plan, 'max_assessments')
    if limit == UNLIMITED:
        return LimitResult(allowed=True, limit=UNLIMITED, current=0, limit_key='max_assessments')
    current = db.scalar(
        select(func.count()).select_from(AssessmentTest).where(
            AssessmentTest.tenant_id == tenant_id,
        )
    ) or 0
    return LimitResult(allowed=int(current) < limit, limit=limit, current=int(current), limit_key='max_assessments')


def check_monthly_usage(db: Session, tenant_id: UUID, event_key: str, limit_key: str) -> LimitResult:
    plan = _current_plan(db, tenant_id)
    limit = _get_limit(plan, limit_key)
    if limit == UNLIMITED:
        return LimitResult(allowed=True, limit=UNLIMITED, current=0, limit_key=limit_key)
    current = _monthly_usage_count(db, tenant_id, event_key)
    return LimitResult(allowed=current < limit, limit=limit, current=current, limit_key=limit_key)


def check_file_uploads(db: Session, tenant_id: UUID) -> LimitResult:
    return check_monthly_usage(db, tenant_id, 'file_upload', 'max_file_uploads_per_month')


def check_ai_pdf_imports(db: Session, tenant_id: UUID) -> LimitResult:
    return check_monthly_usage(db, tenant_id, 'ai.pdf_import', 'max_ai_pdf_imports_per_month')


def check_ai_classifications(db: Session, tenant_id: UUID) -> LimitResult:
    return check_monthly_usage(db, tenant_id, 'ai.classify_questions', 'max_ai_classifications_per_month')


# ── Convenience: get all limits at once ─────────────────────────────

def get_all_limits(db: Session, tenant_id: UUID) -> dict[str, LimitResult]:
    return {
        'max_users': check_max_users(db, tenant_id),
        'max_tracks': check_max_tracks(db, tenant_id),
        'max_assessments': check_max_assessments(db, tenant_id),
        'max_file_uploads_per_month': check_file_uploads(db, tenant_id),
        'max_ai_pdf_imports_per_month': check_ai_pdf_imports(db, tenant_id),
        'max_ai_classifications_per_month': check_ai_classifications(db, tenant_id),
    }


# ── FastAPI guard dependency ────────────────────────────────────────

def require_within_limit(check_fn_name: str):
    """Return a FastAPI dependency that raises 402 when a limit is exceeded.

    Usage::

        @router.post('/tracks', dependencies=[Depends(require_within_limit('check_max_tracks'))])
        def create_track(...): ...
    """
    checkers = {
        'check_max_users': check_max_users,
        'check_max_tracks': check_max_tracks,
        'check_max_assessments': check_max_assessments,
        'check_file_uploads': check_file_uploads,
        'check_ai_pdf_imports': check_ai_pdf_imports,
        'check_ai_classifications': check_ai_classifications,
    }
    check_fn = checkers[check_fn_name]

    def _guard(db: Session = Depends(get_db)):
        from app.multitenancy.deps import require_tenant_membership  # avoid circular

        # This dependency is expected to run *after* require_tenant_membership has
        # set the tenant context via set_tenant_id.
        tenant_id_str = db.execute(
            select(func.current_setting('app.tenant_id', True))
        ).scalar()
        if not tenant_id_str:
            return
        result = check_fn(db, UUID(tenant_id_str))
        if not result.allowed:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={
                    'error': 'plan_limit_exceeded',
                    'limit_key': result.limit_key,
                    'limit': result.limit,
                    'current': result.current,
                    'message': f'Plan limit reached for {result.limit_key}. Please upgrade your plan.',
                },
            )
    return _guard
