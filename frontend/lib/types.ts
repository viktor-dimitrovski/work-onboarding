export type RoleName = 'super_admin' | 'admin' | 'mentor' | 'employee' | 'hr_viewer' | 'reviewer';

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  roles: RoleName[];
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: AuthUser;
}

export interface PaginatedMeta {
  page: number;
  page_size: number;
  total: number;
}

export type TenantRole =
  | 'member'
  | 'manager'
  | 'mentor'
  | 'tenant_admin'
  | 'parent'
  | 'student'
  | 'teacher';

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  tenant_type: string;
  is_active: boolean;
}

export interface TenantContext {
  tenant: TenantSummary;
  role?: string | null;
  role_label?: string | null;
  permissions: string[];
  modules: string[];
}

export interface TaskResource {
  id: string;
  resource_type: string;
  title: string;
  content_text?: string | null;
  url?: string | null;
  order_index: number;
  metadata: Record<string, unknown>;
}

export interface TrackTask {
  id: string;
  title: string;
  description?: string | null;
  instructions?: string | null;
  task_type: string;
  required: boolean;
  order_index: number;
  estimated_minutes?: number | null;
  passing_score?: number | null;
  due_days_offset?: number | null;
  metadata: Record<string, unknown>;
  resources: TaskResource[];
}

export interface TrackPhase {
  id: string;
  title: string;
  description?: string | null;
  order_index: number;
  tasks: TrackTask[];
}

export interface TrackVersion {
  id: string;
  version_number: number;
  status: string;
  title: string;
  description?: string | null;
  estimated_duration_days: number;
  tags: string[];
  purpose?: string;
  is_current: boolean;
  published_at?: string | null;
  phases: TrackPhase[];
}

export interface TrackTemplate {
  id: string;
  title: string;
  description?: string | null;
  role_target?: string | null;
  estimated_duration_days: number;
  tags: string[];
  purpose?: string;
  is_active: boolean;
  versions: TrackVersion[];
}

export interface AssignmentTask {
  id: string;
  assignment_phase_id: string;
  title: string;
  description?: string | null;
  instructions?: string | null;
  task_type: string;
  required: boolean;
  order_index: number;
  status: string;
  due_date?: string | null;
  completed_at?: string | null;
  estimated_minutes?: number | null;
  passing_score?: number | null;
  metadata: Record<string, unknown>;
  progress_percent: number;
  is_next_recommended: boolean;
}

export interface AssignmentPhase {
  id: string;
  title: string;
  description?: string | null;
  order_index: number;
  status: string;
  progress_percent: number;
  tasks: AssignmentTask[];
}

export interface Assignment {
  id: string;
  employee_id: string;
  mentor_id?: string | null;
  template_id: string;
  track_version_id: string;
  title: string;
  purpose?: string | null;
  start_date: string;
  target_date: string;
  status: string;
  progress_percent: number;
  phases: AssignmentPhase[];
}

export interface QuizAttempt {
  id: string;
  assignment_task_id: string;
  employee_id: string;
  attempt_number: number;
  score: number;
  max_score: number;
  passed: boolean;
  answers: Record<string, unknown>;
  submitted_at: string;
}

export interface AssessmentQuestionOption {
  id: string;
  option_text: string;
  is_correct: boolean;
  order_index: number;
}

export interface AssessmentCategory {
  id: string;
  name: string;
  slug: string;
  created_at?: string;
  updated_at?: string;
}

export interface AssessmentClassificationJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  total: number;
  processed: number;
  error_summary?: string | null;
  report_json?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface AssessmentQuestion {
  id: string;
  prompt: string;
  question_type: string;
  difficulty?: string | null;
  category_id?: string | null;
  category?: AssessmentCategory | null;
  tags: string[];
  status: string;
  explanation?: string | null;
  options: AssessmentQuestionOption[];
}

export interface AssessmentTestVersionQuestion {
  id: string;
  question_id?: string | null;
  order_index: number;
  points: number;
  question_snapshot: Record<string, unknown>;
}

export interface AssessmentTestVersion {
  id: string;
  test_id: string;
  version_number: number;
  status: string;
  passing_score: number;
  time_limit_minutes?: number | null;
  shuffle_questions: boolean;
  attempts_allowed?: number | null;
  published_at?: string | null;
  questions: AssessmentTestVersionQuestion[];
}

export interface AssessmentTest {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  role_target?: string | null;
  status: string;
  is_active: boolean;
  versions: AssessmentTestVersion[];
}

export interface AssessmentDelivery {
  id: string;
  test_version_id: string;
  title: string;
  audience_type: string;
  source_assignment_id?: string | null;
  source_assignment_task_id?: string | null;
  participant_user_id?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  attempts_allowed: number;
  duration_minutes?: number | null;
  due_date?: string | null;
}

export interface AssessmentAttempt {
  id: string;
  delivery_id: string;
  user_id: string;
  attempt_number: number;
  status: string;
  started_at: string;
  submitted_at?: string | null;
  expires_at?: string | null;
  score?: number | null;
  max_score?: number | null;
  score_percent?: number | null;
  passed: boolean;
}

export interface AssessmentAttemptQuestionOption {
  key: string;
  text: string;
}

export interface AssessmentAttemptQuestion {
  index: number;
  prompt: string;
  question_type: string;
  points: number;
  options: AssessmentAttemptQuestionOption[];
}

export interface AssessmentAttemptStart {
  attempt: AssessmentAttempt;
  questions: AssessmentAttemptQuestion[];
}

export interface UserRow {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  roles: RoleName[];
  tenant_role?: string | null;
}

export interface AdminDashboardReport {
  active_onboardings: number;
  completion_rate_percent: number;
  overdue_tasks: number;
  mentor_approval_queue: number;
}

export interface EmployeeDashboardReport {
  assignment_count: number;
  current_phase?: string | null;
  upcoming_tasks: number;
  overdue_tasks: number;
  average_progress_percent: number;
}

export interface MentorDashboardReport {
  mentee_count: number;
  pending_reviews: number;
  recent_feedback: number;
}
