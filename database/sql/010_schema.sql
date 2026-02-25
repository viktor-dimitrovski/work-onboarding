-- Core PostgreSQL schema for internal onboarding platform.

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_roles_name CHECK (
    name IN ('super_admin', 'admin', 'mentor', 'employee', 'hr_viewer', 'reviewer')
  )
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  full_name VARCHAR(255) NOT NULL,
  hashed_password VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_roles_user_role UNIQUE (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS track_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  role_target VARCHAR(100),
  estimated_duration_days INTEGER NOT NULL DEFAULT 30,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS track_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES track_templates(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  status VARCHAR(30) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  estimated_duration_days INTEGER NOT NULL DEFAULT 30,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_track_versions_template_version UNIQUE (template_id, version_number),
  CONSTRAINT ck_track_versions_status CHECK (status IN ('draft', 'published', 'archived'))
);

CREATE TABLE IF NOT EXISTS track_phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_version_id UUID NOT NULL REFERENCES track_versions(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  order_index INTEGER NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_track_phases_version_order UNIQUE (track_version_id, order_index)
);

CREATE TABLE IF NOT EXISTS track_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_phase_id UUID NOT NULL REFERENCES track_phases(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  instructions TEXT,
  task_type VARCHAR(50) NOT NULL,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  order_index INTEGER NOT NULL,
  estimated_minutes INTEGER,
  passing_score INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  due_days_offset INTEGER,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_track_tasks_phase_order UNIQUE (track_phase_id, order_index),
  CONSTRAINT ck_track_tasks_type CHECK (
    task_type IN (
      'read_material',
      'video',
      'checklist',
      'quiz',
      'code_assignment',
      'external_link',
      'mentor_approval',
      'file_upload'
    )
  )
);

CREATE TABLE IF NOT EXISTS task_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES track_tasks(id) ON DELETE CASCADE,
  resource_type VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  content_text TEXT,
  url VARCHAR(2000),
  order_index INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_task_resources_type CHECK (
    resource_type IN ('markdown_text', 'rich_text', 'pdf_link', 'video_link', 'external_url', 'code_snippet')
  )
);

CREATE TABLE IF NOT EXISTS onboarding_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  mentor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  template_id UUID NOT NULL REFERENCES track_templates(id) ON DELETE RESTRICT,
  track_version_id UUID NOT NULL REFERENCES track_versions(id) ON DELETE RESTRICT,
  title VARCHAR(200) NOT NULL,
  start_date DATE NOT NULL,
  target_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'not_started',
  progress_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_onboarding_assignments_status CHECK (
    status IN ('not_started', 'in_progress', 'blocked', 'completed', 'overdue', 'archived')
  ),
  CONSTRAINT ck_onboarding_assignments_target_date CHECK (target_date >= start_date)
);

CREATE TABLE IF NOT EXISTS assignment_phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES onboarding_assignments(id) ON DELETE CASCADE,
  source_phase_id UUID,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  order_index INTEGER NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'not_started',
  progress_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_assignment_phases_assignment_order UNIQUE (assignment_id, order_index),
  CONSTRAINT ck_assignment_phases_status CHECK (status IN ('not_started', 'in_progress', 'completed'))
);

CREATE TABLE IF NOT EXISTS assignment_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES onboarding_assignments(id) ON DELETE CASCADE,
  assignment_phase_id UUID NOT NULL REFERENCES assignment_phases(id) ON DELETE CASCADE,
  source_task_id UUID,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  instructions TEXT,
  task_type VARCHAR(50) NOT NULL,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  order_index INTEGER NOT NULL,
  estimated_minutes INTEGER,
  passing_score INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  due_date DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'not_started',
  completed_at TIMESTAMPTZ,
  progress_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  is_next_recommended BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_assignment_tasks_phase_order UNIQUE (assignment_phase_id, order_index),
  CONSTRAINT ck_assignment_tasks_status CHECK (
    status IN ('not_started', 'in_progress', 'blocked', 'pending_review', 'revision_requested', 'completed', 'overdue')
  )
);

CREATE TABLE IF NOT EXISTS task_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_task_id UUID NOT NULL REFERENCES assignment_tasks(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submission_type VARCHAR(50) NOT NULL,
  answer_text TEXT,
  file_url VARCHAR(2000),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(30) NOT NULL DEFAULT 'submitted',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_task_submissions_status CHECK (status IN ('submitted', 'reviewed', 'revision_requested'))
);

CREATE TABLE IF NOT EXISTS mentor_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_task_id UUID NOT NULL REFERENCES assignment_tasks(id) ON DELETE CASCADE,
  submission_id UUID REFERENCES task_submissions(id) ON DELETE SET NULL,
  mentor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision VARCHAR(30) NOT NULL,
  comment TEXT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_mentor_reviews_decision CHECK (decision IN ('approve', 'reject', 'revision_requested'))
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_task_id UUID NOT NULL REFERENCES assignment_tasks(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  score NUMERIC(5,2) NOT NULL,
  max_score NUMERIC(5,2) NOT NULL,
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES onboarding_assignments(id) ON DELETE CASCADE,
  assignment_task_id UUID REFERENCES assignment_tasks(id) ON DELETE SET NULL,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body TEXT NOT NULL,
  visibility VARCHAR(20) NOT NULL DEFAULT 'all',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_comments_visibility CHECK (visibility IN ('all', 'mentor_only', 'admin_only'))
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  family_id UUID,
  user_agent VARCHAR(256),
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(150) NOT NULL,
  entity_type VARCHAR(120) NOT NULL,
  entity_id UUID,
  status VARCHAR(30) NOT NULL DEFAULT 'success',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_users_email ON users(email);
CREATE INDEX IF NOT EXISTS ix_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS ix_user_roles_role_id ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS ix_track_templates_role_target ON track_templates(role_target);
CREATE INDEX IF NOT EXISTS ix_track_versions_template_id ON track_versions(template_id);
CREATE INDEX IF NOT EXISTS ix_track_versions_status ON track_versions(status);
CREATE INDEX IF NOT EXISTS ix_track_phases_track_version_id ON track_phases(track_version_id);
CREATE INDEX IF NOT EXISTS ix_track_tasks_track_phase_id ON track_tasks(track_phase_id);
CREATE INDEX IF NOT EXISTS ix_track_tasks_task_type ON track_tasks(task_type);
CREATE INDEX IF NOT EXISTS ix_task_resources_task_id ON task_resources(task_id);
CREATE INDEX IF NOT EXISTS ix_onboarding_assignments_employee_id ON onboarding_assignments(employee_id);
CREATE INDEX IF NOT EXISTS ix_onboarding_assignments_mentor_id ON onboarding_assignments(mentor_id);
CREATE INDEX IF NOT EXISTS ix_onboarding_assignments_status ON onboarding_assignments(status);
CREATE INDEX IF NOT EXISTS ix_assignment_phases_assignment_id ON assignment_phases(assignment_id);
CREATE INDEX IF NOT EXISTS ix_assignment_tasks_assignment_id ON assignment_tasks(assignment_id);
CREATE INDEX IF NOT EXISTS ix_assignment_tasks_status ON assignment_tasks(status);
CREATE INDEX IF NOT EXISTS ix_assignment_tasks_assignment_phase_id ON assignment_tasks(assignment_phase_id);
CREATE INDEX IF NOT EXISTS ix_task_submissions_assignment_task_id ON task_submissions(assignment_task_id);
CREATE INDEX IF NOT EXISTS ix_task_submissions_employee_id ON task_submissions(employee_id);
CREATE INDEX IF NOT EXISTS ix_mentor_reviews_assignment_task_id ON mentor_reviews(assignment_task_id);
CREATE INDEX IF NOT EXISTS ix_mentor_reviews_mentor_id ON mentor_reviews(mentor_id);
CREATE INDEX IF NOT EXISTS ix_quiz_attempts_assignment_task_id ON quiz_attempts(assignment_task_id);
CREATE INDEX IF NOT EXISTS ix_comments_assignment_id ON comments(assignment_id);
CREATE INDEX IF NOT EXISTS ix_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS ix_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS ix_audit_log_actor_user_id ON audit_log(actor_user_id);
