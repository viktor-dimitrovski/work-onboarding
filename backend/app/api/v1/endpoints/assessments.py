import re
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, UploadFile, File, Form, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.models.rbac import User
from app.multitenancy.deps import TenantContext, require_tenant_membership
from app.multitenancy.permissions import require_access
from app.multitenancy.deps import TenantContext, require_tenant_membership
from app.schemas.assessment import (
    AssessmentAttemptAnswersUpdate,
    AssessmentAttemptStartOut,
    AssessmentAttemptSubmitOut,
    AssessmentAttemptOut,
    AssessmentCategoryListResponse,
    AssessmentClassificationJobCreate,
    AssessmentClassificationJobOut,
    AssessmentDeliveryCreate,
    AssessmentDeliveryListResponse,
    AssessmentDeliveryOut,
    AssessmentQuestionCreate,
    AssessmentQuestionListResponse,
    AssessmentQuestionOut,
    AssessmentQuestionUpdate,
    AssessmentPdfImportResponse,
    AssessmentResultListResponse,
    AssessmentResultSummary,
    AssessmentTestCreate,
    AssessmentTestListResponse,
    AssessmentTestOut,
    AssessmentTestUpdate,
    AssessmentTestVersionOut,
    AssessmentTestVersionUpdate,
)
from app.schemas.common import PaginationMeta
from app.models.assessment import AssessmentAttempt, AssessmentClassificationJob
from app.services import assessment_classification_service, assessment_service, audit_service, usage_service
from app.services.openai_responses_service import call_openai_responses_json
from app.services.pdf_extract_service import chunk_pages, extract_pdf_pages_text


router = APIRouter(prefix='/assessments', tags=['assessments'])

IMPORT_SYSTEM_PROMPT = """You extract high-quality multiple-choice assessment questions from technical text.
Return compact JSON only (no prose).

Constraints:
- question_type must be "mcq_single" or "mcq_multi"
- Provide 4 options for each question when possible (min 2).
- For mcq_single: exactly 1 correct option.
- For mcq_multi: 2-3 correct options.
- Keep prompts unambiguous and answerable from the provided text.
- Avoid trick questions; focus on key concepts, definitions, procedures, and requirements.
"""

IMPORT_JSON_SCHEMA: dict = {
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
                "required": ["prompt", "question_type", "difficulty", "tags", "status", "explanation", "options"],
                "properties": {
                    "prompt": {"type": "string", "minLength": 8},
                    "question_type": {"type": "string", "enum": ["mcq_single", "mcq_multi"]},
                    "difficulty": {"type": ["string", "null"]},
                    "tags": {"type": "array", "items": {"type": "string"}, "maxItems": 20},
                    "status": {"type": "string", "enum": ["draft"]},
                    "explanation": {"type": ["string", "null"]},
                    "options": {
                        "type": "array",
                        "minItems": 2,
                        "maxItems": 6,
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["option_text", "is_correct", "order_index"],
                            "properties": {
                                "option_text": {"type": "string", "minLength": 1},
                                "is_correct": {"type": "boolean"},
                                "order_index": {"type": "integer", "minimum": 0, "maximum": 10},
                            },
                        },
                    },
                },
            },
        }
    },
}


def _normalize_tags(raw: str) -> list[str]:
    tags = []
    for part in (raw or "").split(","):
        t = part.strip()
        if t:
            tags.append(t)
    # de-dupe while preserving order
    seen = set()
    out = []
    for t in tags:
        if t in seen:
            continue
        seen.add(t)
        out.append(t)
    return out


def _split_csv(value: str | None) -> list[str] | None:
    if not value:
        return None
    items = [part.strip() for part in value.split(",") if part.strip()]
    return items or None


def _validate_mcq(question: dict) -> tuple[dict | None, str | None]:
    qtype = question.get("question_type")
    options = question.get("options") or []
    if qtype not in ("mcq_single", "mcq_multi"):
        return None, "invalid question_type"
    if not isinstance(options, list) or len(options) < 2:
        return None, "not enough options"

    # Ensure order_index contiguous
    normalized_opts = []
    for idx, opt in enumerate(options):
        if not isinstance(opt, dict):
            continue
        text = str(opt.get("option_text") or "").strip()
        if not text:
            continue
        normalized_opts.append(
            {
                "option_text": text,
                "is_correct": bool(opt.get("is_correct", False)),
                "order_index": idx,
            }
        )
    if len(normalized_opts) < 2:
        return None, "not enough valid option_text"

    correct_count = sum(1 for o in normalized_opts if o["is_correct"])
    if qtype == "mcq_single" and correct_count != 1:
        # try to coerce: keep the first correct, else mark first as correct
        if correct_count > 1:
            first = True
            for o in normalized_opts:
                if o["is_correct"] and first:
                    first = False
                elif o["is_correct"]:
                    o["is_correct"] = False
        else:  # 0
            normalized_opts[0]["is_correct"] = True
    if qtype == "mcq_multi" and correct_count < 2:
        # coerce by adding the second option as correct
        if len(normalized_opts) >= 2:
            normalized_opts[0]["is_correct"] = True
            normalized_opts[1]["is_correct"] = True

    question["options"] = normalized_opts
    question["status"] = "draft"
    return question, None


@router.post('/questions/import-pdf', response_model=AssessmentPdfImportResponse, status_code=status.HTTP_201_CREATED)
def import_questions_from_pdf(
    file: UploadFile = File(...),
    question_count: int = Form(20),
    tags: str = Form(''),
    difficulty: str | None = Form(None),
    max_pages: int | None = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
    ctx: TenantContext = Depends(require_tenant_membership),
) -> AssessmentPdfImportResponse:
    if question_count < 1 or question_count > 100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="question_count must be 1..100")

    if file.content_type and "pdf" not in file.content_type.lower():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only PDF uploads are supported.")

    pdf_bytes = file.file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file.")
    if len(pdf_bytes) > 25 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="PDF too large (max 25MB).")

    pages = extract_pdf_pages_text(pdf_bytes, max_pages=max_pages)
    total_chars = sum(len(p) for p in pages if p)
    if total_chars < 500:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Could not extract enough text from this PDF (it may be scanned). OCR is not enabled yet.",
        )

    chunks = chunk_pages(pages, max_chars=18_000)
    if not chunks:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No extractable text found.")

    base_tags = _normalize_tags(tags)
    source_tag = f"source:{(file.filename or 'pdf').strip()}"
    merged_tags = [*base_tags, "pdf_import", source_tag]
    # de-dupe merged tags
    merged_tags = _normalize_tags(",".join(merged_tags))

    warnings: list[str] = []
    questions: list[dict] = []
    remaining = question_count

    for chunk in chunks:
        if remaining <= 0:
            break
        per_chunk = min(remaining, 20)
        prompt = (
            f"Generate exactly {per_chunk} questions as JSON.\n"
            f"Difficulty: {difficulty or 'mixed'}\n"
            f"Tags to include on every question: {merged_tags}\n\n"
            f"Content:\n{chunk}"
        )
        payload = call_openai_responses_json(
            instructions=IMPORT_SYSTEM_PROMPT,
            input_text=prompt,
            schema_name="assessment_questions_import",
            schema=IMPORT_JSON_SCHEMA,
            temperature=0.3,
            timeout_ms=60_000,
        )
        items = payload.get("questions")
        if not isinstance(items, list):
            warnings.append("OpenAI returned unexpected payload shape for one chunk.")
            continue

        for q in items:
            if not isinstance(q, dict):
                continue
            q["tags"] = merged_tags
            if difficulty and not q.get("difficulty"):
                q["difficulty"] = difficulty
            q, err = _validate_mcq(q)
            if err:
                warnings.append(f"Skipped invalid question: {err}")
                continue
            questions.append(q)

        remaining = question_count - len(questions)

    # de-dupe by prompt
    seen_prompts = set()
    deduped: list[dict] = []
    for q in questions:
        prompt = str(q.get("prompt") or "").strip()
        key = re.sub(r"\s+", " ", prompt).lower()
        if not prompt or key in seen_prompts:
            continue
        seen_prompts.add(key)
        deduped.append(q)
        if len(deduped) >= question_count:
            break

    if not deduped:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No valid questions generated.")

    created_ids = []
    for q in deduped:
        created = assessment_service.create_question(db, payload=q, actor_user_id=current_user.id)
        created_ids.append(created.id)

    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="assessment_questions_import_pdf",
        entity_type="assessment_question",
        details={
            "filename": file.filename,
            "imported_count": len(created_ids),
            "question_count_requested": question_count,
            "tags": merged_tags,
            "difficulty": difficulty,
            "max_pages": max_pages,
        },
    )
    usage_service.record_event(
        db,
        tenant_id=ctx.tenant.id,
        event_key='ai.pdf_import',
        quantity=float(len(created_ids)),
        actor_user_id=current_user.id,
        meta={'filename': file.filename or '', 'question_count_requested': question_count},
    )
    db.commit()

    return AssessmentPdfImportResponse(
        imported_count=len(created_ids),
        question_ids=created_ids,
        warnings=warnings,
    )

@router.get('/questions', response_model=AssessmentQuestionListResponse)
def list_questions(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status_filter: str | None = Query(default=None, alias='status'),
    query: str | None = Query(default=None, alias='q'),
    tag: str | None = Query(default=None),
    difficulty: str | None = Query(default=None),
    category: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:read')),
) -> AssessmentQuestionListResponse:
    status_filters = _split_csv(status_filter)
    difficulties = _split_csv(difficulty)
    tags = _split_csv(tag)
    categories = _split_csv(category)
    items, total = assessment_service.list_questions(
        db,
        page=page,
        page_size=page_size,
        status_filters=status_filters,
        query=query,
        tags=tags,
        difficulties=difficulties,
        categories=categories,
    )
    return AssessmentQuestionListResponse(
        items=[AssessmentQuestionOut.model_validate(item) for item in items],
        meta=PaginationMeta(page=page, page_size=page_size, total=total),
    )


@router.get('/categories', response_model=AssessmentCategoryListResponse)
def list_categories(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:read')),
) -> AssessmentCategoryListResponse:
    items = assessment_service.list_categories(db)
    return AssessmentCategoryListResponse(items=[item for item in items])


@router.post('/questions/classify', response_model=AssessmentClassificationJobOut, status_code=status.HTTP_202_ACCEPTED)
def start_classification_job(
    payload: AssessmentClassificationJobCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> AssessmentClassificationJobOut:
    if payload.mode not in ('unclassified_only', 'reclassify_all'):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid classification mode')

    existing = db.scalar(
        select(AssessmentClassificationJob)
        .where(AssessmentClassificationJob.status.in_(['queued', 'running']))
        .order_by(AssessmentClassificationJob.created_at.desc())
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='A classification job is already running')

    job = AssessmentClassificationJob(
        status='queued',
        total=0,
        processed=0,
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(
        assessment_classification_service.run_classification_job,
        job_id=job.id,
        tenant_id=ctx.tenant.id,
        actor_user_id=current_user.id,
        mode=payload.mode,
        dry_run=payload.dry_run,
        batch_size=payload.batch_size,
    )

    return AssessmentClassificationJobOut.model_validate(job)


@router.get('/questions/classify/jobs/{job_id}', response_model=AssessmentClassificationJobOut)
def get_classification_job(
    job_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:read')),
) -> AssessmentClassificationJobOut:
    job = db.scalar(select(AssessmentClassificationJob).where(AssessmentClassificationJob.id == job_id))
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Classification job not found')
    return AssessmentClassificationJobOut.model_validate(job)


@router.post('/questions', response_model=AssessmentQuestionOut, status_code=status.HTTP_201_CREATED)
def create_question(
    payload: AssessmentQuestionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> AssessmentQuestionOut:
    question = assessment_service.create_question(
        db, payload=payload.model_dump(), actor_user_id=current_user.id
    )
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='assessment_question_create',
        entity_type='assessment_question',
        entity_id=question.id,
        details={'prompt': question.prompt},
    )
    db.commit()
    return AssessmentQuestionOut.model_validate(question)


@router.get('/questions/{question_id}', response_model=AssessmentQuestionOut)
def get_question(
    question_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:read')),
) -> AssessmentQuestionOut:
    question = assessment_service.get_question(db, question_id)
    return AssessmentQuestionOut.model_validate(question)


@router.put('/questions/{question_id}', response_model=AssessmentQuestionOut)
def update_question(
    question_id: UUID,
    payload: AssessmentQuestionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> AssessmentQuestionOut:
    question = assessment_service.update_question(
        db, question_id=question_id, payload=payload.model_dump(exclude_unset=True), actor_user_id=current_user.id
    )
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='assessment_question_update',
        entity_type='assessment_question',
        entity_id=question.id,
    )
    db.commit()
    return AssessmentQuestionOut.model_validate(question)


@router.get('/tests', response_model=AssessmentTestListResponse)
def list_tests(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status_filter: str | None = Query(default=None, alias='status'),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:read')),
) -> AssessmentTestListResponse:
    items, total = assessment_service.list_tests(
        db, page=page, page_size=page_size, status_filter=status_filter
    )
    return AssessmentTestListResponse(
        items=[AssessmentTestOut.model_validate(item) for item in items],
        meta=PaginationMeta(page=page, page_size=page_size, total=total),
    )


@router.post('/tests', response_model=AssessmentTestOut, status_code=status.HTTP_201_CREATED)
def create_test(
    payload: AssessmentTestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> AssessmentTestOut:
    test = assessment_service.create_test(db, payload=payload.model_dump(), actor_user_id=current_user.id)
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='assessment_test_create',
        entity_type='assessment_test',
        entity_id=test.id,
        details={'title': test.title},
    )
    db.commit()
    return AssessmentTestOut.model_validate(test)


@router.get('/tests/{test_id}', response_model=AssessmentTestOut)
def get_test(
    test_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:read')),
) -> AssessmentTestOut:
    test = assessment_service.get_test(db, test_id)
    return AssessmentTestOut.model_validate(test)


@router.put('/tests/{test_id}', response_model=AssessmentTestOut)
def update_test(
    test_id: UUID,
    payload: AssessmentTestUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> AssessmentTestOut:
    test = assessment_service.get_test(db, test_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(test, field, value)
    test.updated_by = current_user.id
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='assessment_test_update',
        entity_type='assessment_test',
        entity_id=test.id,
    )
    db.commit()
    return AssessmentTestOut.model_validate(assessment_service.get_test(db, test.id))


@router.post('/tests/{test_id}/versions', response_model=AssessmentTestVersionOut, status_code=status.HTTP_201_CREATED)
def create_test_version(
    test_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> AssessmentTestVersionOut:
    version = assessment_service.create_test_version(db, test_id=test_id, actor_user_id=current_user.id)
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='assessment_test_version_create',
        entity_type='assessment_test_version',
        entity_id=version.id,
        details={'test_id': str(test_id)},
    )
    db.commit()
    return AssessmentTestVersionOut.model_validate(version)


@router.put('/test-versions/{version_id}', response_model=AssessmentTestVersionOut)
def update_test_version(
    version_id: UUID,
    payload: AssessmentTestVersionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> AssessmentTestVersionOut:
    version = assessment_service.update_test_version(
        db,
        version_id=version_id,
        payload=payload.model_dump(exclude_unset=True),
        actor_user_id=current_user.id,
    )
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='assessment_test_version_update',
        entity_type='assessment_test_version',
        entity_id=version.id,
    )
    db.commit()
    return AssessmentTestVersionOut.model_validate(version)


@router.post('/test-versions/{version_id}/publish', response_model=AssessmentTestVersionOut)
def publish_test_version(
    version_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> AssessmentTestVersionOut:
    version = assessment_service.publish_test_version(db, version_id=version_id, actor_user_id=current_user.id)
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='assessment_test_version_publish',
        entity_type='assessment_test_version',
        entity_id=version.id,
    )
    db.commit()
    return AssessmentTestVersionOut.model_validate(version)


@router.post('/deliveries', response_model=AssessmentDeliveryOut, status_code=status.HTTP_201_CREATED)
def create_delivery(
    payload: AssessmentDeliveryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> AssessmentDeliveryOut:
    delivery = assessment_service.create_delivery(
        db, payload=payload.model_dump(exclude_unset=True), actor_user_id=current_user.id
    )
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='assessment_delivery_create',
        entity_type='assessment_delivery',
        entity_id=delivery.id,
    )
    db.commit()
    return AssessmentDeliveryOut.model_validate(delivery)


@router.get('/deliveries', response_model=AssessmentDeliveryListResponse)
def list_deliveries(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    participant_user_id: UUID | None = Query(default=None),
    test_version_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:read')),
) -> AssessmentDeliveryListResponse:
    items, total = assessment_service.list_deliveries(
        db,
        page=page,
        page_size=page_size,
        participant_user_id=participant_user_id,
        test_version_id=test_version_id,
    )
    return AssessmentDeliveryListResponse(
        items=[AssessmentDeliveryOut.model_validate(item) for item in items],
        meta=PaginationMeta(page=page, page_size=page_size, total=total),
    )


@router.get('/deliveries/{delivery_id}', response_model=AssessmentDeliveryOut)
def get_delivery(
    delivery_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assessments', 'assessments:take')),
) -> AssessmentDeliveryOut:
    delivery = assessment_service.get_delivery(db, delivery_id)
    roles = set(ctx.roles)
    if {'member', 'parent'} & roles and delivery.participant_user_id not in (None, current_user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Forbidden delivery')
    return AssessmentDeliveryOut.model_validate(delivery)


@router.post('/deliveries/{delivery_id}/attempts/start', response_model=AssessmentAttemptStartOut)
def start_attempt(
    delivery_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:take')),
) -> AssessmentAttemptStartOut:
    attempt = assessment_service.start_attempt(db, delivery_id=delivery_id, user_id=current_user.id)
    version = assessment_service.get_test_version(db, attempt.delivery.test_version_id)
    questions = assessment_service._build_attempt_questions(version, attempt.question_order)
    return AssessmentAttemptStartOut(
        attempt=AssessmentAttemptOut.model_validate(attempt),
        questions=questions,
    )


@router.put('/attempts/{attempt_id}/answers', response_model=AssessmentAttemptOut)
def autosave_answers(
    attempt_id: UUID,
    payload: AssessmentAttemptAnswersUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assessments', 'assessments:take')),
) -> AssessmentAttemptOut:
    attempt = db.scalar(
        select(AssessmentAttempt)
        .where(AssessmentAttempt.id == attempt_id)
        .options(joinedload(AssessmentAttempt.answers))
    )
    if not attempt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Attempt not found')
    roles = set(ctx.roles)
    if {'member', 'parent'} & roles and attempt.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Not allowed to edit this attempt')

    assessment_service.autosave_answers(
        db, attempt_id=attempt_id, answers=payload.answers, actor_user_id=current_user.id
    )
    db.commit()
    return AssessmentAttemptOut.model_validate(attempt)


@router.post('/attempts/{attempt_id}/submit', response_model=AssessmentAttemptSubmitOut)
def submit_attempt(
    attempt_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assessments', 'assessments:take')),
) -> AssessmentAttemptSubmitOut:
    attempt = db.scalar(
        select(AssessmentAttempt).where(AssessmentAttempt.id == attempt_id).options(joinedload(AssessmentAttempt.answers))
    )
    if not attempt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Attempt not found')
    roles = set(ctx.roles)
    if {'member', 'parent'} & roles and attempt.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Not allowed to submit this attempt')

    attempt = assessment_service.submit_attempt(db, attempt_id=attempt_id, actor_user_id=current_user.id)
    usage_service.record_event(
        db,
        tenant_id=ctx.tenant.id,
        event_key='assessment.attempt_submit',
        quantity=1.0,
        actor_user_id=current_user.id,
        meta={'attempt_id': str(attempt_id)},
    )
    total_questions = len(attempt.question_order)
    correct_count = len([answer for answer in attempt.answers if answer.is_correct])
    db.commit()
    return AssessmentAttemptSubmitOut(
        attempt=AssessmentAttemptOut.model_validate(attempt),
        correct_count=correct_count,
        total_questions=total_questions,
    )


@router.get('/results', response_model=AssessmentResultListResponse)
def list_results(
    delivery_id: UUID | None = Query(default=None),
    user_id: UUID | None = Query(default=None),
    test_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assessments', 'assessments:take')),
) -> AssessmentResultListResponse:
    roles = set(ctx.roles)
    effective_user_id = user_id
    if {'member', 'parent'} & roles and not {'tenant_admin', 'manager', 'mentor'} & roles:
        effective_user_id = current_user.id

    attempts = assessment_service.list_attempts(
        db, delivery_id=delivery_id, user_id=effective_user_id, test_id=test_id
    )
    scores = [attempt.score_percent for attempt in attempts if attempt.score_percent is not None]
    average_score = (sum(scores) / len(scores)) if scores else None

    summary = AssessmentResultSummary(
        delivery_id=delivery_id,
        test_id=test_id,
        user_id=effective_user_id,
        attempt_count=len(attempts),
        average_score_percent=average_score,
    )
    return AssessmentResultListResponse(
        items=[AssessmentAttemptOut.model_validate(item) for item in attempts],
        summary=summary,
    )
