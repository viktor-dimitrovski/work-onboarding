from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.models.rbac import User
from app.multitenancy.deps import TenantContext, require_tenant_membership
from app.multitenancy.permissions import require_access
from app.schemas.assignment import AssignmentCreate, AssignmentListResponse, AssignmentOut
from app.schemas.track import TaskResourceOut
from app.schemas.common import PaginationMeta
from app.services import assignment_service, audit_service, track_service


router = APIRouter(prefix='/assignments', tags=['assignments'])


def _add_task_resources(assignment_out: AssignmentOut, assignment) -> AssignmentOut:
    resources_by_source_id = assignment_service.extract_task_resources(assignment.snapshot_json)
    resources_by_task_id: dict[str, list[dict]] = {}

    for phase in assignment.phases:
        for task in phase.tasks:
            source_id = str(task.source_task_id) if task.source_task_id else None
            resources_by_task_id[str(task.id)] = resources_by_source_id.get(source_id, [])

    for phase in assignment_out.phases:
        for task in phase.tasks:
            raw_resources = resources_by_task_id.get(str(task.id), [])
            task.resources = [TaskResourceOut.model_validate(resource) for resource in raw_resources]

    return assignment_out


@router.get('', response_model=AssignmentListResponse)
def list_assignments(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status_filter: str | None = Query(default=None, alias='status'),
    employee_id: UUID | None = Query(default=None),
    mentor_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assignments', 'assignments:read')),
) -> AssignmentListResponse:
    roles = set(ctx.roles)
    effective_employee_id = employee_id
    effective_mentor_id = mentor_id

    if {'member', 'parent'} & roles and not {'tenant_admin', 'manager', 'mentor'} & roles:
        effective_employee_id = current_user.id
    if 'mentor' in roles and not {'tenant_admin', 'manager'} & roles:
        effective_mentor_id = current_user.id

    assignments, total = assignment_service.list_assignments(
        db,
        page=page,
        page_size=page_size,
        status_filter=status_filter,
        employee_id=effective_employee_id,
        mentor_id=effective_mentor_id,
    )

    user_ids: set[UUID] = set()
    for item in assignments:
        if item.created_by:
            user_ids.add(item.created_by)
        if item.updated_by:
            user_ids.add(item.updated_by)
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

    payload: list[AssignmentOut] = []
    for item in assignments:
        assignment_out = AssignmentOut.model_validate(item)
        assignment_out.created_by_name = display_name(users_by_id.get(item.created_by))
        assignment_out.updated_by_name = display_name(users_by_id.get(item.updated_by))
        assignment_out.created_by_email = display_email(users_by_id.get(item.created_by))
        assignment_out.updated_by_email = display_email(users_by_id.get(item.updated_by))
        if {'member', 'parent'} & roles and not {'tenant_admin', 'manager', 'mentor'} & roles:
            assignment_out = assignment_service.mask_quiz_answers_for_employee(db, assignment_out)
        assignment_out = _add_task_resources(assignment_out, item)
        payload.append(assignment_out)

    return AssignmentListResponse(items=payload, meta=PaginationMeta(page=page, page_size=page_size, total=total))


@router.post('', response_model=AssignmentOut, status_code=status.HTTP_201_CREATED)
def create_assignment(
    payload: AssignmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assignments', 'assignments:write')),
) -> AssignmentOut:
    track_version = track_service.get_published_track_version(db, payload.track_version_id)

    assignment = assignment_service.create_assignment_from_track(
        db,
        actor_user_id=current_user.id,
        employee_id=payload.employee_id,
        mentor_id=payload.mentor_id,
        track_version=track_version,
        start_date=payload.start_date,
        target_date=payload.target_date,
    )
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='assignment_create',
        entity_type='onboarding_assignment',
        entity_id=assignment.id,
        details={
            'employee_id': str(payload.employee_id),
            'mentor_id': str(payload.mentor_id) if payload.mentor_id else None,
            'track_version_id': str(payload.track_version_id),
        },
    )
    db.commit()

    return AssignmentOut.model_validate(assignment)


@router.get('/my', response_model=list[AssignmentOut])
def my_assignments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assignments', 'assignments:read')),
) -> list[AssignmentOut]:
    assignments = assignment_service.get_employee_assignments(db, employee_id=current_user.id)
    user_ids: set[UUID] = set()
    for item in assignments:
        if item.created_by:
            user_ids.add(item.created_by)
        if item.updated_by:
            user_ids.add(item.updated_by)
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

    payload: list[AssignmentOut] = []
    for assignment in assignments:
        assignment_out = AssignmentOut.model_validate(assignment)
        assignment_out.created_by_name = display_name(users_by_id.get(assignment.created_by))
        assignment_out.updated_by_name = display_name(users_by_id.get(assignment.updated_by))
        assignment_out.created_by_email = display_email(users_by_id.get(assignment.created_by))
        assignment_out.updated_by_email = display_email(users_by_id.get(assignment.updated_by))
        assignment_out = assignment_service.mask_quiz_answers_for_employee(db, assignment_out)
        assignment_out = _add_task_resources(assignment_out, assignment)
        payload.append(assignment_out)
    return payload


@router.get('/{assignment_id}', response_model=AssignmentOut)
def get_assignment(
    assignment_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assignments', 'assignments:read')),
) -> AssignmentOut:
    assignment = assignment_service.get_assignment_by_id(db, assignment_id)
    roles = set(ctx.roles)
    assignment_service.access_guard(assignment, user_id=current_user.id, roles=roles)
    assignment_out = AssignmentOut.model_validate(assignment)
    if assignment.created_by:
        user = db.scalar(select(User).where(User.id == assignment.created_by))
        assignment_out.created_by_name = ((user.full_name or '').strip() or (user.email or '').strip()) if user else None
        assignment_out.created_by_email = (user.email or '').strip() if user else None
    if assignment.updated_by:
        user = db.scalar(select(User).where(User.id == assignment.updated_by))
        assignment_out.updated_by_name = ((user.full_name or '').strip() or (user.email or '').strip()) if user else None
        assignment_out.updated_by_email = (user.email or '').strip() if user else None
    if {'member', 'parent'} & roles and not {'tenant_admin', 'manager', 'mentor'} & roles:
        assignment_out = assignment_service.mask_quiz_answers_for_employee(db, assignment_out)
    assignment_out = _add_task_resources(assignment_out, assignment)
    return assignment_out
