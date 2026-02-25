-- Reference seed data for roles and documented value sets.

INSERT INTO roles (name, description)
VALUES
  ('super_admin', 'Full system access and governance'),
  ('admin', 'Manage tracks, users, assignments, and reports'),
  ('mentor', 'Review mentee submissions and approvals'),
  ('employee', 'Complete onboarding tasks and submit work'),
  ('hr_viewer', 'Read-only reporting access for HR'),
  ('reviewer', 'Optional evaluator role for specialized tracks')
ON CONFLICT (name) DO UPDATE
SET
  description = EXCLUDED.description,
  updated_at = NOW();

-- Documented operational enums for external DBA review:
-- task_type: read_material, video, checklist, quiz, code_assignment, external_link, mentor_approval, file_upload
-- assignment status: not_started, in_progress, blocked, completed, overdue, archived
-- assignment task status: not_started, in_progress, blocked, pending_review, revision_requested, completed, overdue
-- mentor decisions: approve, reject, revision_requested
