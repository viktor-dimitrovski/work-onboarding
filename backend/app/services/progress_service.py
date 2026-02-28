from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.assignment import AssignmentTask, MentorReview, QuizAttempt, TaskSubmission
from app.services.assignment_service import (
    get_assignment_by_id,
    get_assignment_task,
    recompute_progress,
    refresh_next_task,
    refresh_overdue_and_status,
)


REVIEW_REQUIRED_TASK_TYPES = {'mentor_approval', 'code_assignment', 'file_upload'}


def submit_task(
    db: Session,
    *,
    assignment_id: UUID,
    task_id: UUID,
    employee_id: UUID,
    submission_type: str,
    answer_text: str | None,
    file_url: str | None,
    metadata: dict,
    quiz_score: float | None,
    quiz_max_score: float | None,
    quiz_answers: dict,
) -> TaskSubmission:
    assignment = get_assignment_by_id(db, assignment_id)
    if assignment.employee_id != employee_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Only assigned employee can submit')

    task = get_assignment_task(db, assignment_id=assignment_id, task_id=task_id)

    submission = TaskSubmission(
        assignment_task_id=task.id,
        employee_id=employee_id,
        submission_type=submission_type,
        answer_text=answer_text,
        file_url=file_url,
        metadata_json=metadata,
        status='submitted',
    )
    db.add(submission)
    db.flush()

    if task.task_type == 'quiz':
        quiz_meta = task.metadata_json.get('quiz', {}) if isinstance(task.metadata_json, dict) else {}
        attempts_allowed = quiz_meta.get('attempts_allowed')

        attempt_count = int(
            db.scalar(
                select(func.count())
                .select_from(QuizAttempt)
                .where(
                    QuizAttempt.assignment_task_id == task.id,
                    QuizAttempt.employee_id == employee_id,
                )
            )
            or 0
        )
        if attempts_allowed is not None and attempt_count >= int(attempts_allowed):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail='No remaining quiz attempts for this task',
            )

        if quiz_score is None or quiz_max_score is None or quiz_max_score <= 0:
            questions = quiz_meta.get('questions', [])
            if not isinstance(questions, list):
                questions = []

            total_points = 0.0
            earned_points = 0.0
            for idx, question in enumerate(questions):
                if not isinstance(question, dict):
                    continue
                points = float(question.get('points', 1))
                total_points += points
                correct = set(question.get('correct_option_ids', []) or [])
                selected = set((quiz_answers or {}).get(str(idx), []) or [])
                if correct and selected == correct:
                    earned_points += points

            if total_points <= 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail='Quiz tasks require quiz_score or valid quiz metadata',
                )

            quiz_score = earned_points
            quiz_max_score = total_points

        percent = (quiz_score / quiz_max_score) * 100
        passed = percent >= float(task.passing_score or 0)

        db.add(
            QuizAttempt(
                assignment_task_id=task.id,
                employee_id=employee_id,
                attempt_number=attempt_count + 1,
                score=quiz_score,
                max_score=quiz_max_score,
                passed=passed,
                answers_json=quiz_answers,
                submission_id=submission.id,
            )
        )

        if passed:
            task.status = 'completed'
            task.progress_percent = 100.0
            task.completed_at = datetime.now(UTC)
            submission.status = 'reviewed'
        else:
            task.status = 'revision_requested'
            task.progress_percent = 60.0
            submission.status = 'revision_requested'
    elif task.task_type in REVIEW_REQUIRED_TASK_TYPES:
        task.status = 'pending_review'
        task.progress_percent = 75.0
    else:
        task.status = 'completed'
        task.progress_percent = 100.0
        task.completed_at = datetime.now(UTC)
        submission.status = 'reviewed'

    refresh_overdue_and_status(db, assignment)
    recompute_progress(db, assignment)
    refresh_next_task(db, assignment)
    db.flush()

    return submission


def update_checklist_item(
    db: Session,
    *,
    assignment_id: UUID,
    task_id: UUID,
    employee_id: UUID,
    item_id: str,
    checked: bool,
    comment: str | None,
) -> AssignmentTask:
    assignment = get_assignment_by_id(db, assignment_id)
    if assignment.employee_id != employee_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Only assigned employee can update checklist')

    task = get_assignment_task(db, assignment_id=assignment_id, task_id=task_id)
    if task.task_type != 'checklist':
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Task is not a checklist')

    metadata = dict(task.metadata_json or {})
    checklist = metadata.get('checklist') if isinstance(metadata.get('checklist'), dict) else {}
    items = checklist.get('items') if isinstance(checklist.get('items'), list) else []

    item_ids = {str(item.get('id')) for item in items if isinstance(item, dict) and item.get('id')}
    if item_id not in item_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Checklist item not found')

    state = metadata.get('checklist_state') if isinstance(metadata.get('checklist_state'), dict) else {}
    completed_ids = {
        str(value)
        for value in (state.get('completed_item_ids') or [])
        if value
    }
    if checked:
        completed_ids.add(item_id)
    else:
        completed_ids.discard(item_id)

    if comment is not None:
        comments = state.get('comments') if isinstance(state.get('comments'), dict) else {}
        if comment:
            comments[item_id] = comment
        else:
            comments.pop(item_id, None)
        state['comments'] = comments

    ordered_completed = [
        str(item.get('id'))
        for item in items
        if isinstance(item, dict)
        and item.get('id')
        and str(item.get('id')) in completed_ids
    ]
    state['completed_item_ids'] = ordered_completed
    metadata['checklist_state'] = state
    task.metadata_json = metadata

    required_items = [
        item for item in items if isinstance(item, dict) and item.get('id') and item.get('required', True) is not False
    ]
    if required_items:
        required_ids = {str(item.get('id')) for item in required_items}
        required_completed = len(required_ids & completed_ids)
        task.progress_percent = round((required_completed / len(required_ids)) * 100, 2)
        if required_completed == 0:
            task.status = 'not_started'
            task.completed_at = None
        elif required_completed < len(required_ids):
            task.status = 'in_progress'
            task.completed_at = None
        else:
            task.status = 'completed'
            task.progress_percent = 100.0
            task.completed_at = datetime.now(UTC)
    else:
        task.progress_percent = 0.0
        task.status = 'not_started'
        task.completed_at = None

    refresh_overdue_and_status(db, assignment)
    recompute_progress(db, assignment)
    refresh_next_task(db, assignment)
    db.flush()

    return task


def mentor_review_task(
    db: Session,
    *,
    assignment_id: UUID,
    task_id: UUID,
    mentor_id: UUID,
    decision: str,
    comment: str | None,
    allow_override: bool = False,
) -> MentorReview:
    assignment = get_assignment_by_id(db, assignment_id)
    if assignment.mentor_id != mentor_id and not allow_override:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Only assigned mentor can review')

    task = get_assignment_task(db, assignment_id=assignment_id, task_id=task_id)

    latest_submission = db.scalar(
        select(TaskSubmission)
        .where(TaskSubmission.assignment_task_id == task.id)
        .order_by(TaskSubmission.submitted_at.desc())
    )

    if decision not in {'approve', 'reject', 'revision_requested'}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid mentor decision')

    if decision == 'approve':
        task.status = 'completed'
        task.progress_percent = 100.0
        task.completed_at = datetime.now(UTC)
        if latest_submission:
            latest_submission.status = 'reviewed'
    elif decision == 'reject':
        task.status = 'blocked'
        task.progress_percent = 50.0
        if latest_submission:
            latest_submission.status = 'revision_requested'
    else:
        task.status = 'revision_requested'
        task.progress_percent = 60.0
        if latest_submission:
            latest_submission.status = 'revision_requested'

    review = MentorReview(
        assignment_task_id=task.id,
        submission_id=latest_submission.id if latest_submission else None,
        mentor_id=mentor_id,
        decision=decision,
        comment=comment,
    )
    db.add(review)

    refresh_overdue_and_status(db, assignment)
    recompute_progress(db, assignment)
    refresh_next_task(db, assignment)
    db.flush()

    return review
