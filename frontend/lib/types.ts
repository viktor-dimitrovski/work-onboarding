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
  start_date: string;
  target_date: string;
  status: string;
  progress_percent: number;
  phases: AssignmentPhase[];
}

export interface UserRow {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  roles: RoleName[];
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
