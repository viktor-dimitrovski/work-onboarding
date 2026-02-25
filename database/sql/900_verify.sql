-- Sanity checks after schema + seed execution.

SELECT 'roles' AS table_name, COUNT(*) AS row_count FROM roles;
SELECT 'users' AS table_name, COUNT(*) AS row_count FROM users;
SELECT 'track_templates' AS table_name, COUNT(*) AS row_count FROM track_templates;
SELECT 'track_versions' AS table_name, COUNT(*) AS row_count FROM track_versions;
SELECT 'track_phases' AS table_name, COUNT(*) AS row_count FROM track_phases;
SELECT 'track_tasks' AS table_name, COUNT(*) AS row_count FROM track_tasks;
SELECT 'onboarding_assignments' AS table_name, COUNT(*) AS row_count FROM onboarding_assignments;
SELECT 'assignment_tasks' AS table_name, COUNT(*) AS row_count FROM assignment_tasks;

SELECT
  oa.id,
  oa.title,
  oa.status,
  oa.progress_percent,
  employee.email AS employee_email,
  mentor.email AS mentor_email
FROM onboarding_assignments oa
JOIN users employee ON employee.id = oa.employee_id
LEFT JOIN users mentor ON mentor.id = oa.mentor_id
ORDER BY oa.created_at DESC
LIMIT 10;

SELECT * FROM vw_assignment_progress ORDER BY assignment_id LIMIT 10;
SELECT * FROM vw_overdue_tasks ORDER BY due_date ASC LIMIT 10;
SELECT * FROM vw_mentor_approval_queue ORDER BY pending_reviews DESC;

SELECT fn_assignment_progress(oa.id) AS computed_progress, oa.progress_percent AS stored_progress
FROM onboarding_assignments oa
ORDER BY oa.created_at DESC
LIMIT 10;
