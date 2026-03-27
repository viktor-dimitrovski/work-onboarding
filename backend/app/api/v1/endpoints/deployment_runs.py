from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.models.rbac import User
from app.multitenancy.permissions import require_access
from app.schemas.deployment_runs import (
    AbortRunRequest,
    CompleteRunRequest,
    DeploymentRunCreate,
    DeploymentRunItemUpdate,
    DeploymentRunOut,
    DeploymentRunSummary,
    MarkAllDoneRequest,
    ReopenRunRequest,
)
from app.services import deployment_run_service


router = APIRouter(tags=["deployment-runs"])


@router.post(
    "/platform-releases/{platform_release_id}/deployment-runs",
    response_model=DeploymentRunOut,
    status_code=status.HTTP_201_CREATED,
)
def start_run(
    platform_release_id: uuid.UUID,
    payload: DeploymentRunCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    require_access(current_user, "releases", "write")
    return deployment_run_service.start_run(db, platform_release_id, payload, current_user.id)


@router.get(
    "/platform-releases/{platform_release_id}/deployment-runs",
    response_model=list[DeploymentRunSummary],
)
def list_runs(
    platform_release_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    require_access(current_user, "releases", "read")
    return deployment_run_service.list_runs(db, platform_release_id)


@router.get(
    "/deployment-runs/{run_id}",
    response_model=DeploymentRunOut,
)
def get_run(
    run_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    require_access(current_user, "releases", "read")
    return deployment_run_service.get_run(db, run_id)


@router.patch(
    "/deployment-runs/{run_id}/items/{item_id}",
    response_model=DeploymentRunOut,
)
def update_item(
    run_id: uuid.UUID,
    item_id: uuid.UUID,
    payload: DeploymentRunItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    require_access(current_user, "releases", "write")
    return deployment_run_service.update_item(db, run_id, item_id, payload, current_user.id)


@router.post(
    "/deployment-runs/{run_id}/items/mark-all-done",
    response_model=DeploymentRunOut,
)
def mark_all_done(
    run_id: uuid.UUID,
    payload: MarkAllDoneRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    require_access(current_user, "releases", "write")
    return deployment_run_service.mark_all_done(db, run_id, current_user.id)


@router.post(
    "/deployment-runs/{run_id}/complete",
    response_model=DeploymentRunOut,
)
def complete_run(
    run_id: uuid.UUID,
    payload: CompleteRunRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    require_access(current_user, "releases", "write")
    return deployment_run_service.complete_run(db, run_id, payload, current_user.id)


@router.post(
    "/deployment-runs/{run_id}/reopen",
    response_model=DeploymentRunOut,
)
def reopen_run(
    run_id: uuid.UUID,
    payload: ReopenRunRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    require_access(current_user, "releases", "write")
    return deployment_run_service.reopen_run(db, run_id, payload, current_user.id)


@router.post(
    "/deployment-runs/{run_id}/abort",
    response_model=DeploymentRunOut,
)
def abort_run(
    run_id: uuid.UUID,
    payload: AbortRunRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    require_access(current_user, "releases", "write")
    return deployment_run_service.abort_run(db, run_id, payload, current_user.id)
