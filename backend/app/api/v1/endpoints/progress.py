from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.models.rbac import User
from app.multitenancy.deps import TenantContext, require_tenant_membership
from app.multitenancy.permissions import require_access
from app.schemas.assignment import AssignmentTaskOut, NextTaskResponse
from app.schemas.progress import MentorReviewCreate, MentorReviewOut, QuizAttemptOut, TaskSubmissionCreate, TaskSubmissionOut
from app.models.assignment import QuizAttempt
from app.services import assignment_service, audit_service, progress_service, usage_service


router = APIRouter(prefix='/progress', tags=['progress'])


@router.post('/assignments/{assignment_id}/tasks/{task_id}/submit', response_model=TaskSubmissionOut)
def submit_task(
    assignment_id: UUID,
    task_id: UUID,
    payload: TaskSubmissionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assignments', 'assignments:submit')),
) -> TaskSubmissionOut:
    assignment = assignment_service.get_assignment_by_id(db, assignment_id)
    roles = set(ctx.roles)
    if {'member', 'parent'} & roles and assignment.employee_id != current_user.id and not {'tenant_admin', 'manager'} & roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Employees can only submit their own tasks',
        )

    submission = progress_service.submit_task(
        db,
        assignment_id=assignment_id,
        task_id=task_id,
        employee_id=assignment.employee_id,
        submission_type=payload.submission_type,
        answer_text=payload.answer_text,
        file_url=payload.file_url,
        metadata=payload.metadata,
        quiz_score=payload.quiz_score,
        quiz_max_score=payload.quiz_max_score,
        quiz_answers=payload.quiz_answers,
    )
    usage_service.record_event(
        db,
        tenant_id=ctx.tenant.id,
        event_key='assignment.task_submit',
        quantity=1.0,
        actor_user_id=current_user.id,
        meta={'assignment_id': str(assignment_id), 'task_id': str(task_id), 'submission_type': payload.submission_type},
    )
    if payload.quiz_score is not None:
        usage_service.record_event(
            db,
            tenant_id=ctx.tenant.id,
            event_key='quiz_attempt',
            quantity=1.0,
            actor_user_id=current_user.id,
            meta={'assignment_id': str(assignment_id), 'task_id': str(task_id)},
        )
    if payload.file_url:
        usage_service.record_event(
            db,
            tenant_id=ctx.tenant.id,
            event_key='file_upload',
            quantity=1.0,
            actor_user_id=current_user.id,
            meta={'assignment_id': str(assignment_id), 'task_id': str(task_id)},
        )
    db.commit()
    return TaskSubmissionOut.model_validate(submission)


@router.post('/assignments/{assignment_id}/tasks/{task_id}/review', response_model=MentorReviewOut)
def review_task(
    assignment_id: UUID,
    task_id: UUID,
    payload: MentorReviewCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assignments', 'assignments:review')),
) -> MentorReviewOut:
    roles = set(ctx.roles)
    review = progress_service.mentor_review_task(
        db,
        assignment_id=assignment_id,
        task_id=task_id,
        mentor_id=current_user.id,
        decision=payload.decision,
        comment=payload.comment,
        allow_override=bool({'tenant_admin', 'manager'} & roles),
    )

    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='mentor_review',
        entity_type='assignment_task',
        entity_id=task_id,
        details={
            'assignment_id': str(assignment_id),
            'decision': payload.decision,
        },
    )
    db.commit()
    return MentorReviewOut.model_validate(review)


@router.get('/assignments/{assignment_id}/next-task', response_model=NextTaskResponse)
def next_task(
    assignment_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assignments', 'assignments:read')),
) -> NextTaskResponse:
    assignment = assignment_service.get_assignment_by_id(db, assignment_id)
    assignment_service.access_guard(assignment, user_id=current_user.id, roles=set(ctx.roles))
    task = assignment_service.find_next_task(db, assignment)
    return NextTaskResponse(
        assignment_id=assignment_id,
        task=AssignmentTaskOut.model_validate(task) if task else None,
    )


@router.get('/assignments/{assignment_id}/tasks/{task_id}/quiz-attempts', response_model=list[QuizAttemptOut])
def quiz_attempts(
    assignment_id: UUID,
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assignments', 'assignments:read')),
) -> list[QuizAttemptOut]:
    assignment = assignment_service.get_assignment_by_id(db, assignment_id)
    assignment_service.access_guard(assignment, user_id=current_user.id, roles=set(ctx.roles))

    task = assignment_service.get_assignment_task(db, assignment_id=assignment_id, task_id=task_id)
    if task.task_type != 'quiz':
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Task is not a quiz')

    attempts = db.scalars(
        select(QuizAttempt)
        .where(QuizAttempt.assignment_task_id == task_id)
        .order_by(QuizAttempt.attempt_number.asc())
    ).all()

    return [QuizAttemptOut.model_validate(attempt) for attempt in attempts]
