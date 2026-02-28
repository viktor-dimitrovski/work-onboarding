from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import BaseSchema, PaginationMeta


class AssessmentQuestionOptionCreate(BaseModel):
    option_text: str = Field(min_length=1)
    is_correct: bool = False
    order_index: int = Field(default=0, ge=0)


class AssessmentQuestionCreate(BaseModel):
    prompt: str = Field(min_length=1)
    question_type: str
    difficulty: str | None = None
    category_id: UUID | None = None
    tags: list[str] = Field(default_factory=list)
    status: str = Field(default='draft')
    explanation: str | None = None
    options: list[AssessmentQuestionOptionCreate] = Field(default_factory=list)


class AssessmentQuestionUpdate(BaseModel):
    prompt: str | None = None
    question_type: str | None = None
    difficulty: str | None = None
    category_id: UUID | None = None
    tags: list[str] | None = None
    status: str | None = None
    explanation: str | None = None
    options: list[AssessmentQuestionOptionCreate] | None = None


class AssessmentQuestionOptionOut(BaseSchema):
    id: UUID
    option_text: str
    is_correct: bool
    order_index: int
    created_at: datetime
    updated_at: datetime


class AssessmentCategoryOut(BaseSchema):
    id: UUID
    name: str
    slug: str
    created_at: datetime
    updated_at: datetime


class AssessmentQuestionOut(BaseSchema):
    id: UUID
    prompt: str
    question_type: str
    difficulty: str | None
    category_id: UUID | None = None
    category: AssessmentCategoryOut | None = None
    tags: list[str]
    status: str
    explanation: str | None
    options: list[AssessmentQuestionOptionOut]
    created_at: datetime
    updated_at: datetime


class AssessmentQuestionListResponse(BaseModel):
    items: list[AssessmentQuestionOut]
    meta: PaginationMeta


class AssessmentCategoryListResponse(BaseModel):
    items: list[AssessmentCategoryOut]


class AssessmentClassificationJobCreate(BaseModel):
    mode: str = Field(default='unclassified_only')
    dry_run: bool = False
    batch_size: int = Field(default=25, ge=5, le=50)
    scope: str = Field(default='all_matching')  # all_matching | selected
    question_ids: list[UUID] = Field(default_factory=list)
    # Optional filters (same as list endpoint). Used when scope=all_matching and caller wants "current filters only".
    status: str | None = None
    q: str | None = None
    tag: str | None = None
    difficulty: str | None = None
    category: str | None = None


class AssessmentClassificationJobOut(BaseSchema):
    id: UUID
    status: str
    total: int
    processed: int
    error_summary: str | None
    report_json: dict[str, Any] = Field(default_factory=dict)
    mode: str | None = None
    dry_run: bool | None = None
    batch_size: int | None = None
    scope_json: dict[str, Any] = Field(default_factory=dict)
    cancel_requested: bool | None = None
    pause_requested: bool | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    last_heartbeat_at: datetime | None = None
    applied_at: datetime | None = None
    rolled_back_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class AssessmentClassificationJobItemOut(BaseSchema):
    id: UUID
    job_id: UUID
    question_id: UUID
    old_category_id: UUID | None = None
    old_difficulty: str | None = None
    new_category_name: str
    new_category_slug: str
    new_category_id: UUID | None = None
    new_difficulty: str
    applied: bool
    applied_at: datetime | None = None
    error_summary: str | None = None
    created_at: datetime
    updated_at: datetime


class AssessmentClassificationJobItemListResponse(BaseModel):
    items: list[AssessmentClassificationJobItemOut]
    meta: PaginationMeta


class AssessmentQuestionStatsOut(BaseModel):
    total: int
    unclassified_category: int
    unclassified_difficulty: int
    by_status: dict[str, int] = Field(default_factory=dict)
    by_difficulty: dict[str, int] = Field(default_factory=dict)
    by_category: dict[str, int] = Field(default_factory=dict)  # slug -> count; includes 'unclassified'


class AssessmentTagSuggestionOut(BaseModel):
    tag: str
    count: int


class AssessmentTagSuggestionResponse(BaseModel):
    items: list[AssessmentTagSuggestionOut] = Field(default_factory=list)


class AssessmentQuestionsBulkUpdate(BaseModel):
    scope: str = Field(default='selected')  # selected | all_matching
    question_ids: list[UUID] = Field(default_factory=list)
    # Same filter params as list endpoint (used when scope=all_matching)
    status: str | None = None
    q: str | None = None
    tag: str | None = None
    difficulty: str | None = None
    category: str | None = None

    action: str  # set_status | set_category | set_difficulty | add_tags | remove_tags | replace_tags
    status_value: str | None = None
    category_id: UUID | None = None
    difficulty_value: str | None = None
    tags_value: list[str] = Field(default_factory=list)


class AssessmentBulkUpdateResult(BaseModel):
    updated_count: int


class AssessmentPdfImportResponse(BaseModel):
    imported_count: int
    question_ids: list[UUID]
    warnings: list[str] = Field(default_factory=list)


class AssessmentTestCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    category: str | None = None
    role_target: str | None = None


class AssessmentTestUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    category: str | None = None
    role_target: str | None = None
    status: str | None = None
    is_active: bool | None = None


class AssessmentTestVersionQuestionIn(BaseModel):
    question_id: UUID
    order_index: int = Field(ge=0)
    points: int = Field(default=1, ge=1)


class AssessmentTestVersionCreate(BaseModel):
    passing_score: int = Field(default=80, ge=0, le=100)
    time_limit_minutes: int | None = Field(default=None, ge=1)
    shuffle_questions: bool = False
    attempts_allowed: int | None = Field(default=None, ge=1)
    questions: list[AssessmentTestVersionQuestionIn] = Field(default_factory=list)


class AssessmentTestVersionUpdate(BaseModel):
    passing_score: int | None = Field(default=None, ge=0, le=100)
    time_limit_minutes: int | None = Field(default=None, ge=1)
    shuffle_questions: bool | None = None
    attempts_allowed: int | None = Field(default=None, ge=1)
    questions: list[AssessmentTestVersionQuestionIn] | None = None


class AssessmentTestVersionQuestionOut(BaseSchema):
    id: UUID
    question_id: UUID | None
    order_index: int
    points: int
    question_snapshot: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class AssessmentTestVersionOut(BaseSchema):
    id: UUID
    test_id: UUID
    version_number: int
    status: str
    passing_score: int
    time_limit_minutes: int | None
    shuffle_questions: bool
    attempts_allowed: int | None
    published_at: datetime | None
    questions: list[AssessmentTestVersionQuestionOut]
    created_at: datetime
    updated_at: datetime


class AssessmentTestOut(BaseSchema):
    id: UUID
    title: str
    description: str | None
    category: str | None
    role_target: str | None
    status: str
    is_active: bool
    versions: list[AssessmentTestVersionOut]
    created_at: datetime
    updated_at: datetime


class AssessmentTestListResponse(BaseModel):
    items: list[AssessmentTestOut]
    meta: PaginationMeta


class AssessmentDeliveryCreate(BaseModel):
    test_version_id: UUID
    title: str | None = None
    audience_type: str = Field(default='assignment')
    source_assignment_id: UUID | None = None
    source_assignment_task_id: UUID | None = None
    participant_user_id: UUID | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    attempts_allowed: int = Field(default=1, ge=1)
    duration_minutes: int | None = Field(default=None, ge=1)
    due_date: date | None = None


class AssessmentDeliveryOut(BaseSchema):
    id: UUID
    test_version_id: UUID
    title: str
    audience_type: str
    source_assignment_id: UUID | None
    source_assignment_task_id: UUID | None
    participant_user_id: UUID | None
    starts_at: datetime | None
    ends_at: datetime | None
    attempts_allowed: int
    duration_minutes: int | None
    due_date: date | None
    created_at: datetime
    updated_at: datetime


class AssessmentDeliveryListResponse(BaseModel):
    items: list[AssessmentDeliveryOut]
    meta: PaginationMeta


class AssessmentAttemptAnswerIn(BaseModel):
    question_index: int = Field(ge=0)
    selected_option_keys: list[str] = Field(default_factory=list)


class AssessmentAttemptAnswersUpdate(BaseModel):
    answers: list[AssessmentAttemptAnswerIn] = Field(default_factory=list)


class AssessmentAttemptOut(BaseSchema):
    id: UUID
    delivery_id: UUID
    user_id: UUID
    attempt_number: int
    status: str
    started_at: datetime
    submitted_at: datetime | None
    expires_at: datetime | None
    score: float | None
    max_score: float | None
    score_percent: float | None
    passed: bool
    created_at: datetime
    updated_at: datetime


class AssessmentAttemptQuestionOptionOut(BaseModel):
    key: str
    text: str


class AssessmentAttemptQuestionOut(BaseModel):
    index: int
    prompt: str
    question_type: str
    points: int
    options: list[AssessmentAttemptQuestionOptionOut]


class AssessmentAttemptStartOut(BaseModel):
    attempt: AssessmentAttemptOut
    questions: list[AssessmentAttemptQuestionOut]


class AssessmentAttemptSubmitOut(BaseModel):
    attempt: AssessmentAttemptOut
    correct_count: int
    total_questions: int


class AssessmentResultSummary(BaseModel):
    delivery_id: UUID | None
    test_id: UUID | None
    user_id: UUID | None
    attempt_count: int
    average_score_percent: float | None


class AssessmentResultListResponse(BaseModel):
    items: list[AssessmentAttemptOut]
    summary: AssessmentResultSummary
