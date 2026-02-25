from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models.track import TaskResource, TrackPhase, TrackTask, TrackTemplate, TrackVersion
from app.schemas.track import TrackTemplateCreate


def _sort_phases(phases: list) -> list:
    return sorted(phases, key=lambda p: p.order_index)


def _sort_tasks(tasks: list) -> list:
    return sorted(tasks, key=lambda t: t.order_index)


def create_track_template(
    db: Session,
    *,
    payload: TrackTemplateCreate,
    actor_user_id: UUID,
) -> TrackTemplate:
    template = TrackTemplate(
        title=payload.title,
        description=payload.description,
        role_target=payload.role_target,
        estimated_duration_days=payload.estimated_duration_days,
        tags=payload.tags,
        created_by=actor_user_id,
        updated_by=actor_user_id,
    )
    db.add(template)
    db.flush()

    version = TrackVersion(
        template_id=template.id,
        version_number=1,
        status='draft',
        title=payload.title,
        description=payload.description,
        estimated_duration_days=payload.estimated_duration_days,
        tags=payload.tags,
        is_current=False,
        created_by=actor_user_id,
        updated_by=actor_user_id,
    )
    db.add(version)
    db.flush()

    for phase_input in _sort_phases(payload.phases):
        phase = TrackPhase(
            track_version_id=version.id,
            title=phase_input.title,
            description=phase_input.description,
            order_index=phase_input.order_index,
            created_by=actor_user_id,
            updated_by=actor_user_id,
        )
        db.add(phase)
        db.flush()

        for task_input in _sort_tasks(phase_input.tasks):
            task = TrackTask(
                track_phase_id=phase.id,
                title=task_input.title,
                description=task_input.description,
                instructions=task_input.instructions,
                task_type=task_input.task_type,
                required=task_input.required,
                order_index=task_input.order_index,
                estimated_minutes=task_input.estimated_minutes,
                passing_score=task_input.passing_score,
                metadata_json=task_input.metadata,
                due_days_offset=task_input.due_days_offset,
                created_by=actor_user_id,
                updated_by=actor_user_id,
            )
            db.add(task)
            db.flush()

            for resource_input in sorted(task_input.resources, key=lambda resource: resource.order_index):
                resource = TaskResource(
                    task_id=task.id,
                    resource_type=resource_input.resource_type,
                    title=resource_input.title,
                    content_text=resource_input.content_text,
                    url=resource_input.url,
                    order_index=resource_input.order_index,
                    metadata_json=resource_input.metadata,
                    created_by=actor_user_id,
                    updated_by=actor_user_id,
                )
                db.add(resource)

    db.flush()
    return get_track_template(db, template.id)


def list_track_templates(
    db: Session,
    *,
    page: int,
    page_size: int,
    status: str | None,
    role_target: str | None,
) -> tuple[list[TrackTemplate], int]:
    base = select(TrackTemplate)
    if role_target:
        base = base.where(TrackTemplate.role_target == role_target)

    if status:
        base = base.join(TrackTemplate.versions).where(TrackVersion.status == status)

    total = db.scalar(select(func.count()).select_from(base.subquery()))

    rows = db.scalars(
        base.options(
            joinedload(TrackTemplate.versions)
            .joinedload(TrackVersion.phases)
            .joinedload(TrackPhase.tasks)
            .joinedload(TrackTask.resources)
        )
        .order_by(TrackTemplate.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).unique().all()
    return rows, int(total or 0)


def get_track_template(db: Session, template_id: UUID) -> TrackTemplate:
    template = db.scalar(
        select(TrackTemplate)
        .where(TrackTemplate.id == template_id)
        .options(
            joinedload(TrackTemplate.versions)
            .joinedload(TrackVersion.phases)
            .joinedload(TrackPhase.tasks)
            .joinedload(TrackTask.resources)
        )
    )
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Track template not found')
    return template


def duplicate_track_template(db: Session, *, template_id: UUID, actor_user_id: UUID) -> TrackTemplate:
    source = get_track_template(db, template_id)
    if not source.versions:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Track has no versions to duplicate')

    source_version = next((version for version in source.versions if version.is_current), source.versions[-1])
    new_template = TrackTemplate(
        title=f'{source.title} Copy',
        description=source.description,
        role_target=source.role_target,
        estimated_duration_days=source.estimated_duration_days,
        tags=source.tags,
        created_by=actor_user_id,
        updated_by=actor_user_id,
    )
    db.add(new_template)
    db.flush()

    new_version = TrackVersion(
        template_id=new_template.id,
        version_number=1,
        status='draft',
        title=source_version.title,
        description=source_version.description,
        estimated_duration_days=source_version.estimated_duration_days,
        tags=source_version.tags,
        is_current=False,
        created_by=actor_user_id,
        updated_by=actor_user_id,
    )
    db.add(new_version)
    db.flush()

    for phase in sorted(source_version.phases, key=lambda row: row.order_index):
        new_phase = TrackPhase(
            track_version_id=new_version.id,
            title=phase.title,
            description=phase.description,
            order_index=phase.order_index,
            created_by=actor_user_id,
            updated_by=actor_user_id,
        )
        db.add(new_phase)
        db.flush()

        for task in sorted(phase.tasks, key=lambda row: row.order_index):
            new_task = TrackTask(
                track_phase_id=new_phase.id,
                title=task.title,
                description=task.description,
                instructions=task.instructions,
                task_type=task.task_type,
                required=task.required,
                order_index=task.order_index,
                estimated_minutes=task.estimated_minutes,
                passing_score=task.passing_score,
                metadata_json=task.metadata_json,
                due_days_offset=task.due_days_offset,
                created_by=actor_user_id,
                updated_by=actor_user_id,
            )
            db.add(new_task)
            db.flush()

            for resource in sorted(task.resources, key=lambda row: row.order_index):
                db.add(
                    TaskResource(
                        task_id=new_task.id,
                        resource_type=resource.resource_type,
                        title=resource.title,
                        content_text=resource.content_text,
                        url=resource.url,
                        order_index=resource.order_index,
                        metadata_json=resource.metadata_json,
                        created_by=actor_user_id,
                        updated_by=actor_user_id,
                    )
                )

    db.flush()
    return get_track_template(db, new_template.id)


def publish_track_version(
    db: Session,
    *,
    template_id: UUID,
    version_id: UUID,
    actor_user_id: UUID,
) -> TrackVersion:
    template = get_track_template(db, template_id)
    target = next((row for row in template.versions if row.id == version_id), None)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Track version not found')

    now = datetime.now(UTC)
    for version in template.versions:
        if version.id == version_id:
            version.status = 'published'
            version.is_current = True
            version.published_at = now
            version.updated_by = actor_user_id
        elif version.status == 'published':
            version.status = 'archived'
            version.is_current = False
            version.updated_by = actor_user_id
        else:
            version.is_current = False

    db.flush()
    return target


def get_published_track_version(db: Session, track_version_id: UUID) -> TrackVersion:
    version = db.scalar(
        select(TrackVersion)
        .where(
            TrackVersion.id == track_version_id,
            TrackVersion.status == 'published',
        )
        .options(joinedload(TrackVersion.phases).joinedload(TrackPhase.tasks).joinedload(TrackTask.resources))
    )

    if not version:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Published track version not found')
    return version
