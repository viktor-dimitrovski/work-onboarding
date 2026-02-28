from __future__ import annotations

import re
import time
from typing import Any
from uuid import UUID

from datetime import datetime, timezone
from uuid import UUID as PyUUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal, set_tenant_id
from app.models.assessment import (
    AssessmentCategory,
    AssessmentClassificationJob,
    AssessmentClassificationJobItem,
    AssessmentQuestion,
)
from app.services.openai_responses_service import call_openai_responses_json
from app.services import usage_service
from app.services.assessment_service import build_question_query


CLASSIFICATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["questions"],
    "properties": {
        "questions": {
            "type": "array",
            "minItems": 1,
            "maxItems": 50,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "category", "difficulty"],
                "properties": {
                    "id": {"type": "string"},
                    "category": {"type": "string", "minLength": 1},
                    "difficulty": {"type": "string", "enum": ["easy", "medium", "hard"]},
                },
            },
        }
    },
}


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "general"


def _truncate(text: str, limit: int = 400) -> str:
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 3] + "..."


def _build_prompt(questions: list[AssessmentQuestion], categories: list[str]) -> str:
    category_hint = ", ".join(categories) if categories else "none"
    lines = [
        "Classify each question into a single category and difficulty (easy|medium|hard).",
        "Use an existing category if it fits; otherwise propose a short new category name.",
        f"Existing categories: {category_hint}.",
        "",
        "Questions:",
    ]
    for q in questions:
        tags = ", ".join(q.tags or [])
        prompt = _truncate(q.prompt or "")
        if tags:
            lines.append(f"{q.id} | {prompt} | tags: {tags}")
        else:
            lines.append(f"{q.id} | {prompt}")
    return "\n".join(lines)


def _get_or_create_category(db: Session, name: str, actor_user_id: UUID) -> tuple[AssessmentCategory, bool]:
    clean_name = (name or "").strip()[:100] or "General"
    slug = _slugify(clean_name)[:120]
    existing = db.scalar(select(AssessmentCategory).where(AssessmentCategory.slug == slug))
    if existing:
        return existing, False
    category = AssessmentCategory(
        name=clean_name,
        slug=slug,
        created_by=actor_user_id,
        updated_by=actor_user_id,
    )
    db.add(category)
    db.flush()
    return category, True


def run_classification_job(
    *,
    job_id: UUID,
    tenant_id: UUID,
    actor_user_id: UUID,
    mode: str,
    dry_run: bool,
    batch_size: int,
) -> None:
    db = SessionLocal()
    try:
        def _set_ctx() -> None:
            # Tenant context is transaction-local (set_config(..., true)).
            # After each commit() we must re-apply it, otherwise RLS hides rows and updates become no-ops.
            set_tenant_id(db, str(tenant_id))

        _set_ctx()
        job = db.scalar(select(AssessmentClassificationJob).where(AssessmentClassificationJob.id == job_id))
        if not job:
            return

        job.status = "running"
        job.error_summary = None
        job.report_json = {}
        job.started_at = datetime.now(timezone.utc)
        job.completed_at = None
        job.last_heartbeat_at = datetime.now(timezone.utc)
        job.cancel_requested = False
        job.mode = mode
        job.dry_run = bool(dry_run)
        job.batch_size = int(batch_size)
        job.updated_by = actor_user_id
        db.flush()

        scope = dict(job.scope_json or {})
        scope_kind = str(scope.get("scope") or "all_matching")
        raw_ids = scope.get("question_ids") or []
        if not isinstance(raw_ids, list):
            raw_ids = []
        selected_ids: list[PyUUID] = []
        for item in raw_ids:
            try:
                selected_ids.append(PyUUID(str(item)))
            except Exception:
                continue

        filters = dict(scope.get("filters") or {}) if isinstance(scope.get("filters"), dict) else {}

        def _split_csv(value: str | None) -> list[str] | None:
            if not value:
                return None
            items = [part.strip() for part in str(value).split(",") if part.strip()]
            return items or None

        base_query = build_question_query(
            status_filters=_split_csv(filters.get("status")),
            query=filters.get("q"),
            tags=_split_csv(filters.get("tag")),
            difficulties=_split_csv(filters.get("difficulty")),
            categories=_split_csv(filters.get("category")),
            include_joins=False,
        )

        if scope_kind == "selected" and selected_ids:
            base_query = base_query.where(AssessmentQuestion.id.in_(selected_ids))

        if mode == "unclassified_only":
            base_query = base_query.where(
                or_(
                    AssessmentQuestion.category_id.is_(None),
                    AssessmentQuestion.difficulty.is_(None),
                )
            )

        total = db.scalar(select(func.count()).select_from(base_query.subquery()))
        job.total = int(total or 0)
        job.processed = 0
        db.commit()
        _set_ctx()

        categories = db.scalars(select(AssessmentCategory).order_by(AssessmentCategory.name.asc())).all()
        category_names = [c.name for c in categories]

        report: dict[str, Any] = {
            "updated": 0,
            "skipped": 0,
            "created_categories": 0,
            "category_counts": {},
            "difficulty_counts": {},
        }

        last_id: UUID | None = None
        while True:
            _set_ctx()
            job = db.scalar(select(AssessmentClassificationJob).where(AssessmentClassificationJob.id == job_id))
            if not job:
                return
            if job.cancel_requested:
                job.status = "canceled"
                job.completed_at = datetime.now(timezone.utc)
                job.last_heartbeat_at = datetime.now(timezone.utc)
                job.updated_by = actor_user_id
                db.commit()
                return
            if job.pause_requested:
                if job.status != "paused":
                    job.status = "paused"
                    job.last_heartbeat_at = datetime.now(timezone.utc)
                    job.updated_by = actor_user_id
                    db.commit()
                # Sleep briefly and check again (keeps job alive across UI navigation).
                time.sleep(1.5)
                continue
            if job.status == "paused":
                job.status = "running"
                job.last_heartbeat_at = datetime.now(timezone.utc)
                job.updated_by = actor_user_id
                db.commit()

            query = base_query.order_by(AssessmentQuestion.id).limit(batch_size)
            if last_id:
                query = query.where(AssessmentQuestion.id > last_id)
            batch = db.scalars(query).all()
            if not batch:
                break

            last_id = batch[-1].id
            prompt = _build_prompt(batch, category_names)
            payload = call_openai_responses_json(
                instructions="Return JSON only. Keep category short and consistent.",
                input_text=prompt,
                schema_name="assessment_questions_classification",
                schema=CLASSIFICATION_SCHEMA,
                temperature=0.2,
                timeout_ms=60_000,
            )

            results = {
                str(item.get("id")): item
                for item in (payload.get("questions") or [])
                if isinstance(item, dict)
            }

            for question in batch:
                result = results.get(str(question.id))
                if not result:
                    report["skipped"] += 1
                    continue

                old_category_id = question.category_id
                old_difficulty = question.difficulty

                category_name = str(result.get("category") or "").strip()
                difficulty = str(result.get("difficulty") or "").strip().lower()
                if difficulty not in ("easy", "medium", "hard"):
                    report["skipped"] += 1
                    continue

                if mode == "unclassified_only":
                    needs_category = question.category_id is None
                    needs_difficulty = question.difficulty is None
                else:
                    needs_category = True
                    needs_difficulty = True

                if not category_name:
                    report["skipped"] += 1
                    continue

                clean_name = (category_name or "").strip()[:100] or "General"
                slug = _slugify(clean_name)[:120]
                category = None
                created = False
                if not dry_run:
                    category, created = _get_or_create_category(db, clean_name, actor_user_id)
                    if created:
                        report["created_categories"] += 1
                        category_names.append(category.name)

                if not dry_run:
                    if needs_category:
                        question.category_id = category.id if category else None
                    if needs_difficulty:
                        question.difficulty = difficulty
                    question.updated_by = actor_user_id

                # Record per-question diff for review/rollback.
                item = db.scalar(
                    select(AssessmentClassificationJobItem).where(
                        AssessmentClassificationJobItem.job_id == job_id,
                        AssessmentClassificationJobItem.question_id == question.id,
                    )
                )
                if not item:
                    item = AssessmentClassificationJobItem(
                        job_id=job_id,
                        question_id=question.id,
                        old_category_id=old_category_id,
                        old_difficulty=old_difficulty,
                        new_category_name=clean_name,
                        new_category_slug=slug,
                        new_category_id=category.id if category else None,
                        new_difficulty=difficulty,
                        applied=not dry_run,
                        applied_at=datetime.now(timezone.utc) if not dry_run else None,
                        created_by=actor_user_id,
                        updated_by=actor_user_id,
                    )
                    db.add(item)
                else:
                    item.new_category_name = clean_name
                    item.new_category_slug = slug
                    item.new_category_id = category.id if category else None
                    item.new_difficulty = difficulty
                    if not dry_run:
                        item.applied = True
                        item.applied_at = datetime.now(timezone.utc)
                    item.updated_by = actor_user_id

                report["updated"] += 1
                report["category_counts"][slug] = report["category_counts"].get(slug, 0) + 1
                report["difficulty_counts"][difficulty] = report["difficulty_counts"].get(difficulty, 0) + 1

            job.processed += len(batch)
            job.report_json = report
            job.last_heartbeat_at = datetime.now(timezone.utc)
            job.updated_by = actor_user_id
            db.commit()

        _set_ctx()
        job.status = "completed"
        job.report_json = report
        job.completed_at = datetime.now(timezone.utc)
        job.last_heartbeat_at = datetime.now(timezone.utc)
        job.updated_by = actor_user_id
        usage_service.record_event(
            db,
            tenant_id=tenant_id,
            event_key='ai.classify_questions',
            quantity=float(job.processed),
            actor_user_id=actor_user_id,
            meta={'mode': mode, 'dry_run': dry_run},
        )
        db.commit()
    except Exception as exc:
        try:
            _set_ctx()
            job = db.scalar(select(AssessmentClassificationJob).where(AssessmentClassificationJob.id == job_id))
            if job:
                job.status = "failed"
                job.error_summary = str(exc)[:500]
                job.updated_by = actor_user_id
                db.commit()
        finally:
            raise
    finally:
        db.close()


def apply_job_items(db: Session, *, job_id: UUID, actor_user_id: UUID) -> int:
    items = db.scalars(
        select(AssessmentClassificationJobItem)
        .where(AssessmentClassificationJobItem.job_id == job_id, AssessmentClassificationJobItem.applied.is_(False))
        .order_by(AssessmentClassificationJobItem.created_at.asc())
    ).all()
    if not items:
        return 0

    applied = 0
    for item in items:
        # Ensure category exists
        category, _ = _get_or_create_category(db, item.new_category_name, actor_user_id)
        item.new_category_id = category.id
        q = db.scalar(select(AssessmentQuestion).where(AssessmentQuestion.id == item.question_id))
        if not q:
            item.error_summary = "Question not found"
            item.updated_by = actor_user_id
            continue

        # Optimistic check: only apply if question wasn't modified since preview.
        if q.category_id != item.old_category_id or q.difficulty != item.old_difficulty:
            item.error_summary = "Question changed since preview; skipped"
            item.updated_by = actor_user_id
            continue

        q.category_id = category.id
        q.difficulty = item.new_difficulty
        q.updated_by = actor_user_id
        item.applied = True
        item.applied_at = datetime.now(timezone.utc)
        item.error_summary = None
        item.updated_by = actor_user_id
        applied += 1

    db.flush()
    return applied


def rollback_job_items(db: Session, *, job_id: UUID, actor_user_id: UUID) -> int:
    items = db.scalars(
        select(AssessmentClassificationJobItem)
        .where(AssessmentClassificationJobItem.job_id == job_id, AssessmentClassificationJobItem.applied.is_(True))
        .order_by(AssessmentClassificationJobItem.applied_at.asc().nulls_last())
    ).all()
    if not items:
        return 0

    rolled_back = 0
    for item in items:
        q = db.scalar(select(AssessmentQuestion).where(AssessmentQuestion.id == item.question_id))
        if not q:
            continue
        # Only rollback if current values still match the applied values.
        if item.new_category_id and q.category_id != item.new_category_id:
            continue
        if q.difficulty != item.new_difficulty:
            continue

        q.category_id = item.old_category_id
        q.difficulty = item.old_difficulty
        q.updated_by = actor_user_id
        rolled_back += 1

    db.flush()
    return rolled_back
