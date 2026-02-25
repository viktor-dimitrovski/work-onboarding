-- DANGER: development reset only.
-- Drops all onboarding platform objects in this database.

DROP VIEW IF EXISTS vw_mentor_approval_queue;
DROP VIEW IF EXISTS vw_overdue_tasks;
DROP VIEW IF EXISTS vw_assignment_progress;

DROP FUNCTION IF EXISTS fn_next_recommended_task(UUID);
DROP FUNCTION IF EXISTS fn_assignment_progress(UUID);

DROP TABLE IF EXISTS mentor_reviews CASCADE;
DROP TABLE IF EXISTS quiz_attempts CASCADE;
DROP TABLE IF EXISTS task_submissions CASCADE;
DROP TABLE IF EXISTS assignment_tasks CASCADE;
DROP TABLE IF EXISTS assignment_phases CASCADE;
DROP TABLE IF EXISTS onboarding_assignments CASCADE;
DROP TABLE IF EXISTS task_resources CASCADE;
DROP TABLE IF EXISTS track_tasks CASCADE;
DROP TABLE IF EXISTS track_phases CASCADE;
DROP TABLE IF EXISTS track_versions CASCADE;
DROP TABLE IF EXISTS track_templates CASCADE;
DROP TABLE IF EXISTS comments CASCADE;
DROP TABLE IF EXISTS refresh_tokens CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS user_roles CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
