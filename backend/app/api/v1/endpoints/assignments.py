from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.models.rbac import User
from app.multitenancy.deps import TenantContext, require_tenant_membership
from app.multitenancy.permissions import require_access
from app.schemas.assignment import AssignmentCreate, AssignmentListResponse, AssignmentOut
from app.schemas.common import PaginationMeta
from app.services import assignment_service, audit_service, track_service


router = APIRouter(prefix='/assignments', tags=['assignments'])


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

    payload: list[AssignmentOut] = []
    for item in assignments:
        assignment_out = AssignmentOut.model_validate(item)
        if {'member', 'parent'} & roles and not {'tenant_admin', 'manager', 'mentor'} & roles:
            assignment_out = assignment_service.mask_quiz_answers_for_employee(db, assignment_out)
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
    payload = [AssignmentOut.model_validate(item) for item in assignments]
    return [assignment_service.mask_quiz_answers_for_employee(db, item) for item in payload]


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
    if {'member', 'parent'} & roles and not {'tenant_admin', 'manager', 'mentor'} & roles:
        assignment_out = assignment_service.mask_quiz_answers_for_employee(db, assignment_out)
    return assignment_out
