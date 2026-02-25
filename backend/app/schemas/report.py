from pydantic import BaseModel


class AdminDashboardReport(BaseModel):
    active_onboardings: int
    completion_rate_percent: float
    overdue_tasks: int
    mentor_approval_queue: int


class EmployeeDashboardReport(BaseModel):
    assignment_count: int
    current_phase: str | None
    upcoming_tasks: int
    overdue_tasks: int
    average_progress_percent: float


class MentorDashboardReport(BaseModel):
    mentee_count: int
    pending_reviews: int
    recent_feedback: int
