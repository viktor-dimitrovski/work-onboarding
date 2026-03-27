from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.orm import Session, selectinload

from app.models.release_mgmt import (
    DataCenter,
    DeploymentRun,
    DeploymentRunItem,
    PlatformRelease,
    PlatformReleaseWorkOrder,
    WODCDeployment,
)
from app.schemas.deployment_runs import (
    AbortRunRequest,
    CompleteRunRequest,
    DeploymentRunCreate,
    DeploymentRunItemUpdate,
    DeploymentRunOut,
    DeploymentRunSummary,
    ReopenRunRequest,
)


def _get_run_or_404(db: Session, run_id: uuid.UUID) -> DeploymentRun:
    run = db.scalar(
        select(DeploymentRun)
        .options(
            selectinload(DeploymentRun.items),
            selectinload(DeploymentRun.data_center),
        )
        .where(DeploymentRun.id == run_id)
    )
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deployment run not found.")
    return run


def _build_run_out(run: DeploymentRun) -> DeploymentRunOut:
    items = run.items or []
    total = len(items)
    done = sum(1 for i in items if i.status == 'done')
    blocked = sum(1 for i in items if i.status == 'blocked')
    pending = sum(1 for i in items if i.status in ('pending', 'in_progress'))
    dc_name = run.data_center.name if run.data_center else None
    dc_slug = run.data_center.slug if run.data_center else None
    return DeploymentRunOut(
        id=str(run.id),
        platform_release_id=str(run.platform_release_id),
        data_center_id=str(run.data_center_id),
        data_center_name=dc_name,
        data_center_slug=dc_slug,
        environment=run.environment,
        status=run.status,
        started_by=str(run.started_by) if run.started_by else None,
        started_at=run.started_at,
        completed_at=run.completed_at,
        reopened_at=run.reopened_at,
        reopened_by=str(run.reopened_by) if run.reopened_by else None,
        reopen_reason=run.reopen_reason,
        notes=run.notes,
        created_at=run.created_at,
        items=[
            {
                'id': str(i.id),
                'deployment_run_id': str(i.deployment_run_id),
                'group_key': i.group_key,
                'group_label': i.group_label,
                'step_index': i.step_index,
                'item_title': i.item_title,
                'migration_step': i.migration_step,
                'status': i.status,
                'notes': i.notes,
                'marked_by': str(i.marked_by) if i.marked_by else None,
                'marked_at': i.marked_at,
            }
            for i in sorted(items, key=lambda x: (x.group_key, x.step_index))
        ],
        total_items=total,
        done_items=done,
        blocked_items=blocked,
        pending_items=pending,
    )


def _build_run_summary(run: DeploymentRun, dc_name: str | None = None, dc_slug: str | None = None) -> DeploymentRunSummary:
    items = run.items or []
    total = len(items)
    done = sum(1 for i in items if i.status == 'done')
    blocked = sum(1 for i in items if i.status == 'blocked')
    pending = sum(1 for i in items if i.status in ('pending', 'in_progress'))
    if dc_name is None and run.data_center:
        dc_name = run.data_center.name
        dc_slug = run.data_center.slug
    return DeploymentRunSummary(
        id=str(run.id),
        platform_release_id=str(run.platform_release_id),
        data_center_id=str(run.data_center_id),
        data_center_name=dc_name,
        data_center_slug=dc_slug,
        environment=run.environment,
        status=run.status,
        started_by=str(run.started_by) if run.started_by else None,
        started_at=run.started_at,
        completed_at=run.completed_at,
        total_items=total,
        done_items=done,
        blocked_items=blocked,
        pending_items=pending,
    )


def start_run(
    db: Session,
    platform_release_id: uuid.UUID,
    payload: DeploymentRunCreate,
    actor_id: uuid.UUID,
) -> DeploymentRunOut:
    pr = db.scalar(select(PlatformRelease).where(PlatformRelease.id == platform_release_id))
    if not pr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Platform release not found.")
    if pr.status not in ('cab_approved', 'deploying', 'deployed'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Platform release must be CAB approved before starting a deployment run.",
        )

    dc_id = uuid.UUID(payload.data_center_id)
    dc = db.scalar(select(DataCenter).where(DataCenter.id == dc_id))
    if not dc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Data center not found.")

    # Enforce one active run per release+DC+ENV
    existing = db.scalar(
        select(DeploymentRun).where(
            and_(
                DeploymentRun.platform_release_id == platform_release_id,
                DeploymentRun.data_center_id == dc_id,
                DeploymentRun.environment == payload.environment,
                DeploymentRun.status.in_(['pending', 'in_progress']),
            )
        )
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"An active deployment run already exists for this release on {dc.name} / {payload.environment}. Complete or abort it first.",
        )

    run = DeploymentRun(
        id=uuid.uuid4(),
        platform_release_id=platform_release_id,
        data_center_id=dc_id,
        environment=payload.environment,
        status='in_progress',
        started_by=actor_id,
        started_at=datetime.now(timezone.utc),
    )
    db.add(run)
    db.flush()

    # Materialize checklist from deploy_steps_snapshot
    snapshot: list[dict] = pr.deploy_steps_snapshot or []
    for group in snapshot:
        group_key = group.get('group_key', '')
        group_label = group.get('group_label', group_key)
        for idx, step in enumerate(group.get('steps', [])):
            item = DeploymentRunItem(
                id=uuid.uuid4(),
                deployment_run_id=run.id,
                group_key=group_key,
                group_label=group_label,
                step_index=idx,
                item_title=step.get('title', ''),
                migration_step=step.get('migration_step'),
                status='pending',
            )
            db.add(item)

    # Update platform release status to deploying
    if pr.status == 'cab_approved':
        pr.status = 'deploying'

    db.commit()
    db.refresh(run)
    db.refresh(run, ['items', 'data_center'])
    return _build_run_out(run)


def list_runs(db: Session, platform_release_id: uuid.UUID) -> list[DeploymentRunSummary]:
    runs = db.scalars(
        select(DeploymentRun)
        .options(selectinload(DeploymentRun.items), selectinload(DeploymentRun.data_center))
        .where(DeploymentRun.platform_release_id == platform_release_id)
        .order_by(DeploymentRun.started_at.desc())
    ).all()
    return [_build_run_summary(r) for r in runs]


def get_run(db: Session, run_id: uuid.UUID) -> DeploymentRunOut:
    run = _get_run_or_404(db, run_id)
    return _build_run_out(run)


def update_item(
    db: Session,
    run_id: uuid.UUID,
    item_id: uuid.UUID,
    payload: DeploymentRunItemUpdate,
    actor_id: uuid.UUID,
) -> DeploymentRunOut:
    run = _get_run_or_404(db, run_id)
    if run.status not in ('pending', 'in_progress'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot update items on a completed, aborted, or partial run. Re-open the run first.",
        )

    item = next((i for i in run.items if i.id == item_id), None)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found in this run.")

    if payload.status in ('blocked', 'postponed') and not (payload.notes or '').strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"A note is required when marking an item as '{payload.status}'.",
        )

    item.status = payload.status
    item.notes = payload.notes
    item.marked_by = actor_id
    item.marked_at = datetime.now(timezone.utc)
    run.status = 'in_progress'

    db.commit()
    db.refresh(run)
    db.refresh(run, ['items', 'data_center'])

    if payload.status == 'blocked':
        _trigger_blocked_notification(db, run, item)

    return _build_run_out(run)


def mark_all_done(db: Session, run_id: uuid.UUID, actor_id: uuid.UUID) -> DeploymentRunOut:
    run = _get_run_or_404(db, run_id)
    if run.status not in ('pending', 'in_progress'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot mark items on a completed, aborted, or partial run.",
        )
    now = datetime.now(timezone.utc)
    for item in run.items:
        if item.status == 'pending':
            item.status = 'done'
            item.marked_by = actor_id
            item.marked_at = now
    run.status = 'in_progress'
    db.commit()
    db.refresh(run)
    db.refresh(run, ['items', 'data_center'])
    return _build_run_out(run)


def complete_run(
    db: Session,
    run_id: uuid.UUID,
    payload: CompleteRunRequest,
    actor_id: uuid.UUID,
) -> DeploymentRunOut:
    run = _get_run_or_404(db, run_id)
    if run.status not in ('pending', 'in_progress'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Run is not active.",
        )

    items = run.items or []
    has_pending = any(i.status in ('pending', 'in_progress') for i in items)
    has_blocked = any(i.status in ('blocked', 'postponed') for i in items)

    if has_pending and not payload.force:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="There are still pending items. Use force=true to complete anyway.",
        )

    now = datetime.now(timezone.utc)
    run.status = 'partial' if has_blocked else 'completed'
    run.completed_at = now
    run.notes = payload.notes

    # Create WODCDeployment records for all WOs in the release
    pr = db.scalar(
        select(PlatformRelease)
        .options(selectinload(PlatformRelease.work_orders))
        .where(PlatformRelease.id == run.platform_release_id)
    )
    if pr:
        wo_status = 'deployed' if not has_blocked else 'partial'
        for prwo in pr.work_orders:
            existing = db.scalar(
                select(WODCDeployment).where(
                    and_(
                        WODCDeployment.work_order_id == prwo.work_order_id,
                        WODCDeployment.data_center_id == run.data_center_id,
                        WODCDeployment.platform_release_id == run.platform_release_id,
                    )
                )
            )
            if existing:
                existing.status = wo_status
                existing.deployed_at = now
                existing.deployed_by = actor_id
            else:
                dep = WODCDeployment(
                    id=uuid.uuid4(),
                    work_order_id=prwo.work_order_id,
                    data_center_id=run.data_center_id,
                    platform_release_id=run.platform_release_id,
                    environment=run.environment,
                    status=wo_status,
                    deployed_at=now,
                    deployed_by=actor_id,
                )
                db.add(dep)

        # Check if all DCs are deployed; update release status
        if pr.status == 'deploying' and not has_blocked:
            pr.status = 'deployed'
            pr.deployed_at = now
            pr.deployed_by = actor_id

    db.commit()
    db.refresh(run)
    db.refresh(run, ['items', 'data_center'])
    return _build_run_out(run)


def reopen_run(
    db: Session,
    run_id: uuid.UUID,
    payload: ReopenRunRequest,
    actor_id: uuid.UUID,
) -> DeploymentRunOut:
    run = _get_run_or_404(db, run_id)
    if run.status not in ('completed', 'partial'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only completed or partial runs can be re-opened.",
        )
    if not payload.reopen_reason.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A reopen reason is required.",
        )
    now = datetime.now(timezone.utc)
    run.status = 'in_progress'
    run.reopened_at = now
    run.reopened_by = actor_id
    run.reopen_reason = payload.reopen_reason
    run.completed_at = None

    db.commit()
    db.refresh(run)
    db.refresh(run, ['items', 'data_center'])
    return _build_run_out(run)


def abort_run(
    db: Session,
    run_id: uuid.UUID,
    payload: AbortRunRequest,
    actor_id: uuid.UUID,
) -> DeploymentRunOut:
    run = _get_run_or_404(db, run_id)
    if run.status not in ('pending', 'in_progress'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only active runs can be aborted.",
        )
    run.status = 'aborted'
    run.completed_at = datetime.now(timezone.utc)
    run.notes = payload.notes
    db.commit()
    db.refresh(run)
    db.refresh(run, ['items', 'data_center'])
    return _build_run_out(run)


def _trigger_blocked_notification(db: Session, run: DeploymentRun, item: DeploymentRunItem) -> None:
    """Read tenant notification settings and dispatch email on blocked item."""
    try:
        from app.models.tenant import Tenant
        tenant = db.scalar(select(Tenant).where(Tenant.id == run.tenant_id))
        if not tenant:
            return
        raw: dict = tenant.settings_json or {}
        ns: dict = raw.get('release_notifications', {})
        recipients: list[str] = list(ns.get('blocked_item_recipients', []))

        if ns.get('notify_run_starter') and run.started_by:
            from app.models.rbac import User as UserModel
            starter = db.scalar(select(UserModel).where(UserModel.id == run.started_by))
            if starter and starter.email:
                recipients.append(starter.email)

        if not recipients:
            return

        # Email dispatch — uses the application email service if available
        _send_blocked_notification_email(
            recipients=list(set(recipients)),
            run=run,
            item=item,
        )
    except Exception:
        pass  # Never fail the main request due to notification errors


def _send_blocked_notification_email(recipients: list[str], run: DeploymentRun, item: DeploymentRunItem) -> None:
    """Send blocked deployment notification. Stub — replace with real email service."""
    import logging
    logger = logging.getLogger(__name__)
    logger.info(
        "BLOCKED DEPLOYMENT ITEM — would send email to %s: run=%s, item=%s, notes=%s",
        recipients, run.id, item.item_title, item.notes,
    )
