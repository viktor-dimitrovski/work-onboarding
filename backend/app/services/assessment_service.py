from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.models.assignment import AssignmentTask
from app.models.assessment import (
    AssessmentAttempt,
    AssessmentAttemptAnswer,
    AssessmentDelivery,
    AssessmentCategory,
    AssessmentQuestion,
    AssessmentQuestionOption,
    AssessmentTest,
    AssessmentTestVersion,
    AssessmentTestVersionQuestion,
)


def build_question_query(
    *,
    status_filters: list[str] | None,
    query: str | None,
    tags: list[str] | None,
    difficulties: list[str] | None,
    categories: list[str] | None,
    include_joins: bool,
):
    base = select(AssessmentQuestion)
    if include_joins:
        base = base.options(
            joinedload(AssessmentQuestion.options),
            joinedload(AssessmentQuestion.category),
        )

    if status_filters:
        base = base.where(AssessmentQuestion.status.in_(status_filters))
    if difficulties:
        base = base.where(AssessmentQuestion.difficulty.in_(difficulties))
    if query:
        base = base.where(
            or_(
                AssessmentQuestion.prompt.ilike(f'%{query}%'),
                AssessmentQuestion.explanation.ilike(f'%{query}%'),
            )
        )
    if tags:
        base = base.where(or_(*[AssessmentQuestion.tags.contains([tag]) for tag in tags]))
    if categories:
        include_unclassified = 'unclassified' in categories
        category_slugs = [slug for slug in categories if slug != 'unclassified']
        filters = []
        if category_slugs:
            filters.append(AssessmentCategory.slug.in_(category_slugs))
        if include_unclassified:
            filters.append(AssessmentQuestion.category_id.is_(None))
        if filters:
            base = base.outerjoin(AssessmentQuestion.category).where(or_(*filters))

    return base


def list_questions(
    db: Session,
    *,
    page: int,
    page_size: int,
    status_filters: list[str] | None,
    query: str | None,
    tags: list[str] | None,
    difficulties: list[str] | None,
    categories: list[str] | None,
) -> tuple[list[AssessmentQuestion], int]:
    base = build_question_query(
        status_filters=status_filters,
        query=query,
        tags=tags,
        difficulties=difficulties,
        categories=categories,
        include_joins=True,
    )

    total = db.scalar(select(func.count()).select_from(base.subquery()))
    items = (
        db.scalars(base.order_by(AssessmentQuestion.created_at.desc()).offset((page - 1) * page_size).limit(page_size))
        .unique()
        .all()
    )
    return items, int(total or 0)


def question_stats(
    db: Session,
    *,
    status_filters: list[str] | None,
    query: str | None,
    tags: list[str] | None,
    difficulties: list[str] | None,
    categories: list[str] | None,
) -> dict[str, object]:
    base = build_question_query(
        status_filters=status_filters,
        query=query,
        tags=tags,
        difficulties=difficulties,
        categories=categories,
        include_joins=False,
    ).subquery()

    total = int(db.scalar(select(func.count()).select_from(base)) or 0)
    unclassified_category = int(
        db.scalar(select(func.count()).select_from(base).where(base.c.category_id.is_(None))) or 0
    )
    unclassified_difficulty = int(
        db.scalar(select(func.count()).select_from(base).where(base.c.difficulty.is_(None))) or 0
    )

    by_status_rows = db.execute(
        select(base.c.status, func.count()).select_from(base).group_by(base.c.status)
    ).all()
    by_status = {str(row[0]): int(row[1] or 0) for row in by_status_rows if row[0]}

    by_diff_rows = db.execute(
        select(base.c.difficulty, func.count()).select_from(base).group_by(base.c.difficulty)
    ).all()
    by_difficulty: dict[str, int] = {}
    for diff, cnt in by_diff_rows:
        key = str(diff) if diff else 'unspecified'
        by_difficulty[key] = int(cnt or 0)

    cat_rows = db.execute(
        select(AssessmentCategory.slug, func.count())
        .select_from(base.join(AssessmentCategory, base.c.category_id == AssessmentCategory.id, isouter=True))
        .group_by(AssessmentCategory.slug)
    ).all()
    by_category: dict[str, int] = {'unclassified': 0}
    for slug, cnt in cat_rows:
        if slug is None:
            by_category['unclassified'] = int(cnt or 0)
        else:
            by_category[str(slug)] = int(cnt or 0)

    return {
        'total': total,
        'unclassified_category': unclassified_category,
        'unclassified_difficulty': unclassified_difficulty,
        'by_status': by_status,
        'by_difficulty': by_difficulty,
        'by_category': by_category,
    }


def bulk_update_questions(
    db: Session,
    *,
    actor_user_id: UUID,
    scope: str,
    question_ids: list[UUID],
    status_filters: list[str] | None,
    query: str | None,
    tags: list[str] | None,
    difficulties: list[str] | None,
    categories: list[str] | None,
    action: str,
    status_value: str | None,
    category_id: UUID | None,
    difficulty_value: str | None,
    tags_value: list[str],
) -> int:
    if scope not in ('selected', 'all_matching'):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid scope')

    ids: list[UUID]
    if scope == 'selected':
        ids = list(question_ids or [])
    else:
        base = build_question_query(
            status_filters=status_filters,
            query=query,
            tags=tags,
            difficulties=difficulties,
            categories=categories,
            include_joins=False,
        )
        ids = [row[0] for row in db.execute(select(AssessmentQuestion.id).select_from(base.subquery())).all()]

    if not ids:
        return 0

    if action == 'set_status':
        if status_value not in ('draft', 'published', 'archived'):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid status_value')
        rows = db.scalars(select(AssessmentQuestion).where(AssessmentQuestion.id.in_(ids))).all()
        for q in rows:
            q.status = status_value
            q.updated_by = actor_user_id
        db.flush()
        return len(rows)

    if action == 'set_category':
        if category_id is not None:
            category = db.scalar(select(AssessmentCategory).where(AssessmentCategory.id == category_id))
            if not category:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Category not found')
        rows = db.scalars(select(AssessmentQuestion).where(AssessmentQuestion.id.in_(ids))).all()
        for q in rows:
            q.category_id = category_id
            q.updated_by = actor_user_id
        db.flush()
        return len(rows)

    if action == 'set_difficulty':
        if difficulty_value is not None and difficulty_value not in ('easy', 'medium', 'hard'):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid difficulty_value')
        rows = db.scalars(select(AssessmentQuestion).where(AssessmentQuestion.id.in_(ids))).all()
        for q in rows:
            q.difficulty = difficulty_value
            q.updated_by = actor_user_id
        db.flush()
        return len(rows)

    normalized_tags = [t.strip() for t in (tags_value or []) if t and t.strip()]
    # de-dupe while preserving order
    seen = set()
    normalized_tags = [t for t in normalized_tags if not (t in seen or seen.add(t))]

    if action in ('add_tags', 'remove_tags', 'replace_tags'):
        rows = db.scalars(select(AssessmentQuestion).where(AssessmentQuestion.id.in_(ids))).all()
        for q in rows:
            current = list(q.tags or [])
            if action == 'replace_tags':
                q.tags = normalized_tags
            elif action == 'add_tags':
                merged = current + [t for t in normalized_tags if t not in current]
                q.tags = merged
            else:  # remove_tags
                q.tags = [t for t in current if t not in set(normalized_tags)]
            q.updated_by = actor_user_id
        db.flush()
        return len(rows)

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid action')


def list_categories(db: Session) -> list[AssessmentCategory]:
    return db.scalars(select(AssessmentCategory).order_by(AssessmentCategory.name.asc())).all()


def get_question(db: Session, question_id: UUID) -> AssessmentQuestion:
    question = db.scalar(
        select(AssessmentQuestion)
        .where(AssessmentQuestion.id == question_id)
        .options(joinedload(AssessmentQuestion.options))
    )
    if not question:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Question not found')
    return question


def create_question(db: Session, *, payload: dict, actor_user_id: UUID) -> AssessmentQuestion:
    category_id = payload.get('category_id')
    if category_id:
        category = db.scalar(select(AssessmentCategory).where(AssessmentCategory.id == category_id))
        if not category:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Category not found')

    question = AssessmentQuestion(
        prompt=payload['prompt'],
        question_type=payload['question_type'],
        difficulty=payload.get('difficulty'),
        category_id=category_id,
        tags=payload.get('tags', []),
        status=payload.get('status', 'draft'),
        explanation=payload.get('explanation'),
        created_by=actor_user_id,
        updated_by=actor_user_id,
    )
    db.add(question)
    db.flush()

    for option in payload.get('options', []):
        db.add(
            AssessmentQuestionOption(
                question_id=question.id,
                option_text=option['option_text'],
                is_correct=bool(option.get('is_correct', False)),
                order_index=option.get('order_index', 0),
                created_by=actor_user_id,
                updated_by=actor_user_id,
            )
        )

    db.flush()
    return get_question(db, question.id)


def update_question(db: Session, *, question_id: UUID, payload: dict, actor_user_id: UUID) -> AssessmentQuestion:
    question = get_question(db, question_id)
    for field in ['prompt', 'question_type', 'difficulty', 'tags', 'status', 'explanation']:
        if field in payload and payload[field] is not None:
            setattr(question, field, payload[field])
    if 'category_id' in payload:
        category_id = payload.get('category_id')
        if category_id:
            category = db.scalar(select(AssessmentCategory).where(AssessmentCategory.id == category_id))
            if not category:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Category not found')
        question.category_id = category_id
    question.updated_by = actor_user_id

    if 'options' in payload and payload['options'] is not None:
        question.options.clear()
        db.flush()
        for option in payload['options']:
            question.options.append(
                AssessmentQuestionOption(
                    question_id=question.id,
                    option_text=option['option_text'],
                    is_correct=bool(option.get('is_correct', False)),
                    order_index=option.get('order_index', 0),
                    created_by=actor_user_id,
                    updated_by=actor_user_id,
                )
            )

    db.flush()
    return get_question(db, question.id)


def list_tests(
    db: Session,
    *,
    page: int,
    page_size: int,
    status_filter: str | None,
) -> tuple[list[AssessmentTest], int]:
    base = select(AssessmentTest).options(joinedload(AssessmentTest.versions).joinedload(AssessmentTestVersion.questions))
    if status_filter:
        base = base.where(AssessmentTest.status == status_filter)
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    items = (
        db.scalars(base.order_by(AssessmentTest.created_at.desc()).offset((page - 1) * page_size).limit(page_size))
        .unique()
        .all()
    )
    return items, int(total or 0)


def get_test(db: Session, test_id: UUID) -> AssessmentTest:
    test = db.scalar(
        select(AssessmentTest)
        .where(AssessmentTest.id == test_id)
        .options(joinedload(AssessmentTest.versions).joinedload(AssessmentTestVersion.questions))
    )
    if not test:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Test not found')
    return test


def create_test(db: Session, *, payload: dict, actor_user_id: UUID) -> AssessmentTest:
    test = AssessmentTest(
        title=payload['title'],
        description=payload.get('description'),
        category=payload.get('category'),
        role_target=payload.get('role_target'),
        status='draft',
        is_active=True,
        created_by=actor_user_id,
        updated_by=actor_user_id,
    )
    db.add(test)
    db.flush()

    version = AssessmentTestVersion(
        test_id=test.id,
        version_number=1,
        status='draft',
        passing_score=payload.get('passing_score', 80) if isinstance(payload, dict) else 80,
        time_limit_minutes=None,
        shuffle_questions=False,
        attempts_allowed=None,
        created_by=actor_user_id,
        updated_by=actor_user_id,
    )
    db.add(version)
    db.flush()
    return get_test(db, test.id)


def create_test_version(db: Session, *, test_id: UUID, actor_user_id: UUID) -> AssessmentTestVersion:
    test = get_test(db, test_id)
    latest = max(test.versions, key=lambda v: v.version_number, default=None)
    next_version_number = (latest.version_number + 1) if latest else 1

    new_version = AssessmentTestVersion(
        test_id=test.id,
        version_number=next_version_number,
        status='draft',
        passing_score=latest.passing_score if latest else 80,
        time_limit_minutes=latest.time_limit_minutes if latest else None,
        shuffle_questions=latest.shuffle_questions if latest else False,
        attempts_allowed=latest.attempts_allowed if latest else None,
        created_by=actor_user_id,
        updated_by=actor_user_id,
    )
    db.add(new_version)
    db.flush()

    if latest:
        for item in latest.questions:
            db.add(
                AssessmentTestVersionQuestion(
                    test_version_id=new_version.id,
                    question_id=item.question_id,
                    order_index=item.order_index,
                    points=item.points,
                    question_snapshot=item.question_snapshot,
                    created_by=actor_user_id,
                    updated_by=actor_user_id,
                )
            )
        db.flush()

    return new_version


def _snapshot_question(question: AssessmentQuestion) -> dict[str, Any]:
    return {
        'prompt': question.prompt,
        'question_type': question.question_type,
        'difficulty': question.difficulty,
        'tags': question.tags,
        'explanation': question.explanation,
        'options': [
            {'key': str(option.id), 'text': option.option_text, 'is_correct': option.is_correct}
            for option in sorted(question.options, key=lambda item: item.order_index)
        ],
    }


def get_test_version(db: Session, version_id: UUID) -> AssessmentTestVersion:
    version = db.scalar(
        select(AssessmentTestVersion)
        .where(AssessmentTestVersion.id == version_id)
        .options(joinedload(AssessmentTestVersion.questions))
    )
    if not version:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Test version not found')
    return version


def update_test_version(
    db: Session,
    *,
    version_id: UUID,
    payload: dict,
    actor_user_id: UUID,
) -> AssessmentTestVersion:
    version = get_test_version(db, version_id)
    if version.status != 'draft':
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Only draft versions can be updated')

    for field in ['passing_score', 'time_limit_minutes', 'shuffle_questions', 'attempts_allowed']:
        if field in payload and payload[field] is not None:
            setattr(version, field, payload[field])
    version.updated_by = actor_user_id

    if 'questions' in payload and payload['questions'] is not None:
        version.questions.clear()
        db.flush()
        for item in payload['questions']:
            question = get_question(db, item['question_id'])
            version.questions.append(
                AssessmentTestVersionQuestion(
                    test_version_id=version.id,
                    question_id=question.id,
                    order_index=item.get('order_index', 0),
                    points=item.get('points', 1),
                    question_snapshot=_snapshot_question(question),
                    created_by=actor_user_id,
                    updated_by=actor_user_id,
                )
            )
        db.flush()

    return get_test_version(db, version.id)


def publish_test_version(db: Session, *, version_id: UUID, actor_user_id: UUID) -> AssessmentTestVersion:
    version = get_test_version(db, version_id)
    if version.status == 'published':
        return version
    version.status = 'published'
    version.published_at = datetime.now(UTC)
    version.updated_by = actor_user_id
    test = db.scalar(select(AssessmentTest).where(AssessmentTest.id == version.test_id))
    if test:
        test.status = 'published'
        test.updated_by = actor_user_id
    db.flush()
    return get_test_version(db, version.id)


def get_published_test_version(db: Session, *, test_id: UUID) -> AssessmentTestVersion:
    version = db.scalar(
        select(AssessmentTestVersion)
        .where(AssessmentTestVersion.test_id == test_id, AssessmentTestVersion.status == 'published')
        .order_by(AssessmentTestVersion.version_number.desc())
    )
    if not version:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='No published test version found')
    return get_test_version(db, version.id)


def create_delivery(db: Session, *, payload: dict, actor_user_id: UUID) -> AssessmentDelivery:
    title = payload.get('title')
    if not title:
        test_version = get_test_version(db, payload['test_version_id'])
        test = db.scalar(select(AssessmentTest).where(AssessmentTest.id == test_version.test_id))
        title = test.title if test else 'Assessment delivery'

    delivery = AssessmentDelivery(
        test_version_id=payload['test_version_id'],
        title=title,
        audience_type=payload.get('audience_type', 'assignment'),
        source_assignment_id=payload.get('source_assignment_id'),
        source_assignment_task_id=payload.get('source_assignment_task_id'),
        participant_user_id=payload.get('participant_user_id'),
        starts_at=payload.get('starts_at'),
        ends_at=payload.get('ends_at'),
        attempts_allowed=payload.get('attempts_allowed', 1),
        duration_minutes=payload.get('duration_minutes'),
        due_date=payload.get('due_date'),
        created_by=actor_user_id,
        updated_by=actor_user_id,
    )
    db.add(delivery)
    db.flush()
    return delivery


def list_deliveries(
    db: Session,
    *,
    page: int,
    page_size: int,
    participant_user_id: UUID | None,
    test_version_id: UUID | None,
) -> tuple[list[AssessmentDelivery], int]:
    base = select(AssessmentDelivery)
    if participant_user_id:
        base = base.where(AssessmentDelivery.participant_user_id == participant_user_id)
    if test_version_id:
        base = base.where(AssessmentDelivery.test_version_id == test_version_id)
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    items = (
        db.scalars(base.order_by(AssessmentDelivery.created_at.desc()).offset((page - 1) * page_size).limit(page_size))
        .unique()
        .all()
    )
    return items, int(total or 0)


def get_delivery(db: Session, delivery_id: UUID) -> AssessmentDelivery:
    delivery = db.scalar(select(AssessmentDelivery).where(AssessmentDelivery.id == delivery_id))
    if not delivery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Delivery not found')
    return delivery


def _build_attempt_questions(
    version: AssessmentTestVersion, question_order: list[str]
) -> list[dict[str, Any]]:
    by_id = {str(item.id): item for item in version.questions}
    ordered = [by_id[qid] for qid in question_order if qid in by_id]
    payload = []
    for idx, item in enumerate(ordered):
        snapshot = dict(item.question_snapshot or {})
        options = snapshot.get('options', [])
        payload.append(
            {
                'index': idx,
                'prompt': snapshot.get('prompt', ''),
                'question_type': snapshot.get('question_type', 'mcq_single'),
                'points': item.points,
                'options': [{'key': opt.get('key'), 'text': opt.get('text')} for opt in options],
            }
        )
    return payload


def start_attempt(db: Session, *, delivery_id: UUID, user_id: UUID) -> AssessmentAttempt:
    delivery = get_delivery(db, delivery_id)
    if delivery.participant_user_id and delivery.participant_user_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Not assigned to this delivery')
    now = datetime.now(UTC)
    if delivery.starts_at and now < delivery.starts_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Assessment not started yet')
    if delivery.ends_at and now > delivery.ends_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Assessment window ended')

    existing = db.scalar(
        select(AssessmentAttempt)
        .where(
            AssessmentAttempt.delivery_id == delivery.id,
            AssessmentAttempt.user_id == user_id,
            AssessmentAttempt.status == 'in_progress',
        )
        .order_by(AssessmentAttempt.started_at.desc())
    )
    if existing:
        return existing

    attempt_count = int(
        db.scalar(
            select(func.count())
            .select_from(AssessmentAttempt)
            .where(AssessmentAttempt.delivery_id == delivery.id, AssessmentAttempt.user_id == user_id)
        )
        or 0
    )
    if delivery.attempts_allowed is not None and attempt_count >= delivery.attempts_allowed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='No remaining attempts')

    version = get_test_version(db, delivery.test_version_id)
    ordered_questions = [str(item.id) for item in sorted(version.questions, key=lambda q: q.order_index)]
    if version.shuffle_questions:
        import random

        random.shuffle(ordered_questions)

    expires_at = None
    if delivery.duration_minutes:
        expires_at = now + timedelta(minutes=delivery.duration_minutes)
    elif delivery.ends_at:
        expires_at = delivery.ends_at

    attempt = AssessmentAttempt(
        delivery_id=delivery.id,
        user_id=user_id,
        attempt_number=attempt_count + 1,
        status='in_progress',
        started_at=now,
        expires_at=expires_at,
        question_order=ordered_questions,
        created_by=user_id,
        updated_by=user_id,
    )
    db.add(attempt)
    db.flush()
    return attempt


def autosave_answers(
    db: Session,
    *,
    attempt_id: UUID,
    answers: list[dict[str, Any]],
    actor_user_id: UUID,
) -> None:
    attempt = db.scalar(select(AssessmentAttempt).where(AssessmentAttempt.id == attempt_id))
    if not attempt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Attempt not found')
    if attempt.status != 'in_progress':
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Attempt is not editable')

    for answer in answers:
        existing = db.scalar(
            select(AssessmentAttemptAnswer).where(
                AssessmentAttemptAnswer.attempt_id == attempt.id,
                AssessmentAttemptAnswer.question_index == answer['question_index'],
            )
        )
        if existing:
            existing.selected_option_keys = answer.get('selected_option_keys', [])
            existing.updated_by = actor_user_id
        else:
            db.add(
                AssessmentAttemptAnswer(
                    attempt_id=attempt.id,
                    question_index=answer['question_index'],
                    selected_option_keys=answer.get('selected_option_keys', []),
                    created_by=actor_user_id,
                    updated_by=actor_user_id,
                )
            )
    db.flush()


def submit_attempt(db: Session, *, attempt_id: UUID, actor_user_id: UUID) -> AssessmentAttempt:
    attempt = db.scalar(
        select(AssessmentAttempt)
        .where(AssessmentAttempt.id == attempt_id)
        .options(joinedload(AssessmentAttempt.answers))
    )
    if not attempt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Attempt not found')
    if attempt.status != 'in_progress':
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Attempt already submitted')

    delivery = get_delivery(db, attempt.delivery_id)
    now = datetime.now(UTC)
    if attempt.expires_at and now > attempt.expires_at:
        attempt.status = 'expired'
        attempt.updated_by = actor_user_id
        db.flush()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Attempt expired')
    version = get_test_version(db, delivery.test_version_id)
    questions_by_id = {str(item.id): item for item in version.questions}
    if attempt.question_order:
        ordered_questions = [questions_by_id[qid] for qid in attempt.question_order if qid in questions_by_id]
    else:
        ordered_questions = [item for item in sorted(version.questions, key=lambda q: q.order_index)]

    answers_by_index = {answer.question_index: answer for answer in attempt.answers}
    total_points = 0.0
    earned_points = 0.0
    correct_count = 0

    for idx, item in enumerate(ordered_questions):
        total_points += item.points
        answer = answers_by_index.get(idx)
        snapshot = dict(item.question_snapshot or {})
        correct_keys = {opt.get('key') for opt in snapshot.get('options', []) if opt.get('is_correct')}
        selected_keys = set(answer.selected_option_keys if answer else [])
        is_correct = bool(correct_keys) and selected_keys == correct_keys
        if answer:
            answer.is_correct = is_correct
            answer.updated_by = actor_user_id
        if is_correct:
            earned_points += item.points
            correct_count += 1

    if total_points <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Attempt has no questions to score')

    score_percent = (earned_points / total_points) * 100
    passed = score_percent >= float(version.passing_score or 0)

    attempt.score = earned_points
    attempt.max_score = total_points
    attempt.score_percent = score_percent
    attempt.passed = passed
    attempt.status = 'scored'
    attempt.submitted_at = datetime.now(UTC)
    attempt.updated_by = actor_user_id
    db.flush()

    if delivery.source_assignment_task_id:
        assignment_task = db.scalar(
            select(AssignmentTask).where(AssignmentTask.id == delivery.source_assignment_task_id)
        )
        if assignment_task:
            assignment_task.status = 'completed' if passed else 'revision_requested'
            assignment_task.progress_percent = 100.0 if passed else 60.0
            assignment_task.completed_at = datetime.now(UTC) if passed else None
            assignment_task.updated_by = actor_user_id
            # Local import to avoid circular dependency.
            from app.services import assignment_service

            assignment = assignment_service.get_assignment_by_id(db, assignment_task.assignment_id)
            assignment_service.refresh_overdue_and_status(db, assignment)
            assignment_service.recompute_progress(db, assignment)
            assignment_service.refresh_next_task(db, assignment)

    return attempt


def list_attempts(
    db: Session,
    *,
    delivery_id: UUID | None,
    user_id: UUID | None,
    test_id: UUID | None,
) -> list[AssessmentAttempt]:
    base = select(AssessmentAttempt)
    if delivery_id:
        base = base.where(AssessmentAttempt.delivery_id == delivery_id)
    if user_id:
        base = base.where(AssessmentAttempt.user_id == user_id)
    if test_id:
        delivery_ids = db.scalars(
            select(AssessmentDelivery.id)
            .join(AssessmentTestVersion, AssessmentDelivery.test_version_id == AssessmentTestVersion.id)
            .where(AssessmentTestVersion.test_id == test_id)
        ).all()
        if delivery_ids:
            base = base.where(AssessmentAttempt.delivery_id.in_(delivery_ids))
        else:
            return []
    return db.scalars(base.order_by(AssessmentAttempt.submitted_at.desc().nulls_last())).all()
