from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.orm import Session, selectinload

from app.models.release_mgmt import (
    DataCenter,
    PlatformRelease,
    PlatformReleaseWorkOrder,
    ReleaseNote,
    ReleaseNoteItem,
    ReleaseNoteAuthor,
    ReleaseWorkOrder,
    ReleaseWorkOrderService,
    WODCDeployment,
)
from app.models.rbac import User
from app.schemas.release_notes import (
    DCDeploymentStatus,
    FunctionalitySearchResult,
    ReleaseNoteCreate,
    ReleaseNoteItemCreate,
    ReleaseNoteItemUpdate,
    ReleaseNoteSummary,
)


def _get_or_404(db: Session, rn_id: uuid.UUID) -> ReleaseNote:
    rn = db.scalar(
        select(ReleaseNote)
        .options(selectinload(ReleaseNote.items), selectinload(ReleaseNote.authors))
        .where(ReleaseNote.id == rn_id)
    )
    if not rn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Release note not found.")
    return rn


def list_release_notes(
    db: Session,
    component_type: str | None = None,
    status_filter: str | None = None,
    q: str | None = None,
    linkable_for_wo: uuid.UUID | None = None,
    repo: str | None = None,
) -> tuple[list[ReleaseNoteSummary], int]:
    stmt = select(ReleaseNote)
    if component_type:
        stmt = stmt.where(ReleaseNote.component_type == component_type)
    if status_filter:
        stmt = stmt.where(ReleaseNote.status == status_filter)
    if repo:
        stmt = stmt.where(ReleaseNote.repo == repo)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            ReleaseNote.service_name.ilike(like)
            | ReleaseNote.repo.ilike(like)
            | ReleaseNote.tag.ilike(like)
        )

    if linkable_for_wo is not None:
        # Only show draft/published, not approved
        stmt = stmt.where(ReleaseNote.status.in_(['draft', 'published']))
        # Exclude RNs already linked to a service in a DIFFERENT WO
        linked_elsewhere = select(ReleaseWorkOrderService.release_note_id).where(
            ReleaseWorkOrderService.release_note_id.isnot(None),
            ReleaseWorkOrderService.work_order_id != linkable_for_wo,
        ).scalar_subquery()
        stmt = stmt.where(~ReleaseNote.id.in_(linked_elsewhere))

    stmt = stmt.order_by(ReleaseNote.updated_at.desc())
    notes = list(db.scalars(stmt.options(selectinload(ReleaseNote.items), selectinload(ReleaseNote.authors))).all())

    summaries = [
        ReleaseNoteSummary(
            id=n.id,
            repo=n.repo,
            branch=n.branch,
            service_name=n.service_name,
            component_type=n.component_type,
            tag=n.tag,
            status=n.status,
            approved_by=n.approved_by,
            item_count=len(n.items),
            author_count=len(n.authors),
            created_at=n.created_at,
            updated_at=n.updated_at,
        )
        for n in notes
    ]
    return summaries, len(summaries)


def search_functionality(
    db: Session,
    q: str,
    include_draft: bool = True,
    dc_id_filter: str | None = None,
    component_type: str | None = None,
    deployment_status_filter: str | None = None,
) -> list[FunctionalitySearchResult]:
    """Full-text search across release note items with DC deployment matrix."""
    like = f"%{q}%"
    item_stmt = (
        select(ReleaseNoteItem)
        .join(ReleaseNote, ReleaseNote.id == ReleaseNoteItem.release_note_id)
        .where(
            ReleaseNoteItem.title.ilike(like) | ReleaseNoteItem.description.ilike(like)
        )
    )
    if not include_draft:
        item_stmt = item_stmt.where(ReleaseNote.status.in_(['published', 'approved']))
    if component_type:
        item_stmt = item_stmt.where(ReleaseNote.component_type == component_type)

    items = db.scalars(item_stmt.options(
        selectinload(ReleaseNoteItem.release_note)
    )).all()

    # Fetch all data centers for the tenant (for DC matrix)
    all_dcs = db.scalars(select(DataCenter).where(DataCenter.is_active == True)).all()

    results: list[FunctionalitySearchResult] = []
    for item in items:
        rn = item.release_note
        if not rn:
            continue

        is_draft = rn.status == 'draft'

        # Find WO service links for this RN → WOs → platform releases → DC deployments
        wo_services = db.scalars(
            select(ReleaseWorkOrderService).where(
                ReleaseWorkOrderService.release_note_id == rn.id
            )
        ).all()

        dc_status_map: dict[str, DCDeploymentStatus] = {}
        for dc in all_dcs:
            dc_status_map[str(dc.id)] = DCDeploymentStatus(
                data_center_id=str(dc.id),
                data_center_name=dc.name,
                data_center_slug=dc.slug,
                status='not_deployed',
            )

        # Find WOs linked to this release note (via explicit FK or repo+tag match)
        wo_ids_from_explicit = [svc.work_order_id for svc in wo_services]
        # Also find WOs with services matching repo+tag (for backwards compat before FK existed)
        repo_tag_services = db.scalars(
            select(ReleaseWorkOrderService).where(
                ReleaseWorkOrderService.repo == rn.repo,
                ReleaseWorkOrderService.branch == rn.branch,
            )
        ).all()
        all_wo_ids = list(set(wo_ids_from_explicit + [s.work_order_id for s in repo_tag_services]))

        for wo_id in all_wo_ids:
            pr_links = db.scalars(
                select(PlatformReleaseWorkOrder).where(
                    PlatformReleaseWorkOrder.work_order_id == wo_id
                )
            ).all()
            for pr_link in pr_links:
                dc_deps = db.scalars(
                    select(WODCDeployment)
                    .options(selectinload(WODCDeployment.data_center))
                    .where(WODCDeployment.platform_release_id == pr_link.platform_release_id)
                ).all()
                for dep in dc_deps:
                    dc_key = str(dep.data_center_id)
                    if dc_key in dc_status_map:
                        if dep.status == 'deployed':
                            pr_obj = db.scalar(select(PlatformRelease).where(PlatformRelease.id == dep.platform_release_id))
                            dc_status_map[dc_key] = DCDeploymentStatus(
                                data_center_id=dc_key,
                                data_center_name=dep.data_center.name if dep.data_center else None,
                                data_center_slug=dep.data_center.slug if dep.data_center else None,
                                status='deployed',
                                deployed_at=dep.deployed_at,
                                platform_release_name=pr_obj.name if pr_obj else None,
                            )

        dc_list = list(dc_status_map.values())

        if dc_id_filter:
            dc_match = dc_status_map.get(dc_id_filter)
            if deployment_status_filter and dc_match and dc_match.status != deployment_status_filter:
                continue

        results.append(FunctionalitySearchResult(
            item_id=str(item.id),
            item_title=item.title,
            item_type=item.item_type,
            description=item.description,
            release_note_id=str(rn.id),
            release_note_status=rn.status,
            is_draft=is_draft,
            service_name=rn.service_name,
            repo=rn.repo,
            tag=rn.tag,
            component_type=rn.component_type,
            dc_deployments=dc_list,
        ))

    return results


def create_release_note(db: Session, payload: ReleaseNoteCreate, actor_id: uuid.UUID) -> ReleaseNote:
    existing = db.scalar(
        select(ReleaseNote).where(
            ReleaseNote.repo == payload.repo,
            ReleaseNote.branch == payload.branch,
            ReleaseNote.tag == payload.tag,
        )
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Release note for {payload.repo}@{payload.tag} already exists.",
        )

    component_type = payload.component_type
    rn = ReleaseNote(
        repo=payload.repo,
        branch=payload.branch,
        service_name=payload.service_name,
        component_type=component_type,
        tag=payload.tag,
        status='draft',
        created_by=actor_id,
        updated_by=actor_id,
    )
    db.add(rn)
    db.flush()
    author = ReleaseNoteAuthor(release_note_id=rn.id, user_id=actor_id)
    db.add(author)
    db.commit()
    db.refresh(rn)
    return _get_or_404(db, rn.id)


def get_release_note(db: Session, rn_id: uuid.UUID) -> ReleaseNote:
    return _get_or_404(db, rn_id)


def publish_release_note(db: Session, rn_id: uuid.UUID, actor_id: uuid.UUID) -> ReleaseNote:
    rn = _get_or_404(db, rn_id)
    if not rn.items:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cannot publish a release note with no items.",
        )
    if rn.status != 'draft':
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Release note is already in '{rn.status}' status.",
        )
    rn.status = 'published'
    rn.updated_by = actor_id
    db.commit()
    db.refresh(rn)
    return _get_or_404(db, rn.id)


def approve_release_note(db: Session, rn_id: uuid.UUID, approver_id: uuid.UUID, actor_id: uuid.UUID) -> ReleaseNote:
    rn = _get_or_404(db, rn_id)
    if rn.status not in ('published', 'draft'):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only published or draft release notes can be approved.",
        )
    # The original creator cannot approve their own release note (4-eyes principle).
    # Co-authors who did not create the note are allowed to approve.
    if rn.created_by and rn.created_by == approver_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The creator of a release note cannot approve their own work. "
                   "A co-author or independent reviewer must approve.",
        )
    rn.status = 'approved'
    rn.approved_by = approver_id
    rn.approved_at = datetime.now(timezone.utc)
    rn.updated_by = actor_id
    db.commit()
    return _get_or_404(db, rn.id)


def add_author(db: Session, rn_id: uuid.UUID, user_id: uuid.UUID) -> ReleaseNote:
    rn = _get_or_404(db, rn_id)
    existing = db.scalar(
        select(ReleaseNoteAuthor).where(
            ReleaseNoteAuthor.release_note_id == rn_id,
            ReleaseNoteAuthor.user_id == user_id,
        )
    )
    if not existing:
        db.add(ReleaseNoteAuthor(release_note_id=rn_id, user_id=user_id))
        db.commit()
    return _get_or_404(db, rn_id)


def remove_author(db: Session, rn_id: uuid.UUID, user_id: uuid.UUID) -> ReleaseNote:
    author = db.scalar(
        select(ReleaseNoteAuthor).where(
            ReleaseNoteAuthor.release_note_id == rn_id,
            ReleaseNoteAuthor.user_id == user_id,
        )
    )
    if author:
        db.delete(author)
        db.commit()
    return _get_or_404(db, rn_id)


def create_item(db: Session, rn_id: uuid.UUID, payload: ReleaseNoteItemCreate, actor_id: uuid.UUID) -> ReleaseNoteItem:
    _get_or_404(db, rn_id)
    max_order = db.scalar(
        select(func.max(ReleaseNoteItem.order_index)).where(
            ReleaseNoteItem.release_note_id == rn_id,
            ReleaseNoteItem.item_type == payload.item_type,
        )
    )
    order_index = (max_order or -1) + 1

    item = ReleaseNoteItem(
        release_note_id=rn_id,
        item_type=payload.item_type,
        title=payload.title,
        description=payload.description,
        migration_step=payload.migration_step,
        order_index=order_index,
        created_by=actor_id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def update_item(db: Session, rn_id: uuid.UUID, item_id: uuid.UUID, payload: ReleaseNoteItemUpdate) -> ReleaseNoteItem:
    item = db.scalar(
        select(ReleaseNoteItem).where(
            ReleaseNoteItem.id == item_id,
            ReleaseNoteItem.release_note_id == rn_id,
        )
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    item.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)
    return item


def delete_item(db: Session, rn_id: uuid.UUID, item_id: uuid.UUID) -> None:
    item = db.scalar(
        select(ReleaseNoteItem).where(
            ReleaseNoteItem.id == item_id,
            ReleaseNoteItem.release_note_id == rn_id,
        )
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found.")
    db.delete(item)
    db.commit()


def reorder_items(db: Session, rn_id: uuid.UUID, reorder_data: list[dict]) -> None:
    """Accept [{id, order_index}, ...] and apply bulk reorder."""
    _get_or_404(db, rn_id)
    for entry in reorder_data:
        item_id = uuid.UUID(str(entry['id']))
        order_index = int(entry['order_index'])
        item = db.scalar(
            select(ReleaseNoteItem).where(
                ReleaseNoteItem.id == item_id,
                ReleaseNoteItem.release_note_id == rn_id,
            )
        )
        if item:
            item.order_index = order_index
            item.updated_at = datetime.now(timezone.utc)
    db.commit()
