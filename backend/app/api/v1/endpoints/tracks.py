from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy import delete, func, select

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.models.assignment import OnboardingAssignment
from app.models.rbac import User
from app.multitenancy.permissions import require_access
from app.schemas.common import PaginationMeta
from app.schemas.track import (
    DuplicateTrackResponse,
    PublishTrackResponse,
    TrackCascadeDeletePreview,
    TrackCascadeDeleteRequest,
    TrackCascadeDeleteResponse,
    TrackListResponse,
    TrackTemplateCreate,
    TrackTemplateOut,
    TrackTemplateUpdate,
)
from app.services import audit_service, track_service


router = APIRouter(prefix='/tracks', tags=['tracks'])


@router.get('', response_model=TrackListResponse)
def list_tracks(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status_filter: str | None = Query(default=None, alias='status'),
    role_target: str | None = Query(default=None),
    track_type: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('tracks', 'tracks:read')),
) -> TrackListResponse:
    tracks, total = track_service.list_track_templates(
        db,
        page=page,
        page_size=page_size,
        status=status_filter,
        role_target=role_target,
        track_type=track_type,
    )

    user_ids: set[UUID] = set()
    for track in tracks:
        if track.created_by:
            user_ids.add(track.created_by)
        if track.updated_by:
            user_ids.add(track.updated_by)
    users_by_id: dict[UUID, User] = {}
    if user_ids:
        users = db.scalars(select(User).where(User.id.in_(list(user_ids)))).all()
        users_by_id = {row.id: row for row in users}

    def display_name(user: User | None) -> str | None:
        if not user:
            return None
        return (user.full_name or "").strip() or (user.email or "").strip() or None

    def display_email(user: User | None) -> str | None:
        if not user:
            return None
        return (user.email or "").strip() or None

    items: list[TrackTemplateOut] = []
    for track in tracks:
        out = TrackTemplateOut.model_validate(track)
        out.created_by_name = display_name(users_by_id.get(track.created_by))
        out.updated_by_name = display_name(users_by_id.get(track.updated_by))
        out.created_by_email = display_email(users_by_id.get(track.created_by))
        out.updated_by_email = display_email(users_by_id.get(track.updated_by))
        items.append(out)

    return TrackListResponse(items=items, meta=PaginationMeta(page=page, page_size=page_size, total=total))


@router.post('', response_model=TrackTemplateOut, status_code=status.HTTP_201_CREATED)
def create_track(
    payload: TrackTemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('tracks', 'tracks:write')),
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
    __: object = Depends(require_access('tracks', 'tracks:read')),
) -> TrackTemplateOut:
    track = track_service.get_track_template(db, template_id)
    return TrackTemplateOut.model_validate(track)


@router.put('/{template_id}', response_model=TrackTemplateOut)
def update_track(
    template_id: UUID,
    payload: TrackTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('tracks', 'tracks:write')),
) -> TrackTemplateOut:
    track = track_service.republish_track_template(
        db,
        template_id=template_id,
        payload=payload,
        actor_user_id=current_user.id,
        apply_to_assignments=payload.apply_to_assignments,
    )
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='track_republish',
        entity_type='track_template',
        entity_id=track.id,
        details={
            'title': track.title,
            'apply_to_assignments': payload.apply_to_assignments,
        },
    )
    db.commit()
    return TrackTemplateOut.model_validate(track)


@router.post('/{template_id}/duplicate', response_model=DuplicateTrackResponse)
def duplicate_track(
    template_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('tracks', 'tracks:write')),
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


@router.post('/{template_id}/deactivate', response_model=TrackTemplateOut)
def deactivate_track(
    template_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('tracks', 'tracks:write')),
) -> TrackTemplateOut:
    track = track_service.get_track_template(db, template_id)
    track.is_active = False
    track.updated_by = current_user.id
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='track_deactivate',
        entity_type='track_template',
        entity_id=track.id,
        details={'title': track.title},
    )
    db.commit()
    return TrackTemplateOut.model_validate(track)


@router.post('/{template_id}/activate', response_model=TrackTemplateOut)
def activate_track(
    template_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('tracks', 'tracks:write')),
) -> TrackTemplateOut:
    track = track_service.get_track_template(db, template_id)
    track.is_active = True
    track.updated_by = current_user.id
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='track_activate',
        entity_type='track_template',
        entity_id=track.id,
        details={'title': track.title},
    )
    db.commit()
    return TrackTemplateOut.model_validate(track)


@router.delete('/{template_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_track(
    template_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('tracks', 'tracks:write')),
) -> Response:
    track = track_service.get_track_template(db, template_id)
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='track_delete',
        entity_type='track_template',
        entity_id=track.id,
        details={'title': track.title},
    )
    db.delete(track)
    try:
        db.commit()
    except IntegrityError as err:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail='Track cannot be deleted because it is referenced by existing assignments.',
        ) from err
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get('/{template_id}/delete-preview', response_model=TrackCascadeDeletePreview)
def delete_track_preview(
    template_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('tracks', 'tracks:write')),
) -> TrackCascadeDeletePreview:
    track = track_service.get_track_template(db, template_id)
    assignments = db.scalars(
        select(OnboardingAssignment)
        .where(OnboardingAssignment.template_id == template_id)
        .order_by(OnboardingAssignment.created_at.desc())
        .limit(25)
    ).all()
    total = db.scalar(
        select(func.count())
        .select_from(OnboardingAssignment)
        .where(OnboardingAssignment.template_id == template_id)
    )
    confirm_phrase = f'DELETE {template_id}'
    return TrackCascadeDeletePreview(
        template_id=track.id,
        title=track.title,
        assignment_count=int(total or 0),
        assignments=assignments,
        confirm_phrase=confirm_phrase,
    )


@router.post('/{template_id}/cascade-delete', response_model=TrackCascadeDeleteResponse)
def cascade_delete_track(
    template_id: UUID,
    payload: TrackCascadeDeleteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('tracks', 'tracks:write')),
) -> TrackCascadeDeleteResponse:
    expected = f'DELETE {template_id}'
    if (payload.confirm_phrase or '').strip() != expected:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid confirmation phrase')

    track = track_service.get_track_template(db, template_id)

    deleted_assignments = int(
        db.scalar(
            select(func.count())
            .select_from(OnboardingAssignment)
            .where(OnboardingAssignment.template_id == template_id)
        )
        or 0
    )

    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='track_cascade_delete_previewed',
        entity_type='track_template',
        entity_id=track.id,
        details={'title': track.title, 'assignment_count': deleted_assignments},
    )

    db.execute(delete(OnboardingAssignment).where(OnboardingAssignment.template_id == template_id))
    db.delete(track)

    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='track_cascade_delete',
        entity_type='track_template',
        entity_id=track.id,
        details={'title': track.title, 'deleted_assignments': deleted_assignments},
    )
    db.commit()
    return TrackCascadeDeleteResponse(template_id=template_id, deleted_assignments=deleted_assignments)


@router.post('/{template_id}/publish/{version_id}', response_model=PublishTrackResponse)
def publish_track(
    template_id: UUID,
    version_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('tracks', 'tracks:write')),
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
