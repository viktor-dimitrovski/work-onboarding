from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, require_roles
from app.db.session import get_db
from app.models.rbac import User
from app.schemas.common import PaginationMeta
from app.schemas.track import (
    DuplicateTrackResponse,
    PublishTrackResponse,
    TrackListResponse,
    TrackTemplateCreate,
    TrackTemplateOut,
)
from app.services import audit_service, track_service


router = APIRouter(prefix='/tracks', tags=['tracks'])


@router.get('', response_model=TrackListResponse)
def list_tracks(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status_filter: str | None = Query(default=None, alias='status'),
    role_target: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
) -> TrackListResponse:
    tracks, total = track_service.list_track_templates(
        db,
        page=page,
        page_size=page_size,
        status=status_filter,
        role_target=role_target,
    )

    return TrackListResponse(
        items=[TrackTemplateOut.model_validate(track) for track in tracks],
        meta=PaginationMeta(page=page, page_size=page_size, total=total),
    )


@router.post('', response_model=TrackTemplateOut, status_code=status.HTTP_201_CREATED)
def create_track(
    payload: TrackTemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('super_admin', 'admin')),
) -> TrackTemplateOut:
    track = track_service.create_track_template(
        db,
        payload=payload,
        actor_user_id=current_user.id,
    )
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='track_create',
        entity_type='track_template',
        entity_id=track.id,
        details={'title': track.title},
    )
    db.commit()

    return TrackTemplateOut.model_validate(track)


@router.get('/{template_id}', response_model=TrackTemplateOut)
def get_track(
    template_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
) -> TrackTemplateOut:
    track = track_service.get_track_template(db, template_id)
    return TrackTemplateOut.model_validate(track)


@router.post('/{template_id}/duplicate', response_model=DuplicateTrackResponse)
def duplicate_track(
    template_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('super_admin', 'admin')),
) -> DuplicateTrackResponse:
    duplicated = track_service.duplicate_track_template(
        db,
        template_id=template_id,
        actor_user_id=current_user.id,
    )
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='track_duplicate',
        entity_type='track_template',
        entity_id=duplicated.id,
        details={'source_template_id': template_id, 'new_title': duplicated.title},
    )
    db.commit()

    return DuplicateTrackResponse(template_id=duplicated.id, new_title=duplicated.title)


@router.post('/{template_id}/publish/{version_id}', response_model=PublishTrackResponse)
def publish_track(
    template_id: UUID,
    version_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('super_admin', 'admin')),
) -> PublishTrackResponse:
    published = track_service.publish_track_version(
        db,
        template_id=template_id,
        version_id=version_id,
        actor_user_id=current_user.id,
    )

    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='track_publish',
        entity_type='track_version',
        entity_id=published.id,
        details={'template_id': template_id, 'version_id': version_id},
    )
    db.commit()

    return PublishTrackResponse(
        template_id=template_id,
        version_id=published.id,
        status=published.status,
        published_at=published.published_at,
    )
