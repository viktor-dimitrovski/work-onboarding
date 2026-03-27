from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.models.rbac import User
from app.models.release_mgmt import WODCDeployment
from app.multitenancy.permissions import require_access
from app.schemas.platform_releases import (
    CABApprovalRequest,
    DeployToAnotherDCRequest,
    PlatformReleaseCreate,
    PlatformReleaseListResponse,
    PlatformReleaseOut,
    PlatformReleaseUpdate,
    PlatformReleaseWorkOrderOut,
    RecordDeploymentRequest,
    ReleaseCenterResponse,
    WODCDeploymentOut,
    WorkOrderSelectionUpdate,
)
from app.services import platform_release_service


router = APIRouter(prefix="/platform-releases", tags=["platform-releases"])


def _to_out(pr) -> PlatformReleaseOut:
    return PlatformReleaseOut(
        id=pr.id,
        name=pr.name,
        release_type=pr.release_type,
        status=pr.status,
        environment=pr.environment,
        data_center_id=pr.data_center_id,
        data_center_name=pr.data_center.name if pr.data_center else None,
        cab_approver_id=pr.cab_approver_id,
        cab_approved_at=pr.cab_approved_at,
        cab_notes=pr.cab_notes,
        generated_at=pr.generated_at,
        generated_by=pr.generated_by,
        services_snapshot=pr.services_snapshot or [],
        changelog_snapshot=pr.changelog_snapshot or [],
        deploy_steps_snapshot=pr.deploy_steps_snapshot or [],
        deployed_at=pr.deployed_at,
        work_orders=[
            PlatformReleaseWorkOrderOut(
                work_order_id=link.work_order_id,
                wo_id=link.work_order.wo_id if link.work_order else None,
                title=link.work_order.title if link.work_order else None,
                included_at=link.included_at,
                included_by=link.included_by,
            )
            for link in (pr.work_orders or [])
        ],
        created_by=pr.created_by,
        created_at=pr.created_at,
        updated_at=pr.updated_at,
        planned_start=pr.planned_start,
        planned_end=pr.planned_end,
        planning_notes=pr.planning_notes,
    )


@router.get("", response_model=PlatformReleaseListResponse)
def list_platform_releases(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:read")),
) -> PlatformReleaseListResponse:
    items, total = platform_release_service.list_platform_releases(db)
    return PlatformReleaseListResponse(items=items, total=total)


@router.post("", response_model=PlatformReleaseOut, status_code=status.HTTP_201_CREATED)
def create_platform_release(
    payload: PlatformReleaseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> PlatformReleaseOut:
    pr = platform_release_service.create_platform_release(db, payload, current_user.id)
    return _to_out(pr)


@router.get("/{pr_id}", response_model=PlatformReleaseOut)
def get_platform_release(
    pr_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:read")),
) -> PlatformReleaseOut:
    pr = platform_release_service.get_platform_release(db, pr_id)
    return _to_out(pr)


@router.patch("/{pr_id}", response_model=PlatformReleaseOut)
def update_platform_release(
    pr_id: uuid.UUID,
    payload: PlatformReleaseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> PlatformReleaseOut:
    pr = platform_release_service.update_platform_release(db, pr_id, payload, current_user.id)
    return _to_out(pr)


@router.put("/{pr_id}/work-orders", response_model=PlatformReleaseOut)
def update_work_orders(
    pr_id: uuid.UUID,
    payload: WorkOrderSelectionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> PlatformReleaseOut:
    pr = platform_release_service.update_work_orders(db, pr_id, payload.work_order_ids, current_user.id)
    return _to_out(pr)


@router.post("/{pr_id}/generate", response_model=PlatformReleaseOut)
def generate_release_plan(
    pr_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> PlatformReleaseOut:
    pr = platform_release_service.generate_release_plan(db, pr_id, current_user.id)
    return _to_out(pr)


@router.post("/{pr_id}/request-cab", response_model=PlatformReleaseOut)
def request_cab_approval(
    pr_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> PlatformReleaseOut:
    pr = platform_release_service.request_cab_approval(db, pr_id, current_user.id)
    return _to_out(pr)


@router.post("/{pr_id}/approve-cab", response_model=PlatformReleaseOut)
def approve_cab(
    pr_id: uuid.UUID,
    payload: CABApprovalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> PlatformReleaseOut:
    pr = platform_release_service.approve_cab(db, pr_id, payload.notes, current_user.id)
    return _to_out(pr)


@router.post("/{pr_id}/record-deployment", response_model=PlatformReleaseOut)
def record_deployment(
    pr_id: uuid.UUID,
    payload: RecordDeploymentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> PlatformReleaseOut:
    pr = platform_release_service.record_deployment(db, pr_id, payload, current_user.id)
    return _to_out(pr)


@router.post("/{pr_id}/close", response_model=PlatformReleaseOut)
def close_platform_release(
    pr_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> PlatformReleaseOut:
    pr = platform_release_service.close_platform_release(db, pr_id, current_user.id)
    return _to_out(pr)


@router.get("/{pr_id}/deployments", response_model=list[WODCDeploymentOut])
def list_deployments_for_release(
    pr_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:read")),
) -> list[WODCDeploymentOut]:
    rows = db.scalars(
        select(WODCDeployment)
        .options(selectinload(WODCDeployment.data_center))
        .where(WODCDeployment.platform_release_id == pr_id)
        .order_by(WODCDeployment.deployed_at.desc())
    ).all()
    return [
        WODCDeploymentOut(
            id=row.id,
            work_order_id=row.work_order_id,
            data_center_id=row.data_center_id,
            data_center_name=row.data_center.name if row.data_center else None,
            platform_release_id=row.platform_release_id,
            environment=row.environment,
            status=row.status,
            deployed_at=row.deployed_at,
            deployed_by=row.deployed_by,
            notes=row.notes,
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.post("/{pr_id}/deploy-to-dc", response_model=PlatformReleaseOut, status_code=status.HTTP_201_CREATED)
def deploy_to_another_dc(
    pr_id: uuid.UUID,
    payload: DeployToAnotherDCRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> PlatformReleaseOut:
    pr = platform_release_service.deploy_to_another_dc(db, pr_id, payload, current_user.id)
    return _to_out(pr)


@router.post("/{pr_id}/promote", response_model=PlatformReleaseOut)
def promote_to_draft(
    pr_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> PlatformReleaseOut:
    require_access(current_user, "releases", "write")
    pr = platform_release_service.promote_to_draft(db, pr_id, current_user.id)
    return _to_out(pr)


@router.get("/center-summary", response_model=ReleaseCenterResponse)
def get_center_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> ReleaseCenterResponse:
    require_access(current_user, "releases", "read")
    return platform_release_service.get_center_summary(db)
