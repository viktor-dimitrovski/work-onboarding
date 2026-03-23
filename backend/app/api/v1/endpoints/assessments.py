from datetime import datetime, timedelta, timezone
import json
import re
import threading
import time
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, UploadFile, File, Form, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.models.rbac import User
from app.multitenancy.deps import TenantContext, require_tenant_membership
from app.multitenancy.permissions import permissions_for_roles, require_access
from app.schemas.assessment import (
    AssessmentAttemptAnswersUpdate,
    AssessmentAttemptStartOut,
    AssessmentAttemptSubmitOut,
    AssessmentAttemptOut,
    AssessmentCategoryCreate,
    AssessmentCategoryUpdate,
    AssessmentCategoryMergeIn,
    AssessmentCategoryListResponse,
    AssessmentCategoryOut,
    AssessmentCategoryTreeResponse,
    AssessmentCategoryTreeNode,
    AssessmentClassificationJobCreate,
    AssessmentClassificationJobOut,
    AssessmentClassificationJobItemListResponse,
    AssessmentClassificationJobItemOut,
    AssessmentDeliveryCreate,
    AssessmentDeliveryListResponse,
    AssessmentDeliveryOut,
    AssessmentDeliveryUpdate,
    AssessmentQuestionCreate,
    AssessmentQuestionListResponse,
    AssessmentQuestionOut,
    AssessmentQuestionStatsOut,
    AssessmentQuestionUpdate,
    AssessmentQuestionsBulkUpdate,
    AssessmentBulkUpdateResult,
    AssessmentDeduplicateResult,
    AssessmentPdfImportResponse,
    AssessmentTextImportIn,
    AssessmentTextImportJobStart,
    AssessmentTextImportJobStatus,
    AssessmentResultListResponse,
    AssessmentResultSummary,
    AttemptReviewOut,
    MyResultsResponse,
    MyResultAttemptOut,
    AssessmentTestCreate,
    AssessmentTestListResponse,
    AssessmentTestOut,
    AssessmentTestUpdate,
    AssessmentTestVersionHistoryResponse,
    AssessmentTestVersionOut,
    AssessmentTestVersionUpdate,
    AiImportTemplateOut,
    AiImportTemplateCreate,
    AiImportTemplateUpdate,
)
from app.schemas.common import PaginationMeta
from app.models.assessment import (
    AiImportTemplate,
    AssessmentAttempt,
    AssessmentClassificationJob,
    AssessmentDelivery,
    AssessmentTestVersion,
)
from app.models.assessment import AssessmentClassificationJobItem
from app.services import assessment_classification_service, assessment_service, audit_service, usage_service
from app.services.openai_responses_service import call_openai_responses_json
from app.services.pdf_extract_service import chunk_pages, extract_pdf_pages_text


router = APIRouter(prefix='/assessments', tags=['assessments'])


# ---------------------------------------------------------------------------
# Job store for text-import background jobs.
# Uses Redis when available (cross-process safe); falls back to an in-process
# dict protected by a lock (works fine for single-worker deployments).
# ---------------------------------------------------------------------------
_JOB_TTL = 600  # seconds
_JOB_KEY_PREFIX = 'import_job:'

# In-memory fallback
_mem_jobs: dict[str, dict] = {}
_mem_jobs_lock = threading.Lock()


def _job_key(job_id: str) -> str:
    return f'{_JOB_KEY_PREFIX}{job_id}'


def _write_job(job_id: str, data: dict) -> None:
    from app.core.redis_client import redis_client
    if redis_client is not None:
        redis_client.set(_job_key(job_id), json.dumps(data), ex=_JOB_TTL)
    else:
        with _mem_jobs_lock:
            _mem_jobs[job_id] = {**data, '_ts': time.monotonic()}
        _prune_mem_jobs()


def _read_job(job_id: str) -> dict | None:
    from app.core.redis_client import redis_client
    if redis_client is not None:
        raw = redis_client.get(_job_key(job_id))
        return json.loads(raw) if raw else None
    with _mem_jobs_lock:
        return _mem_jobs.get(job_id)


def _update_job(job_id: str, **fields: object) -> None:
    """Patch specific fields on an existing job (read-modify-write)."""
    data = _read_job(job_id)
    if data is None:
        return
    data.update(fields)
    _write_job(job_id, data)


def _prune_mem_jobs() -> None:
    now = time.monotonic()
    with _mem_jobs_lock:
        stale = [jid for jid, j in _mem_jobs.items() if j.get('status') != 'running' and now - j.get('_ts', now) > _JOB_TTL]
        for jid in stale:
            del _mem_jobs[jid]

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
    category_path: str | None = Form(None),
    max_pages: int | None = Form(None),
    extra_instructions: str | None = Form(None),
    material_context: str | None = Form(None),
    auto_question_count: bool = Form(False),
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

    # Build enriched system prompt
    pdf_system_prompt = IMPORT_SYSTEM_PROMPT
    if material_context:
        pdf_system_prompt += f'\n\nMaterial context: {material_context}'
    if extra_instructions:
        pdf_system_prompt += f'\n\nAdditional instructions:\n{extra_instructions}'

    warnings: list[str] = []
    questions: list[dict] = []
    remaining = question_count

    for chunk in chunks:
        if not auto_question_count and remaining <= 0:
            break
        per_chunk = min(remaining, 20) if not auto_question_count else 20
        if auto_question_count:
            count_instruction = f"Generate the most appropriate number of questions (max {per_chunk})"
        else:
            count_instruction = f"Generate exactly {per_chunk} questions"
        prompt = (
            f"{count_instruction} as JSON.\n"
            f"Difficulty: {difficulty or 'mixed'}\n"
            f"Tags to include on every question: {merged_tags}\n\n"
            f"Content:\n{chunk}"
        )
        payload = call_openai_responses_json(
            instructions=pdf_system_prompt,
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

        if not auto_question_count:
            remaining = question_count - len(questions)

    # de-dupe by prompt
    seen_prompts = set()
    deduped: list[dict] = []
    pdf_dedup_limit = len(questions) if auto_question_count else question_count
    for q in questions:
        prompt = str(q.get("prompt") or "").strip()
        key = re.sub(r"\s+", " ", prompt).lower()
        if not prompt or key in seen_prompts:
            continue
        seen_prompts.add(key)
        deduped.append(q)
        if len(deduped) >= pdf_dedup_limit:
            break

    if not deduped:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No valid questions generated.")

    # Resolve optional category path → UUID (creating hierarchy if needed).
    pdf_category_id: UUID | None = None
    if category_path and category_path.strip():
        pdf_category_id = assessment_service.find_or_create_category_path(db, category_path.strip())

    created_ids = []
    for q in deduped:
        if pdf_category_id is not None:
            q['category_id'] = pdf_category_id
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


def _split_text_chunks(text: str, chunk_size: int = 8_000) -> list[str]:
    paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
    chunks: list[str] = []
    buf: list[str] = []
    buf_size = 0
    for para in paragraphs:
        if buf_size + len(para) > chunk_size and buf:
            chunks.append('\n\n'.join(buf))
            buf = []
            buf_size = 0
        buf.append(para)
        buf_size += len(para) + 2
    if buf:
        chunks.append('\n\n'.join(buf))
    return chunks


def _run_text_import_job(
    job_id: str,
    text_chunks: list[str],
    question_count: int,
    merged_tags: list[str],
    difficulty: str | None,
    tenant_id: str,
    user_id: UUID,
    tenant_db_id: UUID,
    category_id: UUID | None = None,
    extra_instructions: str | None = None,
    material_context: str | None = None,
    auto_question_count: bool = False,
) -> None:
    """Background thread: calls OpenAI per chunk, saves questions, updates Redis job state."""
    from app.db.session import SessionLocal, set_tenant_id  # local import to avoid circular refs

    # Build enriched system prompt
    system_prompt = IMPORT_SYSTEM_PROMPT
    if material_context:
        system_prompt += f'\n\nMaterial context: {material_context}'
    if extra_instructions:
        system_prompt += f'\n\nAdditional instructions:\n{extra_instructions}'

    questions: list[dict] = []
    remaining = question_count
    warnings: list[str] = []

    def _is_cancelled() -> bool:
        job = _read_job(job_id)
        return bool(job and job.get('cancel_requested'))

    try:
        for i, chunk in enumerate(text_chunks):
            if not auto_question_count and remaining <= 0:
                break
            if _is_cancelled():
                _update_job(job_id, status='cancelled', phase='Cancelled by user.')
                return
            _update_job(job_id, phase=f'Generating questions… (chunk {i + 1} of {len(text_chunks)})')
            per_chunk = min(remaining, 25) if not auto_question_count else 25
            if auto_question_count:
                count_instruction = f'Generate the most appropriate number of questions (max {per_chunk})'
            else:
                count_instruction = f'Generate exactly {per_chunk} questions'
            prompt = (
                f'{count_instruction} as JSON.\n'
                f'Difficulty: {difficulty or "mixed"}\n'
                f'Tags to include on every question: {merged_tags}\n\n'
                f'Content:\n{chunk}'
            )
            try:
                payload = call_openai_responses_json(
                    instructions=system_prompt,
                    input_text=prompt,
                    schema_name='assessment_questions_import',
                    schema=IMPORT_JSON_SCHEMA,
                    temperature=0.3,
                    timeout_ms=120_000,
                )
            except Exception as exc:
                warnings.append(f'Chunk {i + 1} skipped (AI timeout or error): {exc}')
                _update_job(job_id, done_chunks=i + 1, warnings=warnings)
                continue

            items = payload.get('questions')
            if not isinstance(items, list):
                warnings.append(f'Chunk {i + 1}: OpenAI returned unexpected payload shape.')
                _update_job(job_id, done_chunks=i + 1, warnings=warnings)
                continue

            for q in items:
                if not isinstance(q, dict):
                    continue
                q['tags'] = merged_tags
                if difficulty and not q.get('difficulty'):
                    q['difficulty'] = difficulty
                q, err = _validate_mcq(q)
                if err:
                    warnings.append(f'Skipped invalid question: {err}')
                    continue
                questions.append(q)

            if not auto_question_count:
                remaining = question_count - len(questions)
            _update_job(job_id, done_chunks=i + 1, questions_created=len(questions), warnings=warnings)
            if _is_cancelled():
                _update_job(job_id, status='cancelled', phase='Cancelled by user.')
                return

        # de-dupe by prompt
        seen_prompts: set[str] = set()
        deduped: list[dict] = []
        dedup_limit = len(questions) if auto_question_count else question_count
        for q in questions:
            p = re.sub(r'\s+', ' ', str(q.get('prompt') or '').strip()).lower()
            if not p or p in seen_prompts:
                continue
            seen_prompts.add(p)
            deduped.append(q)
            if len(deduped) >= dedup_limit:
                break

        if not deduped:
            _update_job(job_id, status='error', error='No valid questions were generated from the provided text.')
            return

        _update_job(job_id, phase='Saving to question bank…')
        created_ids: list[str] = []

        db = SessionLocal()
        try:
            set_tenant_id(db, tenant_id)
            for q in deduped:
                if category_id is not None:
                    q['category_id'] = category_id
                created = assessment_service.create_question(db, payload=q, actor_user_id=user_id)
                created_ids.append(str(created.id))

            audit_service.log_action(
                db,
                actor_user_id=user_id,
                action='assessment_questions_import_text',
                entity_type='assessment_question',
                details={
                    'imported_count': len(created_ids),
                    'question_count_requested': question_count,
                    'tags': merged_tags,
                    'difficulty': difficulty,
                },
            )
            usage_service.record_event(
                db,
                tenant_id=tenant_db_id,
                event_key='ai.text_import',
                quantity=float(len(created_ids)),
                actor_user_id=user_id,
                meta={'question_count_requested': question_count},
            )
            db.commit()
        finally:
            db.close()

        _update_job(
            job_id,
            status='done',
            phase='Done',
            done_chunks=len(text_chunks),
            questions_created=len(created_ids),
            imported_count=len(created_ids),
            question_ids=created_ids,
            warnings=warnings,
        )

    except Exception as exc:  # noqa: BLE001
        _update_job(job_id, status='error', error=str(exc))


@router.post('/questions/import-text', response_model=AssessmentTextImportJobStart, status_code=status.HTTP_202_ACCEPTED)
def import_questions_from_text(
    body: AssessmentTextImportIn,
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
    ctx: TenantContext = Depends(require_tenant_membership),
) -> AssessmentTextImportJobStart:
    raw_text = body.text.strip()
    if len(raw_text) < 50:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail='Text is too short to generate questions from.')

    question_count = body.question_count
    difficulty = (body.difficulty or '').strip() or None
    base_tags = _normalize_tags(body.tags)
    merged_tags = _normalize_tags(','.join([*base_tags, 'text_import']))

    text_chunks = _split_text_chunks(raw_text)
    if not text_chunks:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail='No usable text found.')

    # Resolve optional category path → UUID (creating hierarchy if needed).
    category_id: UUID | None = None
    if body.category_path and body.category_path.strip():
        from app.db.session import SessionLocal as _SL, set_tenant_id as _sti  # noqa: PLC0415
        _cat_db = _SL()
        try:
            _sti(_cat_db, str(ctx.tenant.id))
            category_id = assessment_service.find_or_create_category_path(_cat_db, body.category_path.strip())
            _cat_db.commit()
        finally:
            _cat_db.close()

    job_id = str(uuid4())
    _write_job(job_id, {
        'job_id': job_id,
        'status': 'running',
        'total_chunks': len(text_chunks),
        'done_chunks': 0,
        'phase': 'Starting…',
        'questions_created': 0,
        'cancel_requested': False,
        'warnings': [],
        'error': None,
        'imported_count': None,
        'question_ids': None,
    })

    t = threading.Thread(
        target=_run_text_import_job,
        args=(job_id, text_chunks, question_count, merged_tags, difficulty, str(ctx.tenant.id), current_user.id, ctx.tenant.id),
        kwargs={
            'category_id': category_id,
            'extra_instructions': body.extra_instructions,
            'material_context': body.material_context,
            'auto_question_count': body.auto_question_count,
        },
        daemon=True,
    )
    t.start()

    return AssessmentTextImportJobStart(job_id=job_id, status='running', total_chunks=len(text_chunks))


@router.get('/questions/import-jobs/{job_id}', response_model=AssessmentTextImportJobStatus)
def get_text_import_job(
    job_id: str,
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> AssessmentTextImportJobStatus:
    job = _read_job(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Import job not found.')
    total = job.get('total_chunks', 1)
    done = job.get('done_chunks', 0)
    percent = 100 if job.get('status') == 'done' else (0 if total == 0 else int(done * 100 / total))
    return AssessmentTextImportJobStatus(
        job_id=job['job_id'],
        status=job['status'],
        total_chunks=total,
        done_chunks=done,
        percent=percent,
        phase=job.get('phase', ''),
        questions_created=job.get('questions_created', 0),
        cancel_requested=bool(job.get('cancel_requested', False)),
        warnings=job.get('warnings', []),
        error=job.get('error'),
        imported_count=job.get('imported_count'),
        question_ids=job.get('question_ids'),
    )


@router.post('/questions/import-jobs/{job_id}/cancel', status_code=status.HTTP_204_NO_CONTENT)
def cancel_text_import_job(
    job_id: str,
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> None:
    job = _read_job(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Import job not found.')
    if job.get('status') not in ('running',):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f'Job is already {job["status"]}.')
    _update_job(job_id, cancel_requested=True, phase='Cancellation requested…')
    return None


@router.get('/questions', response_model=AssessmentQuestionListResponse)
def list_questions(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=10000),
    status_filter: str | None = Query(default=None, alias='status'),
    query: str | None = Query(default=None, alias='q'),
    tag: str | None = Query(default=None),
    difficulty: str | None = Query(default=None),
    category: str | None = Query(default=None),
    sort_by: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_access('assessments', 'assessments:read')),
) -> AssessmentQuestionListResponse:
    status_filters = _split_csv(status_filter)
    difficulties = _split_csv(difficulty)
    tags = _split_csv(tag)
    categories = _split_csv(category)
    items, total = assessment_service.list_questions(
        db,
        tenant_id=ctx.tenant.id,
        page=page,
        page_size=page_size,
        status_filters=status_filters,
        query=query,
        tags=tags,
        difficulties=difficulties,
        categories=categories,
        sort_by=sort_by,
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
    return AssessmentCategoryListResponse(items=list(items))


@router.get('/categories/tree', response_model=AssessmentCategoryTreeResponse)
def list_categories_tree(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:read')),
) -> AssessmentCategoryTreeResponse:
    all_cats = assessment_service.list_categories(db)
    # Build tree: parents first, then attach children
    parents: list[AssessmentCategoryTreeNode] = []
    children_map: dict[str, list[AssessmentCategoryTreeNode]] = {}

    for cat in all_cats:
        node = AssessmentCategoryTreeNode(
            id=cat.id,
            name=cat.name,
            slug=cat.slug,
            parent_id=cat.parent_id,
            children=[],
        )
        if cat.parent_id is None:
            parents.append(node)
        else:
            pid = str(cat.parent_id)
            children_map.setdefault(pid, []).append(node)

    for parent in parents:
        parent.children = sorted(
            children_map.get(str(parent.id), []),
            key=lambda n: n.name,
        )

    # Orphan children (parent not in list) are appended as top-level
    parent_ids = {str(p.id) for p in parents}
    for pid, nodes in children_map.items():
        if pid not in parent_ids:
            parents.extend(nodes)

    return AssessmentCategoryTreeResponse(items=sorted(parents, key=lambda n: n.name))


# ---------------------------------------------------------------------------
# Category CRUD
# ---------------------------------------------------------------------------

@router.post('/categories', response_model=AssessmentCategoryOut, status_code=201)
def create_category(
    payload: AssessmentCategoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> AssessmentCategoryOut:
    cat = assessment_service.create_category(db, name=payload.name, slug=payload.slug, parent_id=payload.parent_id)
    audit_service.log_action(db, actor_user_id=current_user.id, action='create', entity_type='assessment_category', entity_id=str(cat.id), details={'name': cat.name, 'slug': cat.slug})
    db.commit()
    counts = assessment_service.category_question_counts(db)
    out = AssessmentCategoryOut.model_validate(cat)
    out.question_count = counts.get(str(cat.id), 0)
    out.children_count = len(cat.children)
    return out


@router.get('/categories/{category_id}', response_model=AssessmentCategoryOut)
def get_category(
    category_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:read')),
) -> AssessmentCategoryOut:
    cat = assessment_service.get_category(db, category_id)
    counts = assessment_service.category_question_counts(db)
    out = AssessmentCategoryOut.model_validate(cat)
    out.question_count = counts.get(str(cat.id), 0)
    out.children_count = len(cat.children)
    return out


@router.put('/categories/{category_id}', response_model=AssessmentCategoryOut)
def update_category(
    category_id: UUID,
    payload: AssessmentCategoryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> AssessmentCategoryOut:
    data = payload.model_dump(exclude_unset=True)
    cat = assessment_service.update_category(db, category_id, data)
    audit_service.log_action(db, actor_user_id=current_user.id, action='update', entity_type='assessment_category', entity_id=str(cat.id), details=data)
    db.commit()
    counts = assessment_service.category_question_counts(db)
    out = AssessmentCategoryOut.model_validate(cat)
    out.question_count = counts.get(str(cat.id), 0)
    out.children_count = len(cat.children)
    return out


@router.delete('/categories/{category_id}', status_code=204)
def delete_category(
    category_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> None:
    assessment_service.delete_category(db, category_id)
    audit_service.log_action(db, actor_user_id=current_user.id, action='delete', entity_type='assessment_category', entity_id=str(category_id), details={})
    db.commit()


@router.post('/categories/{category_id}/merge', response_model=AssessmentCategoryOut)
def merge_category(
    category_id: UUID,
    payload: AssessmentCategoryMergeIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> AssessmentCategoryOut:
    """Merge payload.target_id INTO category_id. Target is deleted; category_id survives."""
    assessment_service.merge_categories(db, source_id=payload.target_id, target_id=category_id)
    audit_service.log_action(db, actor_user_id=current_user.id, action='merge', entity_type='assessment_category', entity_id=str(category_id), details={'merged_from': str(payload.target_id)})
    db.commit()
    cat = assessment_service.get_category(db, category_id)
    counts = assessment_service.category_question_counts(db)
    out = AssessmentCategoryOut.model_validate(cat)
    out.question_count = counts.get(str(cat.id), 0)
    out.children_count = len(cat.children)
    return out


@router.get('/questions/stats', response_model=AssessmentQuestionStatsOut)
def question_stats(
    status_filter: str | None = Query(default=None, alias='status'),
    query: str | None = Query(default=None, alias='q'),
    tag: str | None = Query(default=None),
    difficulty: str | None = Query(default=None),
    category: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_access('assessments', 'assessments:read')),
) -> AssessmentQuestionStatsOut:
    status_filters = _split_csv(status_filter)
    difficulties = _split_csv(difficulty)
    tags = _split_csv(tag)
    categories = _split_csv(category)
    data = assessment_service.question_stats(
        db,
        tenant_id=ctx.tenant.id,
        status_filters=status_filters,
        query=query,
        tags=tags,
        difficulties=difficulties,
        categories=categories,
    )
    return AssessmentQuestionStatsOut(**data)  # type: ignore[arg-type]


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
    if payload.scope not in ('all_matching', 'selected'):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid classification scope')
    if payload.scope == 'selected' and not payload.question_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='question_ids required for selected scope')

    existing = db.scalar(
        select(AssessmentClassificationJob)
        .where(
            AssessmentClassificationJob.tenant_id == ctx.tenant.id,
            AssessmentClassificationJob.status.in_(['queued', 'running', 'paused']),
        )
        .order_by(AssessmentClassificationJob.created_at.desc())
    )
    if existing:
        # If the worker appears dead (no heartbeat for 2 min), expire it so a fresh run can start.
        # Otherwise return the live job so the UI can attach and poll.
        heartbeat_cutoff = datetime.now(timezone.utc) - timedelta(minutes=2)
        worker_is_dead = (
            existing.last_heartbeat_at is None
            or existing.last_heartbeat_at < heartbeat_cutoff
        )
        if worker_is_dead:
            existing.status = 'failed'
            existing.error_summary = 'Expired stale job (worker unresponsive for 2+ minutes). Re-running.'
            existing.updated_by = current_user.id
            db.commit()
        else:
            return AssessmentClassificationJobOut.model_validate(existing)

    job = AssessmentClassificationJob(
        tenant_id=ctx.tenant.id,
        status='queued',
        total=0,
        processed=0,
        mode=payload.mode,
        dry_run=bool(payload.dry_run),
        batch_size=int(payload.batch_size),
        scope_json={
            'scope': payload.scope,
            'question_ids': [str(x) for x in (payload.question_ids or [])],
            'filters': {
                'status': payload.status,
                'q': payload.q,
                'tag': payload.tag,
                'difficulty': payload.difficulty,
                'category': payload.category,
            },
        },
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


@router.get('/questions/classify/jobs/latest', response_model=AssessmentClassificationJobOut)
def latest_classification_job(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assessments', 'assessments:read')),
) -> AssessmentClassificationJobOut:
    job = db.scalar(
        select(AssessmentClassificationJob)
        .where(AssessmentClassificationJob.tenant_id == ctx.tenant.id)
        .order_by(AssessmentClassificationJob.created_at.desc())
    )
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='No classification jobs found')
    return AssessmentClassificationJobOut.model_validate(job)


@router.get('/questions/classify/jobs/{job_id}', response_model=AssessmentClassificationJobOut)
def get_classification_job(
    job_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    ___: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assessments', 'assessments:read')),
) -> AssessmentClassificationJobOut:
    job = db.scalar(select(AssessmentClassificationJob).where(AssessmentClassificationJob.id == job_id))
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Classification job not found')
    return AssessmentClassificationJobOut.model_validate(job)


@router.get('/questions/classify/jobs/{job_id}/items', response_model=AssessmentClassificationJobItemListResponse)
def list_classification_job_items(
    job_id: UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    ___: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assessments', 'assessments:read')),
) -> AssessmentClassificationJobItemListResponse:
    offset = (page - 1) * page_size
    total = db.scalar(
        select(func.count()).select_from(
            select(AssessmentClassificationJobItem.id)
            .where(AssessmentClassificationJobItem.job_id == job_id)
            .subquery()
        )
    )
    rows = db.scalars(
        select(AssessmentClassificationJobItem)
        .where(AssessmentClassificationJobItem.job_id == job_id)
        .order_by(AssessmentClassificationJobItem.created_at.asc())
        .offset(offset)
        .limit(page_size)
    ).all()
    return AssessmentClassificationJobItemListResponse(
        items=[AssessmentClassificationJobItemOut.model_validate(r) for r in rows],
        meta=PaginationMeta(page=page, page_size=page_size, total=int(total or 0)),
    )


@router.post('/questions/classify/jobs/{job_id}/cancel')
def cancel_classification_job(
    job_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> dict[str, str]:
    _ = ctx
    job = db.scalar(select(AssessmentClassificationJob).where(AssessmentClassificationJob.id == job_id))
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Classification job not found')
    if job.status not in ('queued', 'running', 'paused'):
        return {'status': 'noop'}
    # If the worker is stale (no heartbeat in 30s), force-cancel immediately —
    # the background task is dead and won't pick up cancel_requested on its own.
    heartbeat_cutoff = datetime.now(timezone.utc) - timedelta(seconds=30)
    worker_is_dead = (
        job.last_heartbeat_at is None
        or job.last_heartbeat_at < heartbeat_cutoff
    )
    if worker_is_dead:
        job.status = 'canceled'
        job.error_summary = 'Cancelled by user (worker was unresponsive).'
        job.completed_at = datetime.now(timezone.utc)
    else:
        job.cancel_requested = True
    job.updated_by = current_user.id
    db.commit()
    return {'status': 'ok'}


@router.post('/questions/classify/jobs/{job_id}/pause')
def pause_classification_job(
    job_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> dict[str, str]:
    _ = ctx
    job = db.scalar(select(AssessmentClassificationJob).where(AssessmentClassificationJob.id == job_id))
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Classification job not found')
    if job.status not in ('queued', 'running', 'paused'):
        return {'status': 'noop'}
    job.pause_requested = True
    job.updated_by = current_user.id
    db.commit()
    return {'status': 'ok'}


@router.post('/questions/classify/jobs/{job_id}/resume')
def resume_classification_job(
    job_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> dict[str, str]:
    _ = ctx
    job = db.scalar(select(AssessmentClassificationJob).where(AssessmentClassificationJob.id == job_id))
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Classification job not found')
    if job.status not in ('queued', 'running', 'paused'):
        return {'status': 'noop'}
    job.pause_requested = False
    job.updated_by = current_user.id
    db.commit()
    return {'status': 'ok'}


@router.post('/questions/classify/jobs/{job_id}/apply')
def apply_classification_job(
    job_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> dict[str, int]:
    _ = ctx
    job = db.scalar(select(AssessmentClassificationJob).where(AssessmentClassificationJob.id == job_id))
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Classification job not found')
    if job.status != 'completed':
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Job is not completed')
    if not job.dry_run:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Job is not a dry run')

    applied = assessment_classification_service.apply_job_items(
        db,
        job_id=job.id,
        actor_user_id=current_user.id,
        tenant_id=ctx.tenant.id,
    )
    job.applied_at = datetime.now(timezone.utc)
    job.updated_by = current_user.id
    db.commit()
    return {'applied': applied}


@router.post('/questions/classify/jobs/{job_id}/rollback')
def rollback_classification_job(
    job_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> dict[str, int]:
    _ = ctx
    job = db.scalar(select(AssessmentClassificationJob).where(AssessmentClassificationJob.id == job_id))
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Classification job not found')
    if job.status != 'completed':
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Job is not completed')

    rolled_back = assessment_classification_service.rollback_job_items(
        db,
        job_id=job.id,
        actor_user_id=current_user.id,
    )
    job.rolled_back_at = datetime.now(timezone.utc)
    job.updated_by = current_user.id
    db.commit()
    return {'rolled_back': rolled_back}


@router.post('/questions/bulk-update', response_model=AssessmentBulkUpdateResult)
def bulk_update_questions(
    payload: AssessmentQuestionsBulkUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> AssessmentBulkUpdateResult:
    # Ensure tenant context set for RLS-protected updates.
    _ = ctx
    updated = assessment_service.bulk_update_questions(
        db,
        actor_user_id=current_user.id,
        scope=payload.scope,
        question_ids=list(payload.question_ids or []),
        status_filters=_split_csv(payload.status),
        query=payload.q,
        tags=_split_csv(payload.tag),
        difficulties=_split_csv(payload.difficulty),
        categories=_split_csv(payload.category),
        action=payload.action,
        status_value=payload.status_value,
        category_id=payload.category_id,
        difficulty_value=payload.difficulty_value,
        tags_value=list(payload.tags_value or []),
    )
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='assessment_questions_bulk_update',
        entity_type='assessment_question',
        details={
            'scope': payload.scope,
            'action': payload.action,
            'updated_count': updated,
        },
    )
    db.commit()
    return AssessmentBulkUpdateResult(updated_count=updated)


@router.post('/questions/deduplicate', response_model=AssessmentDeduplicateResult)
def deduplicate_questions(
    dry_run: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> AssessmentDeduplicateResult:
    """Find questions with identical prompts (after normalisation) and archive the extras.

    Keeps the 'best' copy per group: prefers questions with both category and difficulty
    set; among equals keeps the oldest (created_at ASC). Operates only on non-archived questions.
    """
    from app.models.assessment import AssessmentQuestion as AQ

    # Load all non-archived questions — just the columns we need for grouping.
    rows = db.execute(
        select(AQ.id, AQ.prompt, AQ.category_id, AQ.difficulty, AQ.created_at)
        .where(AQ.status != 'archived')
        .order_by(AQ.created_at.asc())
    ).all()

    # Group by normalised prompt
    groups: dict[str, list] = {}
    for row in rows:
        key = re.sub(r'\s+', ' ', (row.prompt or '').strip().lower())
        if not key:
            continue
        groups.setdefault(key, []).append(row)

    duplicate_groups = 0
    ids_to_archive: list = []

    for norm_prompt, candidates in groups.items():
        if len(candidates) < 2:
            continue
        duplicate_groups += 1

        # Sort: fully classified first, then by age (oldest first → keep oldest)
        def _score(r) -> tuple:
            has_cat = r.category_id is not None
            has_diff = r.difficulty is not None
            return (0 if (has_cat and has_diff) else 1 if (has_cat or has_diff) else 2, r.created_at)

        sorted_candidates = sorted(candidates, key=_score)
        # Keep the first (best / oldest), archive the rest
        ids_to_archive.extend(c.id for c in sorted_candidates[1:])

    archived_count = len(ids_to_archive)

    if not dry_run and ids_to_archive:
        db.execute(
            select(AQ).where(AQ.id.in_(ids_to_archive))  # warm identity map
        )
        db.query(AQ).filter(AQ.id.in_(ids_to_archive)).update(
            {'status': 'archived', 'updated_by': current_user.id},
            synchronize_session='fetch',
        )
        audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action='assessment_questions_deduplicate',
            entity_type='assessment_question',
            details={'archived_count': archived_count, 'duplicate_groups': duplicate_groups},
        )
        db.commit()

    return AssessmentDeduplicateResult(
        duplicate_groups=duplicate_groups,
        archived_count=archived_count,
        dry_run=dry_run,
    )


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


@router.get('/tests/{test_id}/versions', response_model=AssessmentTestVersionHistoryResponse)
def list_test_versions(
    test_id: UUID,
    include_archived: bool = Query(default=False),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:read')),
) -> AssessmentTestVersionHistoryResponse:
    items = assessment_service.list_test_versions(db, test_id=test_id, include_archived=include_archived)
    return AssessmentTestVersionHistoryResponse(items=items)


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


def _version_summary(version: AssessmentTestVersion) -> dict[str, object]:
    return {
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
    }


@router.delete('/tests/{test_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_test(
    test_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> Response:
    test = assessment_service.get_test(db, test_id)
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='assessment_test_delete',
        entity_type='assessment_test',
        entity_id=test.id,
        details={'title': test.title},
    )
    db.delete(test)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post('/tests/{test_id}/versions', response_model=AssessmentTestVersionOut, status_code=status.HTTP_201_CREATED)
def create_test_version(
    test_id: UUID,
    summary: bool = Query(default=False),
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
    if summary:
        return JSONResponse(content=jsonable_encoder(_version_summary(version)))
    return AssessmentTestVersionOut.model_validate(version)


@router.put('/test-versions/{version_id}', response_model=AssessmentTestVersionOut)
def update_test_version(
    version_id: UUID,
    payload: AssessmentTestVersionUpdate,
    summary: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_access('assessments', 'assessments:write')),
) -> AssessmentTestVersionOut:
    version = assessment_service.update_test_version(
        db,
        version_id=version_id,
        payload=payload.model_dump(exclude_unset=True),
        actor_user_id=current_user.id,
        tenant_id=ctx.tenant.id,
        load_questions=not summary,
    )
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='assessment_test_version_update',
        entity_type='assessment_test_version',
        entity_id=version.id,
    )
    db.commit()
    if summary:
        return JSONResponse(content=jsonable_encoder(_version_summary(version)))
    return AssessmentTestVersionOut.model_validate(version)


@router.post('/test-versions/{version_id}/archive', response_model=AssessmentTestVersionOut)
def archive_test_version(
    version_id: UUID,
    summary: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> AssessmentTestVersionOut:
    version = assessment_service.set_test_version_archived(
        db,
        version_id=version_id,
        actor_user_id=current_user.id,
        archived=True,
    )
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='assessment_test_version_archive',
        entity_type='assessment_test_version',
        entity_id=version.id,
    )
    db.commit()
    if summary:
        return JSONResponse(content=jsonable_encoder(_version_summary(version)))
    return AssessmentTestVersionOut.model_validate(version)


@router.post('/test-versions/{version_id}/unarchive', response_model=AssessmentTestVersionOut)
def unarchive_test_version(
    version_id: UUID,
    summary: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> AssessmentTestVersionOut:
    version = assessment_service.set_test_version_archived(
        db,
        version_id=version_id,
        actor_user_id=current_user.id,
        archived=False,
    )
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='assessment_test_version_unarchive',
        entity_type='assessment_test_version',
        entity_id=version.id,
    )
    db.commit()
    if summary:
        return JSONResponse(content=jsonable_encoder(_version_summary(version)))
    return AssessmentTestVersionOut.model_validate(version)


@router.delete('/test-versions/{version_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_test_version(
    version_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> Response:
    assessment_service.delete_test_version(db, version_id=version_id)
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='assessment_test_version_delete',
        entity_type='assessment_test_version',
        entity_id=version_id,
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post('/test-versions/{version_id}/publish', response_model=AssessmentTestVersionOut)
def publish_test_version(
    version_id: UUID,
    summary: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> AssessmentTestVersionOut:
    version = assessment_service.publish_test_version(
        db,
        version_id=version_id,
        actor_user_id=current_user.id,
        load_questions=not summary,
    )
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='assessment_test_version_publish',
        entity_type='assessment_test_version',
        entity_id=version.id,
    )
    db.commit()
    if summary:
        return JSONResponse(content=jsonable_encoder(_version_summary(version)))
    return AssessmentTestVersionOut.model_validate(version)


@router.get('/available')
def list_available_assessments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assessments', 'assessments:take')),
):
    now = datetime.now(timezone.utc)
    window_open = or_(AssessmentDelivery.starts_at.is_(None), AssessmentDelivery.starts_at <= now)
    window_close = or_(AssessmentDelivery.ends_at.is_(None), AssessmentDelivery.ends_at >= now)
    visible = or_(
        AssessmentDelivery.participant_user_id == current_user.id,
        AssessmentDelivery.audience_type == 'campaign',
    )
    base = (
        select(AssessmentDelivery)
        .where(
            AssessmentDelivery.tenant_id == ctx.tenant.id,  # tenant isolation
            visible,
            window_open,
            window_close,
        )
        .options(joinedload(AssessmentDelivery.test_version), joinedload(AssessmentDelivery.attempts))
        .order_by(AssessmentDelivery.created_at.desc())
    )
    deliveries = db.scalars(base).unique().all()

    items = []
    for d in deliveries:
        user_attempts = [a for a in d.attempts if a.user_id == current_user.id]
        latest = max(user_attempts, key=lambda a: a.attempt_number, default=None)
        completed = any(a.status in ('submitted', 'scored') for a in user_attempts)
        in_progress = any(a.status == 'in_progress' for a in user_attempts)
        passed = any(getattr(a, 'passed', False) for a in user_attempts)
        attempt_status = 'not_started'
        if passed:
            attempt_status = 'passed'
        elif completed:
            attempt_status = 'completed'
        elif in_progress:
            attempt_status = 'in_progress'

        test = None
        if d.test_version and d.test_version.test_id:
            from app.models.assessment import AssessmentTest
            test = db.scalar(select(AssessmentTest).where(AssessmentTest.id == d.test_version.test_id))

        items.append({
            'delivery_id': str(d.id),
            'title': d.title,
            'description': test.description if test else None,
            'test_title': test.title if test else d.title,
            'audience_type': d.audience_type,
            'starts_at': d.starts_at.isoformat() if d.starts_at else None,
            'ends_at': d.ends_at.isoformat() if d.ends_at else None,
            'due_date': d.due_date.isoformat() if d.due_date else None,
            'duration_minutes': d.duration_minutes,
            'attempts_allowed': d.attempts_allowed,
            'attempts_used': len(user_attempts),
            'attempt_status': attempt_status,
            'latest_score_percent': latest.score_percent if latest and latest.score_percent is not None else None,
            'passed': passed,
            'question_count': len(d.test_version.questions) if d.test_version else 0,
            'passing_score': d.test_version.passing_score if d.test_version else None,
            'in_progress_attempt_id': latest.id if latest and latest.status == 'in_progress' else None,
        })

    return {'items': items}


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
    assessment_service.send_delivery_assignment_email(
        db,
        delivery_id=delivery.id,
        actor_user_id=current_user.id,
    )
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
    perms = permissions_for_roles(ctx.roles)
    if 'assessments:write' not in perms and delivery.participant_user_id not in (None, current_user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Forbidden delivery')
    return AssessmentDeliveryOut.model_validate(delivery)


@router.patch('/deliveries/{delivery_id}', response_model=AssessmentDeliveryOut)
def update_delivery(
    delivery_id: UUID,
    payload: AssessmentDeliveryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> AssessmentDeliveryOut:
    delivery = db.scalar(select(AssessmentDelivery).where(AssessmentDelivery.id == delivery_id))
    if not delivery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Delivery not found')
    delivery.starts_at = payload.starts_at
    delivery.ends_at = payload.ends_at
    delivery.due_date = payload.due_date
    delivery.attempts_allowed = payload.attempts_allowed
    if payload.duration_minutes is not None:
        delivery.duration_minutes = payload.duration_minutes
    else:
        delivery.duration_minutes = None
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='assessment_delivery_update',
        entity_type='assessment_delivery',
        entity_id=delivery.id,
    )
    db.commit()
    db.refresh(delivery)
    return AssessmentDeliveryOut.model_validate(delivery)


@router.post('/deliveries/{delivery_id}/stop', response_model=AssessmentDeliveryOut)
def stop_delivery(
    delivery_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> AssessmentDeliveryOut:
    """Immediately close a delivery by setting ends_at to now."""
    delivery = db.scalar(select(AssessmentDelivery).where(AssessmentDelivery.id == delivery_id))
    if not delivery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Delivery not found')
    delivery.ends_at = datetime.now(timezone.utc)
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='assessment_delivery_stop',
        entity_type='assessment_delivery',
        entity_id=delivery.id,
    )
    db.commit()
    db.refresh(delivery)
    return AssessmentDeliveryOut.model_validate(delivery)


@router.post('/deliveries/{delivery_id}/attempts/start', response_model=AssessmentAttemptStartOut)
def start_attempt(
    delivery_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assessments', 'assessments:take')),
) -> AssessmentAttemptStartOut:
    attempt = assessment_service.start_attempt(db, delivery_id=delivery_id, user_id=current_user.id)
    # Load the delivery and version while the RLS tenant context is still active
    # (set_config 'app.tenant_id' is transaction-local — it clears after commit).
    delivery = assessment_service.get_delivery(db, delivery_id)
    version = assessment_service.get_test_version(db, delivery.test_version_id)
    questions = assessment_service._build_attempt_questions(version, attempt.question_order)
    # Snapshot the attempt fields before commit (expire_on_commit=False keeps them after commit).
    attempt_out = AssessmentAttemptOut.model_validate(attempt)
    db.commit()
    return AssessmentAttemptStartOut(attempt=attempt_out, questions=questions)


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
    perms = permissions_for_roles(ctx.roles)
    if 'assessments:write' not in perms and attempt.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Not allowed to edit this attempt')

    assessment_service.autosave_answers(
        db,
        attempt_id=attempt_id,
        answers=[a.model_dump() for a in payload.answers],
        actor_user_id=current_user.id,
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
    perms = permissions_for_roles(ctx.roles)
    if 'assessments:write' not in perms and attempt.user_id != current_user.id:
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


@router.get('/attempts/{attempt_id}/review', response_model=AttemptReviewOut)
def get_attempt_review(
    attempt_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assessments', 'assessments:take')),
) -> AttemptReviewOut:
    perms = permissions_for_roles(ctx.roles)
    is_admin = 'assessments:write' in perms
    review = assessment_service.get_attempt_review(
        db,
        attempt_id=attempt_id,
        requesting_user_id=current_user.id,
        tenant_id=ctx.tenant.id,
        is_admin=is_admin,
    )
    return AttemptReviewOut(**review)


@router.get('/my-results', response_model=MyResultsResponse)
def list_my_results(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assessments', 'assessments:take')),
) -> MyResultsResponse:
    """Personal test history for the currently authenticated user — scoped to this tenant."""
    items_raw = assessment_service.list_my_results(db, user_id=current_user.id, tenant_id=ctx.tenant.id)
    items = [MyResultAttemptOut(**item) for item in items_raw]
    scores = [i.score_percent for i in items if i.score_percent is not None]
    avg = (sum(scores) / len(scores)) if scores else None
    pass_count = sum(1 for i in items if i.passed and i.status == 'scored')
    fail_count = sum(1 for i in items if not i.passed and i.status == 'scored')
    return MyResultsResponse(
        items=items,
        total_attempts=len(items),
        average_score_percent=avg,
        pass_count=pass_count,
        fail_count=fail_count,
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
    perms = permissions_for_roles(ctx.roles)
    effective_user_id = user_id
    if 'assessments:write' not in perms and 'assignments:review' not in perms:
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


# ---------------------------------------------------------------------------
# AI Import Templates  — per-tenant CRUD
# ---------------------------------------------------------------------------

@router.get('/ai-import-templates', response_model=list[AiImportTemplateOut])
def list_ai_import_templates(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> list[AiImportTemplateOut]:
    from sqlalchemy import select as _select  # noqa: PLC0415
    rows = db.scalars(
        _select(AiImportTemplate)
        .where(AiImportTemplate.tenant_id == ctx.tenant.id)
        .order_by(AiImportTemplate.sort_order, AiImportTemplate.name)
    ).all()
    return [AiImportTemplateOut.model_validate(r) for r in rows]


@router.post('/ai-import-templates', response_model=AiImportTemplateOut, status_code=status.HTTP_201_CREATED)
def create_ai_import_template(
    body: AiImportTemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> AiImportTemplateOut:
    from datetime import datetime, timezone  # noqa: PLC0415
    now = datetime.now(timezone.utc)
    row = AiImportTemplate(
        tenant_id=ctx.tenant.id,
        name=body.name,
        context_placeholder=body.context_placeholder,
        extra_instructions=body.extra_instructions,
        auto_question_count=body.auto_question_count,
        sort_order=body.sort_order,
        created_by=current_user.id,
        updated_by=current_user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return AiImportTemplateOut.model_validate(row)


@router.put('/ai-import-templates/{template_id}', response_model=AiImportTemplateOut)
def update_ai_import_template(
    template_id: UUID,
    body: AiImportTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> AiImportTemplateOut:
    from datetime import datetime, timezone  # noqa: PLC0415
    from sqlalchemy import select as _select  # noqa: PLC0415
    row = db.scalars(
        _select(AiImportTemplate)
        .where(AiImportTemplate.id == template_id, AiImportTemplate.tenant_id == ctx.tenant.id)
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Template not found')
    if body.name is not None:
        row.name = body.name
    if body.context_placeholder is not None:
        row.context_placeholder = body.context_placeholder
    if body.extra_instructions is not None:
        row.extra_instructions = body.extra_instructions
    if body.auto_question_count is not None:
        row.auto_question_count = body.auto_question_count
    if body.sort_order is not None:
        row.sort_order = body.sort_order
    row.updated_by = current_user.id
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return AiImportTemplateOut.model_validate(row)


@router.delete('/ai-import-templates/{template_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_ai_import_template(
    template_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assessments', 'assessments:write')),
) -> None:
    from sqlalchemy import select as _select  # noqa: PLC0415
    row = db.scalars(
        _select(AiImportTemplate)
        .where(AiImportTemplate.id == template_id, AiImportTemplate.tenant_id == ctx.tenant.id)
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Template not found')
    db.delete(row)
    db.commit()
