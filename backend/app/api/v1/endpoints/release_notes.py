from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.models.rbac import User
from app.multitenancy.permissions import require_access
from app.schemas.release_notes import (
    AddAuthorRequest,
    ApprovalRequest,
    FunctionalitySearchResult,
    ReleaseNoteCreate,
    ReleaseNoteItemCreate,
    ReleaseNoteItemOut,
    ReleaseNoteItemUpdate,
    ReleaseNoteListResponse,
    ReleaseNoteOut,
    ReorderItemsRequest,
)
from app.services import release_note_service


router = APIRouter(prefix="/release-notes", tags=["release-notes"])


def _to_out(rn) -> ReleaseNoteOut:
    from app.schemas.release_notes import AuthorOut, ReleaseNoteItemOut as ItemOut
    return ReleaseNoteOut(
        id=rn.id,
        repo=rn.repo,
        branch=rn.branch,
        service_name=rn.service_name,
        component_type=rn.component_type,
        tag=rn.tag,
        status=rn.status,
        approved_by=rn.approved_by,
        approved_at=rn.approved_at,
        authors=[
            AuthorOut(user_id=a.user_id, added_at=a.added_at)
            for a in (rn.authors or [])
        ],
        items=[
            ItemOut(
                id=item.id,
                item_type=item.item_type,
                title=item.title,
                description=item.description,
                migration_step=item.migration_step,
                order_index=item.order_index,
                created_by=item.created_by,
                updated_at=item.updated_at,
            )
            for item in sorted(rn.items or [], key=lambda x: (x.item_type, x.order_index))
        ],
        created_by=rn.created_by,
        created_at=rn.created_at,
        updated_at=rn.updated_at,
    )


@router.get("/items/search", response_model=list[FunctionalitySearchResult])
def search_functionality(
    q: str = Query(..., min_length=2),
    include_draft: bool = Query(True),
    dc_id: str | None = Query(None),
    component_type: str | None = Query(None),
    deployment_status: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
) -> list[FunctionalitySearchResult]:
    return release_note_service.search_functionality(db, q, include_draft, dc_id, component_type, deployment_status)


@router.get("", response_model=ReleaseNoteListResponse)
def list_release_notes(
    component_type: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    q: str | None = Query(None),
    linkable_for_wo: uuid.UUID | None = Query(None),
    repo: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:read")),
) -> ReleaseNoteListResponse:
    items, total = release_note_service.list_release_notes(
        db, component_type, status_filter, q, linkable_for_wo=linkable_for_wo, repo=repo
    )
    return ReleaseNoteListResponse(items=items, total=total)


@router.post("", response_model=ReleaseNoteOut, status_code=status.HTTP_201_CREATED)
def create_release_note(
    payload: ReleaseNoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> ReleaseNoteOut:
    rn = release_note_service.create_release_note(db, payload, current_user.id)
    return _to_out(rn)


@router.get("/{rn_id}", response_model=ReleaseNoteOut)
def get_release_note(
    rn_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:read")),
) -> ReleaseNoteOut:
    rn = release_note_service.get_release_note(db, rn_id)
    return _to_out(rn)


@router.post("/{rn_id}/publish", response_model=ReleaseNoteOut)
def publish_release_note(
    rn_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> ReleaseNoteOut:
    rn = release_note_service.publish_release_note(db, rn_id, current_user.id)
    return _to_out(rn)


@router.post("/{rn_id}/approve", response_model=ReleaseNoteOut)
def approve_release_note(
    rn_id: uuid.UUID,
    payload: ApprovalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> ReleaseNoteOut:
    rn = release_note_service.approve_release_note(db, rn_id, payload.approved_by, current_user.id)
    return _to_out(rn)


@router.post("/{rn_id}/authors", response_model=ReleaseNoteOut)
def add_author(
    rn_id: uuid.UUID,
    payload: AddAuthorRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> ReleaseNoteOut:
    rn = release_note_service.add_author(db, rn_id, payload.user_id)
    return _to_out(rn)


@router.delete("/{rn_id}/authors/{user_id}", response_model=ReleaseNoteOut)
def remove_author(
    rn_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> ReleaseNoteOut:
    rn = release_note_service.remove_author(db, rn_id, user_id)
    return _to_out(rn)


@router.post("/{rn_id}/items", response_model=ReleaseNoteItemOut, status_code=status.HTTP_201_CREATED)
def create_item(
    rn_id: uuid.UUID,
    payload: ReleaseNoteItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> ReleaseNoteItemOut:
    item = release_note_service.create_item(db, rn_id, payload, current_user.id)
    return ReleaseNoteItemOut.model_validate(item)


@router.patch("/{rn_id}/items/{item_id}", response_model=ReleaseNoteItemOut)
def update_item(
    rn_id: uuid.UUID,
    item_id: uuid.UUID,
    payload: ReleaseNoteItemUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> ReleaseNoteItemOut:
    item = release_note_service.update_item(db, rn_id, item_id, payload)
    return ReleaseNoteItemOut.model_validate(item)


@router.delete("/{rn_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_item(
    rn_id: uuid.UUID,
    item_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> None:
    release_note_service.delete_item(db, rn_id, item_id)


@router.post("/{rn_id}/items/reorder", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def reorder_items(
    rn_id: uuid.UUID,
    payload: ReorderItemsRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> None:
    release_note_service.reorder_items(db, rn_id, payload.items)
