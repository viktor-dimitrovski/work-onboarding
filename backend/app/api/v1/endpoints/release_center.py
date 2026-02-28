from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.models.rbac import User
from app.models.track import TrackVersion
from app.multitenancy.permissions import require_access
from app.schemas.release_center import (
    ReleaseCenterCreate,
    ReleaseCenterListResponse,
    ReleaseCenterSummary,
    ReleaseTemplateOption,
    ReleaseMetadataOut,
    ReleaseMetadataUpdate,
)
from app.services import assignment_service, track_service


router = APIRouter(prefix="/release-center", tags=["release-center"])


@router.get("/templates", response_model=list[ReleaseTemplateOption])
def list_release_templates(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:read")),
) -> list[ReleaseTemplateOption]:
    versions = db.scalars(
        select(TrackVersion)
        .where(TrackVersion.status == "published", TrackVersion.track_type == "RELEASE")
        .order_by(TrackVersion.published_at.desc().nullslast(), TrackVersion.created_at.desc())
    ).all()
    return [
        ReleaseTemplateOption(template_id=version.template_id, version_id=version.id, title=version.title)
        for version in versions
    ]


@router.get("", response_model=ReleaseCenterListResponse)
def list_release_center(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    status_filter: str | None = Query(default=None, alias="status"),
    environment: str | None = Query(default=None),
    owner_id: UUID | None = Query(default=None),
    target_from: date | None = Query(default=None),
    target_to: date | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:read")),
) -> ReleaseCenterListResponse:
    assignments, _ = assignment_service.list_release_assignments(
        db,
        page=page,
        page_size=page_size,
        status_filter=status_filter,
        environment=environment,
        owner_id=owner_id,
        target_from=target_from,
        target_to=target_to,
    )

    items: list[ReleaseCenterSummary] = []
    for assignment in assignments:
        tasks = [task for phase in assignment.phases for task in phase.tasks]
        blockers = len([task for task in tasks if task.status == "blocked"])
        gate_tasks = [
            task for task in tasks if isinstance(task.metadata_json, dict) and task.metadata_json.get("gate")
        ]
        gates_total = len(gate_tasks)
        gates_passed = len([task for task in gate_tasks if task.status == "completed"])

        meta = assignment.metadata_json if isinstance(assignment.metadata_json, dict) else {}
        manager_id = meta.get("release_manager_user_id")
        try:
            manager_uuid = UUID(str(manager_id)) if manager_id else None
        except ValueError:
            manager_uuid = None

        items.append(
            ReleaseCenterSummary(
                assignment_id=assignment.id,
                title=assignment.title,
                status=assignment.status,
                progress_percent=assignment.progress_percent,
                start_date=assignment.start_date,
                target_date=assignment.target_date,
                blockers_count=blockers,
                gates_passed=gates_passed,
                gates_total=gates_total,
                environment=meta.get("environment"),
                version_tag=meta.get("version_tag"),
                release_manager_user_id=manager_uuid,
                rel_id=meta.get("rel_id"),
                links=meta.get("links") if isinstance(meta.get("links"), dict) else {},
            )
        )
    return ReleaseCenterListResponse(items=items)


@router.post("/from-template", response_model=ReleaseMetadataOut, status_code=status.HTTP_201_CREATED)
def create_release_plan(
    payload: ReleaseCenterCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> ReleaseMetadataOut:
    track_version = track_service.get_published_track_version(db, payload.track_version_id)
    if track_version.track_type != "RELEASE":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Track version is not a release template.")

    assignment = assignment_service.create_assignment_from_track(
        db,
        actor_user_id=current_user.id,
        employee_id=current_user.id,
        mentor_id=None,
        track_version=track_version,
        start_date=payload.start_date,
        target_date=payload.target_date,
    )
    assignment.metadata_json = {**assignment.metadata_json, **payload.metadata}
    assignment.updated_by = current_user.id
    db.commit()

    return ReleaseMetadataOut(assignment_id=assignment.id, metadata=assignment.metadata_json)


@router.get("/{assignment_id}/metadata", response_model=ReleaseMetadataOut)
def get_release_metadata(
    assignment_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:read")),
) -> ReleaseMetadataOut:
    assignment = assignment_service.get_assignment_by_id(db, assignment_id)
    return ReleaseMetadataOut(assignment_id=assignment.id, metadata=assignment.metadata_json)


@router.put("/{assignment_id}/metadata", response_model=ReleaseMetadataOut)
def update_release_metadata(
    assignment_id: UUID,
    payload: ReleaseMetadataUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> ReleaseMetadataOut:
    assignment = assignment_service.get_assignment_by_id(db, assignment_id)
    existing = assignment.metadata_json if isinstance(assignment.metadata_json, dict) else {}
    assignment.metadata_json = {**existing, **payload.metadata}
    assignment.updated_by = current_user.id
    db.commit()
    return ReleaseMetadataOut(assignment_id=assignment.id, metadata=assignment.metadata_json)
