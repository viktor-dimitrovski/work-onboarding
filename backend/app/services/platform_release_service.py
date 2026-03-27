from __future__ import annotations

import uuid
from datetime import datetime, timezone
from packaging.version import Version, InvalidVersion

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.release_mgmt import (
    DataCenter,
    DeploymentRun,
    DeploymentRunItem,
    PlatformRelease,
    PlatformReleaseWorkOrder,
    ReleaseNote,
    ReleaseNoteItem,
    ReleaseWorkOrder,
    ReleaseWorkOrderService,
    WODCDeployment,
)
from app.schemas.platform_releases import (
    DeployToAnotherDCRequest,
    PlatformReleaseCreate,
    PlatformReleaseUpdate,
    PlatformReleaseSummary,
    RecordDeploymentRequest,
)


def _get_or_404(db: Session, pr_id: uuid.UUID) -> PlatformRelease:
    pr = db.scalar(
        select(PlatformRelease)
        .options(
            selectinload(PlatformRelease.work_orders).selectinload(PlatformReleaseWorkOrder.work_order),
            selectinload(PlatformRelease.data_center),
        )
        .where(PlatformRelease.id == pr_id)
    )
    if not pr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Platform release not found.")
    return pr


def _parse_semver(tag: str) -> tuple[int, int, int]:
    """Extract numeric version from tags like '2.4.1', 'pl_pko_1.3.2', 'ing_2.1.0'."""
    parts = tag.rsplit('_', 1)
    version_str = parts[-1] if len(parts) > 1 else parts[0]
    try:
        v = Version(version_str)
        return (v.major, v.minor, v.micro)
    except InvalidVersion:
        return (0, 0, 0)


def list_platform_releases(db: Session) -> tuple[list[PlatformReleaseSummary], int]:
    releases = list(
        db.scalars(
            select(PlatformRelease)
            .options(selectinload(PlatformRelease.work_orders), selectinload(PlatformRelease.data_center))
            .order_by(PlatformRelease.created_at.desc())
        ).all()
    )

    summaries = []
    for pr in releases:
        summaries.append(
            PlatformReleaseSummary(
                id=pr.id,
                name=pr.name,
                release_type=pr.release_type,
                status=pr.status,
                environment=pr.environment,
                data_center_id=pr.data_center_id,
                data_center_name=pr.data_center.name if pr.data_center else None,
                cab_approver_id=pr.cab_approver_id,
                cab_approved_at=pr.cab_approved_at,
                generated_at=pr.generated_at,
                work_order_count=len(pr.work_orders),
                service_count=len(pr.services_snapshot) if pr.services_snapshot else 0,
                deployed_at=pr.deployed_at,
                created_at=pr.created_at,
                updated_at=pr.updated_at,
            )
        )
    return summaries, len(summaries)


def create_platform_release(db: Session, payload: PlatformReleaseCreate, actor_id: uuid.UUID) -> PlatformRelease:
    pr = PlatformRelease(
        name=payload.name,
        release_type=payload.release_type,
        environment=payload.environment,
        data_center_id=payload.data_center_id,
        cab_approver_id=payload.cab_approver_id,
        status='draft',
        created_by=actor_id,
        updated_by=actor_id,
    )
    db.add(pr)
    db.flush()

    for wo_id in payload.work_order_ids:
        wo = db.scalar(select(ReleaseWorkOrder).where(ReleaseWorkOrder.id == wo_id))
        if wo:
            db.add(PlatformReleaseWorkOrder(
                platform_release_id=pr.id,
                work_order_id=wo_id,
                included_by=actor_id,
            ))

    db.commit()
    return _get_or_404(db, pr.id)


def get_platform_release(db: Session, pr_id: uuid.UUID) -> PlatformRelease:
    return _get_or_404(db, pr_id)


def update_platform_release(
    db: Session, pr_id: uuid.UUID, payload: PlatformReleaseUpdate, actor_id: uuid.UUID
) -> PlatformRelease:
    pr = _get_or_404(db, pr_id)
    if pr.status not in ('draft', 'preparation'):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot update a release that is cab_approved or later.",
        )
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(pr, field, value)
    pr.updated_by = actor_id
    db.commit()
    return _get_or_404(db, pr_id)


def update_work_orders(
    db: Session, pr_id: uuid.UUID, work_order_ids: list[uuid.UUID], actor_id: uuid.UUID
) -> PlatformRelease:
    pr = _get_or_404(db, pr_id)
    if pr.status not in ('draft', 'preparation'):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot change work orders after CAB approval.",
        )

    # Remove all existing, re-add
    existing = list(db.scalars(
        select(PlatformReleaseWorkOrder).where(PlatformReleaseWorkOrder.platform_release_id == pr_id)
    ).all())
    for link in existing:
        db.delete(link)
    db.flush()

    for wo_id in work_order_ids:
        db.add(PlatformReleaseWorkOrder(
            platform_release_id=pr_id,
            work_order_id=wo_id,
            included_by=actor_id,
        ))

    # Reset snapshots if WOs changed
    pr.services_snapshot = []
    pr.changelog_snapshot = []
    pr.deploy_steps_snapshot = []
    pr.generated_at = None
    pr.status = 'draft'
    pr.updated_by = actor_id
    db.commit()
    return _get_or_404(db, pr_id)


def generate_release_plan(db: Session, pr_id: uuid.UUID, actor_id: uuid.UUID) -> PlatformRelease:
    """
    Auto-aggregate from selected WOs:
    1. Union all (repo, branch) pairs across all WO services
    2. For duplicates: pick the latest semver tag
    3. For each (repo, branch, tag): look up release_note_items
    4. Build services_snapshot, changelog_snapshot, deploy_steps_snapshot
    """
    pr = _get_or_404(db, pr_id)
    if pr.status not in ('draft', 'preparation'):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Can only generate plan for draft or preparation releases.",
        )

    wo_ids = [link.work_order_id for link in pr.work_orders]
    if not wo_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No work orders selected. Add work orders before generating.",
        )

    # Fetch all work order services across selected WOs
    services = list(db.scalars(
        select(ReleaseWorkOrderService).where(ReleaseWorkOrderService.work_order_id.in_(wo_ids))
    ).all())

    # Group by (repo, branch) → collect all {tag, wo_id, change_type}
    groups: dict[tuple[str, str | None], list[dict]] = {}
    for svc in services:
        if not svc.repo:
            continue
        key = (svc.repo, svc.branch)
        if key not in groups:
            groups[key] = []
        groups[key].append({
            'tag': svc.release_notes_ref or '',
            'wo_id': str(svc.work_order_id),
            'change_type': svc.change_type or 'update',
            'service_id': svc.service_id,
        })

    # For each (repo, branch): pick best tag (latest semver)
    services_snapshot = []
    changelog_snapshot = []
    deploy_steps_snapshot = []

    # Load work orders for wo_number lookup
    wo_map: dict[str, ReleaseWorkOrder] = {}
    wos = list(db.scalars(select(ReleaseWorkOrder).where(ReleaseWorkOrder.id.in_(wo_ids))).all())
    for wo in wos:
        wo_map[str(wo.id)] = wo

    for (repo, branch), entries in groups.items():
        # Pick latest semver tag
        best_entry = max(entries, key=lambda e: _parse_semver(e['tag']))
        best_tag = best_entry['tag']
        contributing_wo_ids = list({e['wo_id'] for e in entries})

        # Determine component type
        component_type = 'config' if branch else 'service'
        service_name = repo.split('/')[-1] if '/' in repo else repo
        if branch and component_type == 'config':
            service_name = f"{service_name} ({branch})"

        services_snapshot.append({
            'repo': repo,
            'branch': branch,
            'service_name': service_name,
            'component_type': component_type,
            'tag': best_tag,
            'change_type': best_entry['change_type'],
            'wo_ids': contributing_wo_ids,
        })

        # Look up release note for this exact (repo, branch, tag)
        rn = db.scalar(
            select(ReleaseNote).where(
                ReleaseNote.repo == repo,
                ReleaseNote.branch == branch,
                ReleaseNote.tag == best_tag,
            )
        )

        if rn:
            items = list(db.scalars(
                select(ReleaseNoteItem)
                .where(ReleaseNoteItem.release_note_id == rn.id)
                .order_by(ReleaseNoteItem.item_type, ReleaseNoteItem.order_index)
            ).all())

            # Changelog entries
            for item in items:
                wo_obj = wo_map.get(contributing_wo_ids[0]) if contributing_wo_ids else None
                changelog_snapshot.append({
                    'item_type': item.item_type,
                    'title': item.title,
                    'description': item.description,
                    'repo': repo,
                    'branch': branch,
                    'service_name': service_name,
                    'tag': best_tag,
                    'component_type': component_type,
                    'wo_id': contributing_wo_ids[0] if contributing_wo_ids else None,
                    'wo_number': wo_obj.wo_id if wo_obj else None,
                })

            # Deploy steps (only items with migration_step)
            deploy_steps = [
                {
                    'order_index': item.order_index,
                    'migration_step': item.migration_step,
                    'item_title': item.title,
                    'wo_id': contributing_wo_ids[0] if contributing_wo_ids else None,
                }
                for item in items
                if item.migration_step
            ]
            if deploy_steps:
                deploy_steps_snapshot.append({
                    'repo': repo,
                    'branch': branch,
                    'service_name': service_name,
                    'component_type': component_type,
                    'tag': best_tag,
                    'steps': deploy_steps,
                })

    # Sort: services first, then configs
    services_snapshot.sort(key=lambda x: (0 if x['component_type'] == 'service' else 1, x['service_name']))
    deploy_steps_snapshot.sort(key=lambda x: (0 if x['component_type'] == 'service' else 1, x['service_name']))

    pr.services_snapshot = services_snapshot
    pr.changelog_snapshot = changelog_snapshot
    pr.deploy_steps_snapshot = deploy_steps_snapshot
    pr.generated_at = datetime.now(timezone.utc)
    pr.generated_by = actor_id
    pr.status = 'preparation'
    pr.updated_by = actor_id
    db.commit()
    return _get_or_404(db, pr_id)


def request_cab_approval(db: Session, pr_id: uuid.UUID, actor_id: uuid.UUID) -> PlatformRelease:
    pr = _get_or_404(db, pr_id)
    if pr.status != 'preparation':
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Release must be in 'preparation' status to request CAB approval.",
        )
    if not pr.cab_approver_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Set a CAB approver before requesting approval.",
        )
    pr.updated_by = actor_id
    db.commit()
    return _get_or_404(db, pr_id)


def approve_cab(db: Session, pr_id: uuid.UUID, notes: str | None, actor_id: uuid.UUID) -> PlatformRelease:
    pr = _get_or_404(db, pr_id)
    if pr.status != 'preparation':
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Release must be in 'preparation' status for CAB approval.",
        )
    pr.status = 'cab_approved'
    pr.cab_approved_at = datetime.now(timezone.utc)
    pr.cab_approver_id = actor_id
    if notes:
        pr.cab_notes = notes
    pr.updated_by = actor_id
    db.commit()
    return _get_or_404(db, pr_id)


def record_deployment(
    db: Session, pr_id: uuid.UUID, payload: RecordDeploymentRequest, actor_id: uuid.UUID
) -> PlatformRelease:
    pr = _get_or_404(db, pr_id)
    if pr.status not in ('cab_approved', 'deploying', 'deployed'):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Release must be CAB-approved before recording deployment.",
        )

    now = datetime.now(timezone.utc)
    wo_ids = [link.work_order_id for link in pr.work_orders]

    for wo_id in wo_ids:
        deployment = WODCDeployment(
            work_order_id=wo_id,
            data_center_id=payload.data_center_id,
            platform_release_id=pr_id,
            environment=payload.environment or pr.environment,
            status='deployed',
            deployed_at=now,
            deployed_by=payload.deployed_by or actor_id,
            notes=payload.notes,
        )
        db.add(deployment)

    pr.status = 'deployed'
    pr.deployed_at = now
    pr.deployed_by = actor_id
    pr.updated_by = actor_id
    db.commit()
    return _get_or_404(db, pr_id)


def close_platform_release(db: Session, pr_id: uuid.UUID, actor_id: uuid.UUID) -> PlatformRelease:
    pr = _get_or_404(db, pr_id)
    pr.status = 'closed'
    pr.updated_by = actor_id
    db.commit()
    return _get_or_404(db, pr_id)


def deploy_to_another_dc(
    db: Session,
    source_pr_id: uuid.UUID,
    payload: DeployToAnotherDCRequest,
    actor_id: uuid.UUID,
) -> PlatformRelease:
    """Create a new DC-Extension platform release cloned from the source, targeting a different DC."""
    source = _get_or_404(db, source_pr_id)
    if source.status not in ('cab_approved', 'deployed', 'closed'):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Source release must be CAB-approved or deployed before deploying to another DC.",
        )

    target_dc = db.scalar(select(DataCenter).where(DataCenter.id == payload.target_data_center_id))
    if not target_dc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target data center not found.")

    dc_name = target_dc.slug.upper()
    auto_name = f"{source.name}-{dc_name}"
    new_name = (payload.name or auto_name)[:120]

    new_pr = PlatformRelease(
        tenant_id=source.tenant_id,
        name=new_name,
        release_type='ad_hoc',
        status='cab_approved',
        environment=source.environment,
        data_center_id=payload.target_data_center_id,
        cab_approver_id=source.cab_approver_id,
        cab_approved_at=source.cab_approved_at,
        cab_notes=f"DC extension from {source.name}",
        generated_at=source.generated_at,
        generated_by=source.generated_by,
        services_snapshot=source.services_snapshot,
        changelog_snapshot=source.changelog_snapshot,
        deploy_steps_snapshot=source.deploy_steps_snapshot,
        created_by=actor_id,
        updated_by=actor_id,
    )
    db.add(new_pr)
    db.flush()

    # Clone WO links
    for link in source.work_orders:
        db.add(PlatformReleaseWorkOrder(
            platform_release_id=new_pr.id,
            work_order_id=link.work_order_id,
            included_at=datetime.now(timezone.utc),
            included_by=actor_id,
        ))

    db.commit()
    return _get_or_404(db, new_pr.id)


def get_dc_deployments_for_wo(db: Session, wo_id: uuid.UUID) -> list[WODCDeployment]:
    return list(db.scalars(
        select(WODCDeployment)
        .options(selectinload(WODCDeployment.data_center))
        .where(WODCDeployment.work_order_id == wo_id)
        .order_by(WODCDeployment.deployed_at.desc())
    ).all())


def promote_to_draft(db: Session, pr_id: uuid.UUID, actor_id: uuid.UUID) -> PlatformRelease:
    pr = _get_or_404(db, pr_id)
    if pr.status != 'planned':
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only planned releases can be promoted to draft.",
        )
    pr.status = 'draft'
    pr.updated_by = actor_id
    db.commit()
    return _get_or_404(db, pr_id)


def get_center_summary(db: Session) -> dict:
    """Return pre-aggregated data for the Release Center operations dashboard."""
    from datetime import date as date_type
    from app.models.release_mgmt import DeploymentRun
    from app.schemas.platform_releases import ReleaseCenterSummaryItem, ReleaseCenterResponse

    in_flight_statuses = {'draft', 'preparation', 'cab_approved', 'deploying', 'deployed'}
    all_releases = list(db.scalars(
        select(PlatformRelease)
        .options(
            selectinload(PlatformRelease.work_orders),
            selectinload(PlatformRelease.data_center),
        )
        .order_by(PlatformRelease.planned_start.asc().nullslast(), PlatformRelease.created_at.desc())
    ).all())

    in_flight: list[ReleaseCenterSummaryItem] = []
    planned: list[ReleaseCenterSummaryItem] = []
    recently_closed: list[ReleaseCenterSummaryItem] = []

    today = date_type.today()

    for pr in all_releases:
        wc = len(pr.work_orders)
        sc = len(pr.services_snapshot or [])
        dc_name = pr.data_center.name if pr.data_center else None
        dc_slug = pr.data_center.slug if pr.data_center else None

        days_to_window: int | None = None
        if pr.planned_start:
            delta = (pr.planned_start - today).days
            days_to_window = delta

        # Determine next_action and waiting_on
        next_action, waiting_on, active_run_id, active_run_progress = _compute_next_action(db, pr)

        item = ReleaseCenterSummaryItem(
            id=str(pr.id),
            name=pr.name,
            release_type=pr.release_type,
            status=pr.status,
            environment=pr.environment,
            data_center_id=str(pr.data_center_id) if pr.data_center_id else None,
            data_center_name=dc_name,
            data_center_slug=dc_slug,
            planned_start=pr.planned_start,
            planned_end=pr.planned_end,
            planning_notes=pr.planning_notes,
            work_order_count=wc,
            cab_approver_id=str(pr.cab_approver_id) if pr.cab_approver_id else None,
            cab_approved_at=pr.cab_approved_at,
            generated_at=pr.generated_at,
            deployed_at=pr.deployed_at,
            created_at=pr.created_at,
            next_action=next_action,
            waiting_on=waiting_on,
            days_to_window=days_to_window,
            active_run_id=active_run_id,
            active_run_progress=active_run_progress,
        )

        if pr.status == 'planned':
            planned.append(item)
        elif pr.status in in_flight_statuses:
            in_flight.append(item)
        elif pr.status in ('deployed', 'closed'):
            recently_closed.append(item)

    recently_closed = recently_closed[:5]

    return ReleaseCenterResponse(
        in_flight=in_flight,
        planned=planned,
        recently_closed=recently_closed,
    )


def _compute_next_action(db: Session, pr: PlatformRelease) -> tuple[str | None, dict | None, str | None, dict | None]:
    if pr.status == 'draft':
        if not pr.work_orders:
            return 'add_work_orders', None, None, None
        if not pr.generated_at:
            return 'generate_plan', None, None, None
        if not pr.cab_approver_id:
            return 'assign_approver', None, None, None
        return 'request_cab_approval', None, None, None

    if pr.status == 'preparation':
        if not pr.cab_approver_id:
            return 'assign_approver', None, None, None
        return 'awaiting_cab_approval', {
            'type': 'cab_approval',
            'approver_id': str(pr.cab_approver_id),
        }, None, None

    if pr.status == 'cab_approved':
        return 'start_deployment', None, None, None

    if pr.status == 'deploying':
        active_run = db.scalar(
            select(DeploymentRun)
            .where(
                DeploymentRun.platform_release_id == pr.id,
                DeploymentRun.status.in_(['pending', 'in_progress']),
            )
            .order_by(DeploymentRun.started_at.desc())
        )
        if active_run:
            run_items = list(db.scalars(
                select(DeploymentRunItem).where(
                    DeploymentRunItem.deployment_run_id == active_run.id
                )
            ).all())
            total = len(run_items)
            done = sum(1 for i in run_items if i.status == 'done')
            blocked = sum(1 for i in run_items if i.status == 'blocked')
            progress = {'total': total, 'done': done, 'blocked': blocked}
            if blocked:
                return 'deployment_blocked', {
                    'type': 'blocked_items',
                    'count': blocked,
                    'run_id': str(active_run.id),
                }, str(active_run.id), progress
            return 'deployment_in_progress', None, str(active_run.id), progress
        return 'start_deployment', None, None, None

    if pr.status == 'deployed':
        return 'close_release', None, None, None

    return None, None, None, None
