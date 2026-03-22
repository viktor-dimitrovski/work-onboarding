export type RoleName = 'super_admin';

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  roles: RoleName[];
  last_login_at?: string | null;
  must_change_password?: boolean;
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
  | 'compliance_viewer'
  | 'compliance_editor'
  | 'compliance_admin'
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
  roles?: string[];
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
  track_type?: string;
  is_current: boolean;
  published_at?: string | null;
  phases: TrackPhase[];
  created_at?: string;
  updated_at?: string;
}

export interface TrackTemplate {
  id: string;
  title: string;
  description?: string | null;
  role_target?: string | null;
  estimated_duration_days: number;
  tags: string[];
  purpose?: string;
  track_type?: string;
  is_active: boolean;
  versions: TrackVersion[];
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
  updated_by?: string | null;
  created_by_name?: string | null;
  updated_by_name?: string | null;
  created_by_email?: string | null;
  updated_by_email?: string | null;
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
  resources?: TaskResource[];
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
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
  updated_by?: string | null;
  created_by_name?: string | null;
  updated_by_name?: string | null;
  created_by_email?: string | null;
  updated_by_email?: string | null;
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
  parent_id?: string | null;
  question_count?: number;
  children_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface AssessmentCategoryCreate {
  name: string;
  slug: string;
  parent_id?: string | null;
}

export interface AssessmentCategoryUpdate {
  name?: string;
  slug?: string;
  parent_id?: string | null;
}

export interface AssessmentCategoryTreeNode {
  id: string;
  name: string;
  slug: string;
  parent_id?: string | null;
  children: AssessmentCategoryTreeNode[];
}

export interface AssessmentClassificationJob {
  id: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'canceled';
  total: number;
  processed: number;
  error_summary?: string | null;
  report_json?: Record<string, unknown>;
  mode?: string | null;
  dry_run?: boolean | null;
  batch_size?: number | null;
  scope_json?: Record<string, unknown>;
  cancel_requested?: boolean | null;
  pause_requested?: boolean | null;
  started_at?: string | null;
  completed_at?: string | null;
  last_heartbeat_at?: string | null;
  applied_at?: string | null;
  rolled_back_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AssessmentClassificationJobItem {
  id: string;
  job_id: string;
  question_id: string;
  old_category_id?: string | null;
  old_difficulty?: string | null;
  new_category_name: string;
  new_category_slug: string;
  new_category_id?: string | null;
  new_difficulty: string;
  applied: boolean;
  applied_at?: string | null;
  error_summary?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AssessmentQuestionStats {
  total: number;
  unclassified_category: number;
  unclassified_difficulty: number;
  by_status: Record<string, number>;
  by_difficulty: Record<string, number>;
  by_category: Record<string, number>;
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
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AssessmentTestVersionQuestion {
  id: string;
  question_id?: string | null;
  order_index: number;
  points: number;
  section?: string | null;
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

export interface AssessmentTestVersionHistory {
  id: string;
  test_id: string;
  version_number: number;
  status: string;
  passing_score: number;
  time_limit_minutes?: number | null;
  shuffle_questions: boolean;
  attempts_allowed?: number | null;
  published_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_by_email?: string | null;
  deliveries_count: number;
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

export interface AssessmentSectionScore {
  earned: number;
  total: number;
  percent: number;
  correct: number;
  total_questions: number;
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
  section_scores?: Record<string, AssessmentSectionScore> | null;
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

// ── Personal results history ─────────────────────────────────────────────────
export interface MyResultAttempt {
  attempt_id: string;
  attempt_number: number;
  delivery_id: string;
  test_id: string | null;
  test_title: string;
  status: string;
  started_at: string;
  submitted_at: string | null;
  score: number | null;
  max_score: number | null;
  score_percent: number | null;
  passed: boolean;
  section_scores?: Record<string, AssessmentSectionScore> | null;
}

export interface MyResultsResponse {
  items: MyResultAttempt[];
  total_attempts: number;
  average_score_percent: number | null;
  pass_count: number;
  fail_count: number;
}

// ── Review (read-only, reveals correct answers) ───────────────────────────────
export interface AttemptReviewOption {
  key: string;
  text: string;
  is_correct: boolean;
}

export interface AttemptReviewQuestion {
  index: number;
  prompt: string;
  question_type: string;
  points: number;
  earned_points: number;
  explanation: string | null;
  section: string | null;
  options: AttemptReviewOption[];
  selected_keys: string[];
  is_correct: boolean | null;
}

export interface AttemptReview {
  attempt_id: string;
  score: number | null;
  max_score: number | null;
  score_percent: number | null;
  passed: boolean;
  status: string;
  questions: AttemptReviewQuestion[];
}

export interface UserRow {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  roles: RoleName[];
  last_login_at?: string | null;
  tenant_role?: string | null;
  tenant_roles?: string[] | null;
  tenant_status?: string | null;
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

export interface BillingOverview {
  plan?: { id: string; key: string; name: string } | null;
  subscription?: {
    id: string;
    status: string;
    starts_at: string;
    ends_at?: string | null;
    trial_ends_at?: string | null;
    current_period_start?: string | null;
    current_period_end?: string | null;
    billing_interval?: string | null;
    currency?: string | null;
    provider?: string | null;
    cancel_at_period_end: boolean;
  } | null;
  current_period_spend: number;
  currency?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  next_invoice?: {
    id: string;
    status: string;
    total_amount: number;
    currency: string;
    issued_at?: string | null;
    due_at?: string | null;
    paid_at?: string | null;
  } | null;
}

export interface BillingUsageItem {
  event_key: string;
  meter_name: string;
  units: number;
  amount: number;
  currency: string;
}

export interface BillingUsageResponse {
  from_date?: string | null;
  to_date?: string | null;
  items: BillingUsageItem[];
}

export interface BillingInvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unit_amount: number;
  total_amount: number;
  currency: string;
}

export interface BillingInvoice {
  id: string;
  status: string;
  currency: string;
  subtotal_amount: number;
  total_amount: number;
  issued_at?: string | null;
  due_at?: string | null;
  paid_at?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  lines: BillingInvoiceLine[];
}

// ---------------------------------------------------------------------------
// Integration Registry
// ---------------------------------------------------------------------------

export interface IrDictionary {
  id: string;
  key: string;
  name: string;
  is_addable: boolean;
  is_global: boolean;
  tenant_id?: string | null;
}

export interface IrDictionaryItem {
  id: string;
  dictionary_id: string;
  code: string;
  label: string;
  is_active: boolean;
  sort_order: number;
  meta_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
}

export interface IrEndpoint {
  id: string;
  instance_id: string;
  tenant_id: string;
  fqdn?: string | null;
  ip?: string | null;
  port?: number | null;
  protocol: string;
  base_path?: string | null;
  is_public: boolean;
  is_primary: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface IrRouteHop {
  id: string;
  instance_id: string;
  tenant_id: string;
  direction: 'inbound' | 'outbound';
  hop_order: number;
  label?: string | null;
  proxy_chain?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface IrService {
  id: string;
  tenant_id: string;
  name: string;
  service_type?: string | null;
  owner_team?: string | null;
  status: string;
  description?: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  updated_by?: string | null;
}

export interface IrServiceListItem {
  id: string;
  name: string;
  service_type?: string | null;
  owner_team?: string | null;
  status: string;
  instance_count: number;
}

export interface IrInstance {
  id: string;
  tenant_id: string;
  service_id: string;
  service_name?: string | null;
  env: string;
  datacenter?: string | null;
  network_zone?: string | null;
  status: string;
  contact?: string | null;
  vault_ref?: string | null;
  type_settings_json: Record<string, unknown>;
  tags: string[];
  notes?: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  updated_by?: string | null;
  endpoints: IrEndpoint[];
  route_hops: IrRouteHop[];
  encryption_locked?: boolean;
}

export interface IrInstanceListItem {
  id: string;
  tenant_id: string;
  service_id: string;
  service_name?: string | null;
  env: string;
  datacenter?: string | null;
  network_zone?: string | null;
  status: string;
  primary_endpoint?: string | null;
  version: number;
  updated_at: string;
  updated_by?: string | null;
  encryption_locked?: boolean;
}

export interface IrInstanceListResponse {
  items: IrInstanceListItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface IrAuditLog {
  id: string;
  tenant_id: string;
  entity_type: string;
  entity_id: string;
  version: number;
  action: string;
  changed_by?: string | null;
  changed_at: string;
  change_reason: string;
  snapshot_json: Record<string, unknown>;
}

export interface IrGridPrefs {
  grid_key: string;
  visible_columns: string[];
  order: string[];
}

export interface IrOverviewRecentItem {
  instance_id: string;
  service_name: string;
  env: string;
  status: string;
  changed_at: string;
  changed_by?: string | null;
}

export interface IrOverview {
  total: number;
  uat_count: number;
  prod_count: number;
  draft_count: number;
  active_count: number;
  service_count: number;
  recently_changed: IrOverviewRecentItem[];
}

export interface IrCryptoSettings {
  initialized: boolean;
  unlocked: boolean;
  key_fingerprint?: string | null;
  kdf_params?: Record<string, unknown> | null;
}
