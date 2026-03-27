from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlparse, urlunparse
from uuid import UUID

# Use uvicorn.error so diagnostic output is guaranteed visible in journalctl
# even if the root logger is configured at WARNING level.
logger = logging.getLogger("uvicorn.error")

from fastapi import HTTPException, status
from sqlalchemy import cast, delete as sql_delete, func, or_, select, text, update
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.config import settings
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
from app.models.rbac import User
from app.models.tenant import Tenant
from app.services import email_service


def build_question_query(
    *,
    status_filters: list[str] | None,
    query: str | None,
    tags: list[str] | None,
    difficulties: list[str] | None,
    categories: list[str] | None,
    include_joins: bool,
    tenant_id: UUID | None = None,
):
    """Build a filtered SELECT on AssessmentQuestion.

    When include_joins=True the query is annotated with ORM eager-loading
    options.  We use:
      - selectinload  for the 1-to-many options relationship — this fires a
        *separate* SELECT … WHERE question_id IN (…) after the paged main
        query, so no JOIN is added here, avoiding row-multiplication and
        keeping LIMIT/OFFSET meaningful.
      - joinedload    for the many-to-one category relationship — a single
        extra row column per question, no explosion risk.

    When include_joins=False (used for COUNT queries) no loading annotations
    are added, so the generated SQL is a plain filtered SELECT with no JOINs.
    """
    base = select(AssessmentQuestion)
    if tenant_id is not None:
        # Explicit tenant isolation as defense-in-depth. This ensures we never
        # leak/operate on cross-tenant rows even if the DB role bypasses RLS.
        base = base.where(AssessmentQuestion.tenant_id == tenant_id)
    if include_joins:
        base = base.options(
            selectinload(AssessmentQuestion.options),   # avoids row explosion
            joinedload(AssessmentQuestion.category),    # safe: many-to-one
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
        category_ids_raw = [c for c in categories if c != 'unclassified']
        filters = []
        if category_ids_raw:
            # Frontend sends UUID strings; filter directly by category_id.
            try:
                category_uuids = [UUID(c) for c in category_ids_raw]
            except (ValueError, AttributeError):
                category_uuids = []
            if category_uuids:
                filters.append(AssessmentQuestion.category_id.in_(category_uuids))
        if include_unclassified:
            filters.append(AssessmentQuestion.category_id.is_(None))
        if filters:
            base = base.where(or_(*filters))

    return base


def list_questions(
    db: Session,
    *,
    tenant_id: UUID,
    page: int,
    page_size: int,
    status_filters: list[str] | None,
    query: str | None,
    tags: list[str] | None,
    difficulties: list[str] | None,
    categories: list[str] | None,
    sort_by: str | None = None,
) -> tuple[list[AssessmentQuestion], int]:
    filter_kwargs = dict(
        tenant_id=tenant_id,
        status_filters=status_filters,
        query=query,
        tags=tags,
        difficulties=difficulties,
        categories=categories,
    )

    # ── Diagnostic logging — remove once category filtering is confirmed stable ──
    logger.info(
        "list_questions params  | tenant_id=%s | page=%s page_size=%s status=%s difficulties=%s "
        "tags=%s categories=%s query=%r",
        tenant_id, page, page_size, status_filters, difficulties, tags, categories, query,
    )
    if categories:
        _slug_check = db.execute(
            select(AssessmentCategory.slug, AssessmentCategory.tenant_id, AssessmentCategory.id)
            .where(
                AssessmentCategory.slug.in_(categories),
                AssessmentCategory.tenant_id == tenant_id,
            )
        ).fetchall()
        logger.info("list_questions category slug lookup → %s", _slug_check)

    # COUNT — plain filtered query, no joins, no eager-loading overhead.
    count_q = build_question_query(**filter_kwargs, include_joins=False)
    total = db.scalar(select(func.count()).select_from(count_q.subquery()))
    logger.info("list_questions total=%s", total)

    # ITEMS — selectinload for options fires a second query after the paged
    # main query; LIMIT/OFFSET here apply to distinct question rows only.
    items_q = build_question_query(**filter_kwargs, include_joins=True)
    if sort_by == 'prompt_asc':
        items_q = items_q.order_by(AssessmentQuestion.prompt.asc())
    elif sort_by == 'prompt_desc':
        items_q = items_q.order_by(AssessmentQuestion.prompt.desc())
    elif sort_by == 'updated_desc':
        items_q = items_q.order_by(AssessmentQuestion.updated_at.desc())
    else:
        items_q = items_q.order_by(AssessmentQuestion.created_at.desc())

    try:
        from sqlalchemy.dialects import postgresql as pg_dialect
        _dialect = pg_dialect.dialect()
        _compiled = items_q.compile(dialect=_dialect, compile_kwargs={"literal_binds": True})
        logger.info("list_questions SQL:\n%s", str(_compiled))
    except Exception as _log_err:
        logger.debug("list_questions: could not render SQL with literal binds: %s", _log_err)

    items = (
        db.scalars(items_q.offset((page - 1) * page_size).limit(page_size))
        .unique()
        .all()
    )
    return items, int(total or 0)


def question_stats(
    db: Session,
    *,
    tenant_id: UUID,
    status_filters: list[str] | None,
    query: str | None,
    tags: list[str] | None,
    difficulties: list[str] | None,
    categories: list[str] | None,
) -> dict[str, object]:
    base = build_question_query(
        tenant_id=tenant_id,
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
        select(base.c.category_id, func.count())
        .select_from(base)
        .group_by(base.c.category_id)
    ).all()
    by_category: dict[str, int] = {'unclassified': 0}
    for cat_id, cnt in cat_rows:
        if cat_id is None:
            by_category['unclassified'] = int(cnt or 0)
        else:
            by_category[str(cat_id)] = int(cnt or 0)

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

    # Build the WHERE predicate once — never load IDs into Python for set-based actions.
    # For 'selected' scope: filter by the provided UUID list.
    # For 'all_matching' scope: use a subquery so the DB does all the work in one statement.
    def _id_predicate():
        if scope == 'selected':
            ids = list(question_ids or [])
            if not ids:
                return None, 0
            return AssessmentQuestion.id.in_(ids), len(ids)

        # all_matching — count first so we can return early if 0 rows match.
        base = build_question_query(
            status_filters=status_filters,
            query=query,
            tags=tags,
            difficulties=difficulties,
            categories=categories,
            include_joins=False,
        )
        sub = base.subquery()
        count = int(db.scalar(select(func.count()).select_from(sub)) or 0)
        if count == 0:
            return None, 0
        return AssessmentQuestion.id.in_(select(sub.c.id)), count

    predicate, estimated_count = _id_predicate()
    if predicate is None:
        return 0

    # ── set_status ────────────────────────────────────────────────────────────
    if action == 'set_status':
        if status_value not in ('draft', 'published', 'archived'):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid status_value')
        result = db.execute(
            update(AssessmentQuestion)
            .where(predicate)
            .values(status=status_value, updated_by=actor_user_id)
        )
        db.flush()
        return result.rowcount

    # ── set_category ──────────────────────────────────────────────────────────
    if action == 'set_category':
        if category_id is not None:
            if not db.scalar(select(AssessmentCategory.id).where(AssessmentCategory.id == category_id)):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Category not found')
        result = db.execute(
            update(AssessmentQuestion)
            .where(predicate)
            .values(category_id=category_id, updated_by=actor_user_id)
        )
        db.flush()
        return result.rowcount

    # ── set_difficulty ────────────────────────────────────────────────────────
    if action == 'set_difficulty':
        if difficulty_value is not None and difficulty_value not in ('easy', 'medium', 'hard'):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid difficulty_value')
        result = db.execute(
            update(AssessmentQuestion)
            .where(predicate)
            .values(difficulty=difficulty_value, updated_by=actor_user_id)
        )
        db.flush()
        return result.rowcount

    # ── tag operations (JSONB — still fetched in Python but with a single SELECT) ──
    normalized_tags = [t.strip() for t in (tags_value or []) if t and t.strip()]
    seen: set[str] = set()
    normalized_tags = [t for t in normalized_tags if not (t in seen or seen.add(t))]  # type: ignore[func-returns-value]

    if action in ('add_tags', 'remove_tags', 'replace_tags'):
        rows = db.scalars(select(AssessmentQuestion).where(predicate)).all()
        for q in rows:
            current = list(q.tags or [])
            if action == 'replace_tags':
                q.tags = normalized_tags
            elif action == 'add_tags':
                q.tags = current + [t for t in normalized_tags if t not in current]
            else:  # remove_tags
                q.tags = [t for t in current if t not in set(normalized_tags)]
            q.updated_by = actor_user_id
        db.flush()
        return len(rows)

    # ── delete_permanently ────────────────────────────────────────────────────
    # Single SQL DELETE — Postgres cascades to question_options and
    # classification_job_items automatically (both FK'd with ON DELETE CASCADE).
    # test_version_questions uses ON DELETE SET NULL so those references become NULL.
    if action == 'delete_permanently':
        result = db.execute(sql_delete(AssessmentQuestion).where(predicate))
        db.flush()
        return result.rowcount

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid action')


def _tenant_id_expr():
    """SQLAlchemy expression for the current session's tenant UUID."""
    return cast(func.current_setting('app.tenant_id'), PG_UUID(as_uuid=True))


def list_categories(db: Session) -> list[AssessmentCategory]:
    return db.scalars(
        select(AssessmentCategory)
        .where(AssessmentCategory.tenant_id == _tenant_id_expr())
        .order_by(AssessmentCategory.name.asc())
    ).all()


def get_category(db: Session, category_id: UUID) -> AssessmentCategory:
    # Filter by both id AND the current session tenant so we never return
    # a row that belongs to a different tenant (which would cause the composite
    # FK on assessment_questions(tenant_id, category_id) to fail on merge/delete).
    cat = db.scalar(
        select(AssessmentCategory)
        .where(
            AssessmentCategory.id == category_id,
            AssessmentCategory.tenant_id == _tenant_id_expr(),
        )
    )
    if cat is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail='Category not found')
    return cat


def category_question_counts(db: Session) -> dict[str, int]:
    """Return a mapping of category_id (str) → question count."""
    rows = db.execute(
        select(AssessmentQuestion.category_id, func.count(AssessmentQuestion.id))
        .where(
            AssessmentQuestion.tenant_id == _tenant_id_expr(),
            AssessmentQuestion.category_id.isnot(None),
        )
        .group_by(AssessmentQuestion.category_id)
    ).all()
    return {str(r[0]): r[1] for r in rows}


def _slugify(text: str) -> str:
    """Convert a human-readable name into a URL-safe slug."""
    import re as _re
    text = text.strip().lower()
    text = _re.sub(r'[^\w\s-]', '', text)
    text = _re.sub(r'[\s_]+', '-', text)
    text = _re.sub(r'-{2,}', '-', text)
    return text.strip('-')[:80] or 'unnamed'


def find_or_create_category_path(db: Session, path: str) -> UUID:
    """Resolve a human-readable path like 'School/History/8th Grade' into a category UUID.

    Each level is separated by '/'.  Each level is matched by slug AND parent_id so
    that identically-named categories at different depths are treated as separate nodes.
    Missing levels are created automatically.  Returns the leaf category's UUID.
    """
    parts = [p.strip() for p in path.split('/') if p.strip()]
    if not parts:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Empty category path')

    parent_id: UUID | None = None
    leaf_id: UUID | None = None
    for part in parts:
        slug = _slugify(part)
        # Match slug AND parent_id so "8th Grade" under "History" is distinct from
        # "8th Grade" directly under "School".
        existing = db.scalar(
            select(AssessmentCategory).where(
                AssessmentCategory.tenant_id == _tenant_id_expr(),
                AssessmentCategory.slug == slug,
                AssessmentCategory.parent_id == parent_id,
            )
        )
        if existing:
            leaf_id = existing.id
            parent_id = existing.id
        else:
            cat = AssessmentCategory(name=part, slug=slug, parent_id=parent_id)
            db.add(cat)
            db.flush()
            leaf_id = cat.id
            parent_id = cat.id

    return leaf_id  # type: ignore[return-value]


def create_category(db: Session, name: str, slug: str, parent_id: UUID | None) -> AssessmentCategory:
    existing = db.scalar(
        select(AssessmentCategory).where(
            AssessmentCategory.tenant_id == _tenant_id_expr(),
            AssessmentCategory.slug == slug,
        )
    )
    if existing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Slug '{slug}' already exists")
    if parent_id is not None:
        get_category(db, parent_id)  # validates parent exists
    cat = AssessmentCategory(name=name, slug=slug, parent_id=parent_id)
    db.add(cat)
    db.flush()
    return cat


def update_category(db: Session, category_id: UUID, data: dict) -> AssessmentCategory:
    cat = get_category(db, category_id)
    if 'slug' in data and data['slug'] != cat.slug:
        existing = db.scalar(
            select(AssessmentCategory).where(
                AssessmentCategory.tenant_id == _tenant_id_expr(),
                AssessmentCategory.slug == data['slug'],
            )
        )
        if existing:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Slug '{data['slug']}' already exists")
    if 'parent_id' in data and data['parent_id'] is not None:
        if data['parent_id'] == category_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail='A category cannot be its own parent')
        get_category(db, data['parent_id'])  # validates parent exists
    for key, value in data.items():
        setattr(cat, key, value)
    db.flush()
    return cat


def delete_category(db: Session, category_id: UUID) -> None:
    cat = get_category(db, category_id)
    parent_id = cat.parent_id
    db.flush()

    # Promote children to cat's parent — raw text() bypasses ORM self-referential
    # relationship processing and is scoped to the current tenant implicitly via RLS.
    if parent_id is not None:
        db.execute(
            text("""UPDATE assessment_categories
                       SET parent_id = :parent, updated_at = now()
                     WHERE parent_id = :cat
                       AND tenant_id = current_setting('app.tenant_id')::uuid"""),
            {'parent': str(parent_id), 'cat': str(category_id)},
        )
    else:
        db.execute(
            text("""UPDATE assessment_categories
                       SET parent_id = NULL, updated_at = now()
                     WHERE parent_id = :cat
                       AND tenant_id = current_setting('app.tenant_id')::uuid"""),
            {'cat': str(category_id)},
        )

    # Unlink questions (NULL is always valid for the composite FK)
    db.execute(
        text("""UPDATE assessment_questions
                   SET category_id = NULL, updated_at = now()
                 WHERE category_id = :cat
                   AND tenant_id = current_setting('app.tenant_id')::uuid"""),
        {'cat': str(category_id)},
    )

    db.expire(cat)  # ensure stale in-memory children list is not re-processed
    cat = get_category(db, category_id)
    db.delete(cat)
    db.flush()


def merge_categories(db: Session, source_id: UUID, target_id: UUID) -> None:
    """Move all questions and children from source into target, then delete source.

    Both get_category calls filter by the current session tenant, so if a user
    picks a category that visually looks like a duplicate but actually belongs to
    a different tenant, the call raises 404 before we ever touch any rows.
    """
    if source_id == target_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail='Source and target must be different')

    source = get_category(db, source_id)
    target = get_category(db, target_id)

    # Belt-and-suspenders: both rows must share the same tenant_id so that the
    # composite FK  assessment_questions(tenant_id, category_id) is satisfied.
    if source.tenant_id != target.tenant_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail='Cannot merge categories that belong to different tenants',
        )

    db.flush()

    # Reassign child categories — raw text() avoids ORM self-referential cascade
    db.execute(
        text("""UPDATE assessment_categories
                   SET parent_id = :target, updated_at = now()
                 WHERE parent_id = :source
                   AND tenant_id = current_setting('app.tenant_id')::uuid"""),
        {'target': str(target.id), 'source': str(source_id)},
    )

    # Move questions — the composite FK is satisfied because target.tenant_id ==
    # source.tenant_id (verified above) and target.id exists for that tenant.
    db.execute(
        text("""UPDATE assessment_questions
                   SET category_id = :target, updated_at = now()
                 WHERE category_id = :source
                   AND tenant_id = current_setting('app.tenant_id')::uuid"""),
        {'target': str(target.id), 'source': str(source_id)},
    )

    db.expire(source)  # ensure stale children list is not re-processed on delete
    source = get_category(db, source_id)
    db.delete(source)
    db.flush()


def get_question(db: Session, question_id: UUID, *, tenant_id: UUID | None = None) -> AssessmentQuestion:
    stmt = (
        select(AssessmentQuestion)
        .where(AssessmentQuestion.id == question_id)
        .options(joinedload(AssessmentQuestion.options))
    )
    if tenant_id is not None:
        stmt = stmt.where(AssessmentQuestion.tenant_id == tenant_id)
    question = db.scalar(stmt)
    if not question:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Question not found')
    return question


def _load_questions_for_version(
    db: Session,
    question_ids: list[UUID],
    effective_tenant_id: UUID,
) -> dict[str, AssessmentQuestion]:
    """Bulk-load questions (and options) for version updates."""
    if not question_ids:
        return {}
    rows = db.scalars(
        select(AssessmentQuestion)
        .where(
            AssessmentQuestion.id.in_(question_ids),
            AssessmentQuestion.tenant_id == effective_tenant_id,
        )
        .options(selectinload(AssessmentQuestion.options))
    ).all()
    by_id = {str(q.id): q for q in rows}
    missing = [str(qid) for qid in question_ids if str(qid) not in by_id]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f'Question {missing[0]} not found for tenant {effective_tenant_id}',
        )
    return by_id


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
    existing_drafts = [v for v in test.versions if v.status == 'draft']
    if existing_drafts:
        # Enforce single-draft rule: return the most recent draft instead of creating another.
        return max(existing_drafts, key=lambda v: v.updated_at or v.created_at)
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


def list_test_versions(
    db: Session,
    *,
    test_id: UUID,
    include_archived: bool,
) -> list[dict[str, object]]:
    deliveries_subq = (
        select(
            AssessmentDelivery.test_version_id.label('version_id'),
            func.count(AssessmentDelivery.id).label('deliveries_count'),
        )
        .group_by(AssessmentDelivery.test_version_id)
        .subquery()
    )

    stmt = (
        select(
            AssessmentTestVersion,
            deliveries_subq.c.deliveries_count,
            User.full_name,
            User.email,
        )
        .outerjoin(deliveries_subq, deliveries_subq.c.version_id == AssessmentTestVersion.id)
        .outerjoin(User, User.id == AssessmentTestVersion.created_by)
        .where(AssessmentTestVersion.test_id == test_id)
        .order_by(AssessmentTestVersion.version_number.desc())
    )
    if not include_archived:
        stmt = stmt.where(AssessmentTestVersion.status != 'archived')

    rows = db.execute(stmt).all()
    items: list[dict[str, object]] = []
    for version, deliveries_count, creator_name, creator_email in rows:
        items.append({
            'id': version.id,
            'test_id': version.test_id,
            'version_number': version.version_number,
            'status': version.status,
            'passing_score': version.passing_score,
            'time_limit_minutes': version.time_limit_minutes,
            'shuffle_questions': version.shuffle_questions,
            'attempts_allowed': version.attempts_allowed,
            'published_at': version.published_at,
            'created_at': version.created_at,
            'updated_at': version.updated_at,
            'created_by': version.created_by,
            'created_by_name': creator_name,
            'created_by_email': creator_email,
            'deliveries_count': int(deliveries_count or 0),
        })
    return items


def set_test_version_archived(
    db: Session,
    *,
    version_id: UUID,
    actor_user_id: UUID,
    archived: bool,
) -> AssessmentTestVersion:
    version = get_test_version(db, version_id)
    if version.status == 'draft':
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Draft versions cannot be archived')

    if archived:
        if version.status == 'archived':
            return version
        version.status = 'archived'
    else:
        if version.status != 'archived':
            return version
        version.status = 'published'

    version.updated_by = actor_user_id
    db.flush()
    return version


def delete_test_version(
    db: Session,
    *,
    version_id: UUID,
) -> None:
    version = get_test_version(db, version_id)
    deliveries_count = db.scalar(
        select(func.count(AssessmentDelivery.id)).where(AssessmentDelivery.test_version_id == version.id)
    )
    if int(deliveries_count or 0) > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail='Cannot delete a version that has deliveries',
        )
    db.delete(version)
    db.flush()


def prune_test_versions(
    db: Session,
    *,
    test_id: UUID,
    keep_published: int = 3,
    draft_retention_days: int = 30,
) -> None:
    cutoff = datetime.now(UTC) - timedelta(days=draft_retention_days)

    # Auto-delete stale drafts (unused only)
    stale_drafts = db.scalars(
        select(AssessmentTestVersion)
        .where(
            AssessmentTestVersion.test_id == test_id,
            AssessmentTestVersion.status == 'draft',
            AssessmentTestVersion.updated_at < cutoff,
        )
        .order_by(AssessmentTestVersion.updated_at.asc())
    ).all()
    for draft in stale_drafts:
        deliveries_count = db.scalar(
            select(func.count(AssessmentDelivery.id)).where(AssessmentDelivery.test_version_id == draft.id)
        )
        if int(deliveries_count or 0) == 0:
            db.delete(draft)

    # Keep last N published versions (unless referenced by deliveries)
    published = db.scalars(
        select(AssessmentTestVersion)
        .where(
            AssessmentTestVersion.test_id == test_id,
            AssessmentTestVersion.status == 'published',
        )
        .order_by(
            AssessmentTestVersion.published_at.desc().nullslast(),
            AssessmentTestVersion.version_number.desc(),
        )
    ).all()
    for old in published[keep_published:]:
        deliveries_count = db.scalar(
            select(func.count(AssessmentDelivery.id)).where(AssessmentDelivery.test_version_id == old.id)
        )
        if int(deliveries_count or 0) == 0:
            db.delete(old)


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
    tenant_id: UUID | None = None,
    load_questions: bool = True,
) -> AssessmentTestVersion:
    version = get_test_version(db, version_id)
    if version.status != 'draft':
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Only draft versions can be updated')

    effective_tenant_id = tenant_id or version.tenant_id

    for field in ['passing_score', 'time_limit_minutes', 'shuffle_questions', 'attempts_allowed']:
        if field in payload:
            setattr(version, field, payload[field])
    version.updated_by = actor_user_id

    if 'questions' in payload and payload['questions'] is not None:
        q_items = payload['questions']
        q_ids = [item['question_id'] for item in q_items if item.get('question_id')]
        question_map = _load_questions_for_version(db, q_ids, effective_tenant_id)

        version.questions.clear()
        db.flush()
        for item in q_items:
            question = question_map[str(item['question_id'])]
            version.questions.append(
                AssessmentTestVersionQuestion(
                    tenant_id=effective_tenant_id,
                    test_version_id=version.id,
                    question_id=question.id,
                    order_index=item.get('order_index', 0),
                    points=item.get('points', 1),
                    section=item.get('section') or None,
                    question_snapshot=_snapshot_question(question),
                    created_by=actor_user_id,
                    updated_by=actor_user_id,
                )
            )
        db.flush()

    return get_test_version(db, version.id) if load_questions else version


def publish_test_version(
    db: Session,
    *,
    version_id: UUID,
    actor_user_id: UUID,
    load_questions: bool = True,
) -> AssessmentTestVersion:
    version = get_test_version(db, version_id)
    if version.status == 'published':
        return version
    if not version.questions:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail='Cannot publish a version with no questions')
    version.status = 'published'
    version.published_at = datetime.now(UTC)
    version.updated_by = actor_user_id
    test = db.scalar(select(AssessmentTest).where(AssessmentTest.id == version.test_id))
    if test:
        test.status = 'published'
        test.updated_by = actor_user_id
    db.flush()

    # Retention rules: keep last N published + prune stale drafts
    prune_test_versions(db, test_id=version.test_id)

    return get_test_version(db, version.id) if load_questions else version


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


def send_delivery_assignment_email(
    db: Session,
    *,
    delivery_id: UUID,
    actor_user_id: UUID | None = None,
) -> None:
    delivery = db.scalar(select(AssessmentDelivery).where(AssessmentDelivery.id == delivery_id))
    if not delivery:
        return
    if delivery.audience_type != 'assignment' or not delivery.participant_user_id:
        return

    participant = db.scalar(select(User).where(User.id == delivery.participant_user_id))
    if not participant or not participant.email:
        return

    tenant = db.scalar(select(Tenant).where(Tenant.id == delivery.tenant_id))
    tenant_name = tenant.name if tenant else 'SolveBox'

    assigned_by = None
    if actor_user_id:
        actor = db.scalar(select(User).where(User.id == actor_user_id))
        if actor:
            assigned_by = (actor.full_name or actor.email or '').strip() or None

    # Build a tenant-scoped URL so the middleware can resolve the tenant from the subdomain.
    # e.g. http://localtest.me:3001 → http://acme.localtest.me:3001/assessments/take/{id}
    _base = settings.FRONTEND_BASE_URL.rstrip('/')
    if tenant and tenant.slug:
        _parsed = urlparse(_base)
        _netloc = f'{tenant.slug}.{_parsed.netloc}'
        _base = urlunparse(_parsed._replace(netloc=_netloc))
    delivery_url = _base + f'/assessments/take/{delivery.id}'

    email_service.send_assessment_assigned(
        to_email=participant.email,
        to_name=participant.full_name or '',
        tenant_name=tenant_name,
        test_title=delivery.title,
        delivery_url=delivery_url,
        due_date=delivery.due_date,
        attempts_allowed=delivery.attempts_allowed,
        duration_minutes=delivery.duration_minutes,
        assigned_by=assigned_by,
    )


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


def submit_attempt(
    db: Session, *, attempt_id: UUID, actor_user_id: UUID
) -> tuple['AssessmentAttempt', list]:
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

    # Per-section accumulators: {section_name: {earned, total, correct, total_questions}}
    section_acc: dict[str, dict[str, float]] = {}

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

        section = item.section or 'General'
        if section not in section_acc:
            section_acc[section] = {'earned': 0.0, 'total': 0.0, 'correct': 0, 'total_questions': 0}
        section_acc[section]['total'] += item.points
        section_acc[section]['total_questions'] += 1
        if is_correct:
            section_acc[section]['earned'] += item.points
            section_acc[section]['correct'] += 1

    if total_points <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Attempt has no questions to score')

    score_percent = (earned_points / total_points) * 100
    passed = score_percent >= float(version.passing_score or 0)

    section_scores = {
        sec: {
            'earned': acc['earned'],
            'total': acc['total'],
            'percent': round(acc['earned'] / acc['total'] * 100, 1) if acc['total'] > 0 else 0.0,
            'correct': int(acc['correct']),
            'total_questions': int(acc['total_questions']),
        }
        for sec, acc in section_acc.items()
    }

    attempt.score = earned_points
    attempt.max_score = total_points
    attempt.score_percent = score_percent
    attempt.passed = passed
    attempt.section_scores = section_scores
    attempt.status = 'scored'
    attempt.submitted_at = datetime.now(UTC)
    attempt.updated_by = actor_user_id

    # ── Award stars ───────────────────────────────────────────────────────────
    from app.services import star_service

    stars = star_service.compute_stars(score_percent)
    attempt.stars_earned = stars

    _tenant_id = delivery.tenant_id if delivery else None

    _membership = None
    if _tenant_id:
        _membership = star_service.award_stars(
            db, user_id=attempt.user_id, tenant_id=_tenant_id, stars=stars
        )

    db.flush()

    # ── Check achievements ────────────────────────────────────────────────────
    new_achievements: list = []
    if _tenant_id and _membership:
        new_achievements = star_service.check_and_unlock_achievements(
            db,
            user_id=attempt.user_id,
            tenant_id=_tenant_id,
            attempt=attempt,
            total_stars=_membership.total_stars,
            tests_completed=_membership.tests_completed,
        )

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

    return attempt, new_achievements


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


def get_attempt_review(
    db: Session,
    *,
    attempt_id: UUID,
    requesting_user_id: UUID,
    is_admin: bool,
    tenant_id: UUID,
) -> dict:
    """Return per-question review data for a scored attempt (reveals correct answers)."""
    attempt = db.scalar(
        select(AssessmentAttempt)
        .where(
            AssessmentAttempt.id == attempt_id,
            AssessmentAttempt.tenant_id == tenant_id,  # tenant isolation
        )
        .options(joinedload(AssessmentAttempt.answers))
    )
    if not attempt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Attempt not found')

    # Only the attempt owner or admins may view the review
    if not is_admin and attempt.user_id != requesting_user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Not allowed to view this review')

    # Attempt must be scored (or submitted – still show what we have)
    if attempt.status == 'in_progress':
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Attempt is still in progress',
        )

    delivery = get_delivery(db, attempt.delivery_id)
    version = get_test_version(db, delivery.test_version_id)

    questions_by_id = {str(item.id): item for item in version.questions}
    if attempt.question_order:
        ordered_items = [questions_by_id[qid] for qid in attempt.question_order if qid in questions_by_id]
    else:
        ordered_items = sorted(version.questions, key=lambda q: q.order_index)

    answers_by_index = {a.question_index: a for a in attempt.answers}

    questions_out = []
    for idx, item in enumerate(ordered_items):
        snapshot = dict(item.question_snapshot or {})
        snap_options = snapshot.get('options', [])
        answer = answers_by_index.get(idx)
        selected_keys: list[str] = answer.selected_option_keys if answer else []
        is_correct: bool | None = answer.is_correct if answer else None

        correct_keys = {opt.get('key') for opt in snap_options if opt.get('is_correct')}
        earned = item.points if is_correct else 0.0

        options_out = [
            {
                'key': opt.get('key', ''),
                'text': opt.get('text', ''),
                'is_correct': bool(opt.get('is_correct', False)),
            }
            for opt in snap_options
        ]

        questions_out.append(
            {
                'index': idx,
                'prompt': snapshot.get('prompt', ''),
                'question_type': snapshot.get('question_type', 'mcq_single'),
                'points': item.points,
                'earned_points': earned,
                'explanation': snapshot.get('explanation'),
                'section': item.section,
                'options': options_out,
                'selected_keys': selected_keys,
                'is_correct': is_correct,
            }
        )

    return {
        'attempt_id': attempt.id,
        'score': attempt.score,
        'max_score': attempt.max_score,
        'score_percent': attempt.score_percent,
        'passed': bool(attempt.passed),
        'status': attempt.status,
        'questions': questions_out,
    }


def list_my_results(db: Session, *, user_id: UUID, tenant_id: UUID) -> list[dict]:
    """Return completed attempts for a given user scoped to a single tenant."""
    stmt = (
        select(
            AssessmentAttempt,
            AssessmentDelivery.test_version_id,
            AssessmentTestVersion.test_id,
            AssessmentTest.title.label('test_title'),
        )
        .join(AssessmentDelivery, AssessmentAttempt.delivery_id == AssessmentDelivery.id)
        .join(AssessmentTestVersion, AssessmentDelivery.test_version_id == AssessmentTestVersion.id)
        .join(AssessmentTest, AssessmentTestVersion.test_id == AssessmentTest.id)
        .where(
            AssessmentAttempt.user_id == user_id,
            AssessmentAttempt.tenant_id == tenant_id,  # tenant isolation
            AssessmentAttempt.status.in_(['scored', 'submitted', 'expired']),
        )
        .order_by(AssessmentAttempt.submitted_at.desc().nulls_last())
    )
    rows = db.execute(stmt).all()
    result = []
    for row in rows:
        attempt: AssessmentAttempt = row[0]
        test_id = row[2]
        test_title: str = row[3] or 'Untitled test'
        result.append(
            {
                'attempt_id': attempt.id,
                'attempt_number': attempt.attempt_number,
                'delivery_id': attempt.delivery_id,
                'test_id': test_id,
                'test_title': test_title,
                'status': attempt.status,
                'started_at': attempt.started_at,
                'submitted_at': attempt.submitted_at,
                'score': attempt.score,
                'max_score': attempt.max_score,
                'score_percent': attempt.score_percent,
                'passed': bool(attempt.passed),
                'stars_earned': attempt.stars_earned,
                'section_scores': attempt.section_scores,
            }
        )
    return result
