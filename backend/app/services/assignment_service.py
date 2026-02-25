from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.models.assignment import AssignmentPhase, AssignmentTask, OnboardingAssignment
from app.models.track import TrackPhase, TrackTask, TrackVersion


COMPLETED_TASK_STATUSES = {'completed'}
IN_PROGRESS_TASK_STATUSES = {'in_progress', 'pending_review', 'revision_requested'}


def _serialize_snapshot(track_version: TrackVersion) -> dict:
    return {
        'track_version_id': str(track_version.id),
        'title': track_version.title,
        'description': track_version.description,
        'phases': [
            {
                'id': str(phase.id),
                'title': phase.title,
                'description': phase.description,
                'order_index': phase.order_index,
                'tasks': [
                    {
                        'id': str(task.id),
                        'title': task.title,
                        'description': task.description,
                        'instructions': task.instructions,
                        'task_type': task.task_type,
                        'required': task.required,
                        'order_index': task.order_index,
                        'estimated_minutes': task.estimated_minutes,
                        'passing_score': task.passing_score,
                        'metadata': task.metadata_json,
                        'due_days_offset': task.due_days_offset,
                        'resources': [
                            {
                                'id': str(resource.id),
                                'resource_type': resource.resource_type,
                                'title': resource.title,
                                'content_text': resource.content_text,
                                'url': resource.url,
                                'order_index': resource.order_index,
                                'metadata': resource.metadata_json,
                            }
                            for resource in sorted(task.resources, key=lambda item: item.order_index)
                        ],
                    }
                    for task in sorted(phase.tasks, key=lambda item: item.order_index)
                ],
            }
            for phase in sorted(track_version.phases, key=lambda item: item.order_index)
        ],
    }


def create_assignment_from_track(
    db: Session,
    *,
    actor_user_id: UUID,
    employee_id: UUID,
    mentor_id: UUID | None,
    track_version: TrackVersion,
    start_date: date,
    target_date: date,
) -> OnboardingAssignment:
    snapshot = _serialize_snapshot(track_version)

    assignment = OnboardingAssignment(
        employee_id=employee_id,
        mentor_id=mentor_id,
        template_id=track_version.template_id,
        track_version_id=track_version.id,
        title=track_version.title,
        start_date=start_date,
        target_date=target_date,
        status='not_started',
        progress_percent=0.0,
        snapshot_json=snapshot,
        created_by=actor_user_id,
        updated_by=actor_user_id,
    )
    db.add(assignment)
    db.flush()

    for phase in sorted(track_version.phases, key=lambda row: row.order_index):
        assignment_phase = AssignmentPhase(
            assignment_id=assignment.id,
            source_phase_id=phase.id,
            title=phase.title,
            description=phase.description,
            order_index=phase.order_index,
            status='not_started',
            progress_percent=0.0,
            created_by=actor_user_id,
            updated_by=actor_user_id,
        )
        db.add(assignment_phase)
        db.flush()

        for task in sorted(phase.tasks, key=lambda row: row.order_index):
            due_date = None
            if task.due_days_offset is not None:
                due_date = start_date + timedelta(days=task.due_days_offset)

            db.add(
                AssignmentTask(
                    assignment_id=assignment.id,
                    assignment_phase_id=assignment_phase.id,
                    source_task_id=task.id,
                    title=task.title,
                    description=task.description,
                    instructions=task.instructions,
                    task_type=task.task_type,
                    required=task.required,
                    order_index=task.order_index,
                    estimated_minutes=task.estimated_minutes,
                    passing_score=task.passing_score,
                    metadata_json=task.metadata_json,
                    due_date=due_date,
                    status='not_started',
                    progress_percent=0.0,
                    is_next_recommended=False,
                    created_by=actor_user_id,
                    updated_by=actor_user_id,
                )
            )

    db.flush()
    refresh_overdue_and_status(db, assignment)
    recompute_progress(db, assignment)
    refresh_next_task(db, assignment)
    db.flush()

    return get_assignment_by_id(db, assignment.id)


def get_assignment_by_id(db: Session, assignment_id: UUID) -> OnboardingAssignment:
    assignment = db.scalar(
        select(OnboardingAssignment)
        .where(OnboardingAssignment.id == assignment_id)
        .options(
            joinedload(OnboardingAssignment.phases).joinedload(AssignmentPhase.tasks),
            joinedload(OnboardingAssignment.tasks),
        )
    )
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Assignment not found')
    return assignment


def list_assignments(
    db: Session,
    *,
    page: int,
    page_size: int,
    status_filter: str | None,
    employee_id: UUID | None,
    mentor_id: UUID | None,
) -> tuple[list[OnboardingAssignment], int]:
    base = select(OnboardingAssignment)

    if status_filter:
        base = base.where(OnboardingAssignment.status == status_filter)
    if employee_id:
        base = base.where(OnboardingAssignment.employee_id == employee_id)
    if mentor_id:
        base = base.where(OnboardingAssignment.mentor_id == mentor_id)

    total = db.scalar(select(func.count()).select_from(base.subquery()))
    items = db.scalars(
        base.options(joinedload(OnboardingAssignment.phases).joinedload(AssignmentPhase.tasks))
        .order_by(OnboardingAssignment.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).unique().all()
    return items, int(total or 0)


def get_employee_assignments(db: Session, *, employee_id: UUID) -> list[OnboardingAssignment]:
    assignments = db.scalars(
        select(OnboardingAssignment)
        .where(OnboardingAssignment.employee_id == employee_id)
        .options(joinedload(OnboardingAssignment.phases).joinedload(AssignmentPhase.tasks))
        .order_by(OnboardingAssignment.created_at.desc())
    ).unique().all()
    return assignments


def get_assignment_task(db: Session, *, assignment_id: UUID, task_id: UUID) -> AssignmentTask:
    task = db.scalar(
        select(AssignmentTask).where(
            AssignmentTask.id == task_id,
            AssignmentTask.assignment_id == assignment_id,
        )
    )
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Task not found in assignment')
    return task


def refresh_overdue_and_status(db: Session, assignment: OnboardingAssignment) -> None:
    today = date.today()

    for task in assignment.tasks:
        if task.due_date and task.due_date < today and task.status not in COMPLETED_TASK_STATUSES:
            task.status = 'overdue'

    total_required = [task for task in assignment.tasks if task.required]
    completed_required = [task for task in total_required if task.status in COMPLETED_TASK_STATUSES]

    if total_required and len(completed_required) == len(total_required):
        assignment.status = 'completed'
    elif any(task.status == 'overdue' for task in assignment.tasks):
        assignment.status = 'overdue'
    elif any(task.status in IN_PROGRESS_TASK_STATUSES | {'completed'} for task in assignment.tasks):
        assignment.status = 'in_progress'
    else:
        assignment.status = 'not_started'

    assignment.updated_at = datetime.now(UTC)


def recompute_progress(db: Session, assignment: OnboardingAssignment) -> None:
    required_tasks = [task for task in assignment.tasks if task.required]
    if not required_tasks:
        assignment.progress_percent = 100.0
    else:
        completed_count = len([task for task in required_tasks if task.status in COMPLETED_TASK_STATUSES])
        assignment.progress_percent = round((completed_count / len(required_tasks)) * 100, 2)

    phase_map: dict[UUID, list[AssignmentTask]] = {}
    for task in assignment.tasks:
        phase_map.setdefault(task.assignment_phase_id, []).append(task)

    for phase in assignment.phases:
        phase_tasks = phase_map.get(phase.id, [])
        if not phase_tasks:
            phase.progress_percent = 0.0
            phase.status = 'not_started'
            continue

        required_phase_tasks = [task for task in phase_tasks if task.required]
        if not required_phase_tasks:
            phase.progress_percent = 100.0
        else:
            done = len([task for task in required_phase_tasks if task.status in COMPLETED_TASK_STATUSES])
            phase.progress_percent = round((done / len(required_phase_tasks)) * 100, 2)

        if phase.progress_percent >= 100:
            phase.status = 'completed'
        elif any(task.status in IN_PROGRESS_TASK_STATUSES | {'completed'} for task in phase_tasks):
            phase.status = 'in_progress'
        else:
            phase.status = 'not_started'


def refresh_next_task(db: Session, assignment: OnboardingAssignment) -> AssignmentTask | None:
    ordered = sorted(
        assignment.tasks,
        key=lambda task: (task.phase.order_index if task.phase else 0, task.order_index),
    )

    for task in ordered:
        task.is_next_recommended = False

    next_task = next(
        (
            task
            for task in ordered
            if task.status in {'not_started', 'in_progress', 'revision_requested', 'overdue'}
        ),
        None,
    )
    if next_task:
        next_task.is_next_recommended = True

    return next_task


def find_next_task(db: Session, assignment: OnboardingAssignment) -> AssignmentTask | None:
    return next((task for task in assignment.tasks if task.is_next_recommended), None)


def list_pending_reviews_for_mentor(db: Session, mentor_id: UUID) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(AssignmentTask)
            .join(OnboardingAssignment, AssignmentTask.assignment_id == OnboardingAssignment.id)
            .where(
                and_(
                    OnboardingAssignment.mentor_id == mentor_id,
                    AssignmentTask.status == 'pending_review',
                )
            )
        )
        or 0
    )


def access_guard(assignment: OnboardingAssignment, *, user_id: UUID, roles: set[str]) -> None:
    if {'super_admin', 'admin', 'hr_viewer'} & roles:
        return
    if assignment.employee_id == user_id:
        return
    if assignment.mentor_id == user_id:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Access denied for assignment')
