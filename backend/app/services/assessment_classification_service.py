from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal, set_tenant_id
from app.models.assessment import AssessmentCategory, AssessmentClassificationJob, AssessmentQuestion
from app.services.openai_responses_service import call_openai_responses_json
from app.services import usage_service


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
        set_tenant_id(db, str(tenant_id))
        job = db.scalar(select(AssessmentClassificationJob).where(AssessmentClassificationJob.id == job_id))
        if not job:
            return

        job.status = "running"
        job.error_summary = None
        job.report_json = {}
        job.updated_by = actor_user_id
        db.flush()

        base_filter = []
        if mode == "unclassified_only":
            base_filter.append(
                or_(
                    AssessmentQuestion.category_id.is_(None),
                    AssessmentQuestion.difficulty.is_(None),
                )
            )

        total = db.scalar(
            select(func.count())
            .select_from(select(AssessmentQuestion.id).where(*base_filter).subquery())
        )
        job.total = int(total or 0)
        job.processed = 0
        db.commit()

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
            query = select(AssessmentQuestion).where(*base_filter).order_by(AssessmentQuestion.id).limit(batch_size)
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

                category, created = _get_or_create_category(db, category_name, actor_user_id)
                if created:
                    report["created_categories"] += 1
                    category_names.append(category.name)

                if not dry_run:
                    if needs_category:
                        question.category_id = category.id
                    if needs_difficulty:
                        question.difficulty = difficulty
                    question.updated_by = actor_user_id

                report["updated"] += 1
                report["category_counts"][category.slug] = report["category_counts"].get(category.slug, 0) + 1
                report["difficulty_counts"][difficulty] = report["difficulty_counts"].get(difficulty, 0) + 1

            job.processed += len(batch)
            job.report_json = report
            job.updated_by = actor_user_id
            db.commit()

        job.status = "completed"
        job.report_json = report
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
