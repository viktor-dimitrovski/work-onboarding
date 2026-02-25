-- Reporting views for dashboards and ad-hoc analysis.

CREATE OR REPLACE VIEW vw_assignment_progress AS
SELECT
  oa.id AS assignment_id,
  oa.title,
  oa.status,
  oa.progress_percent,
  oa.start_date,
  oa.target_date,
  employee.email AS employee_email,
  employee.full_name AS employee_name,
  mentor.email AS mentor_email,
  mentor.full_name AS mentor_name,
  COUNT(at.id) FILTER (WHERE at.required) AS required_task_count,
  COUNT(at.id) FILTER (WHERE at.required AND at.status = 'completed') AS completed_required_task_count,
  COUNT(at.id) FILTER (WHERE at.status = 'pending_review') AS pending_review_count,
  COUNT(at.id) FILTER (WHERE at.status = 'overdue') AS overdue_task_count
FROM onboarding_assignments oa
JOIN users employee ON employee.id = oa.employee_id
LEFT JOIN users mentor ON mentor.id = oa.mentor_id
LEFT JOIN assignment_tasks at ON at.assignment_id = oa.id
GROUP BY oa.id, employee.id, mentor.id;

CREATE OR REPLACE VIEW vw_overdue_tasks AS
SELECT
  at.id AS assignment_task_id,
  at.assignment_id,
  oa.title AS assignment_title,
  employee.email AS employee_email,
  employee.full_name AS employee_name,
  mentor.email AS mentor_email,
  at.title AS task_title,
  at.status,
  at.due_date,
  at.created_at
FROM assignment_tasks at
JOIN onboarding_assignments oa ON oa.id = at.assignment_id
JOIN users employee ON employee.id = oa.employee_id
LEFT JOIN users mentor ON mentor.id = oa.mentor_id
WHERE at.status <> 'completed'
  AND at.due_date IS NOT NULL
  AND at.due_date < CURRENT_DATE;

CREATE OR REPLACE VIEW vw_mentor_approval_queue AS
SELECT
  oa.mentor_id,
  mentor.email AS mentor_email,
  mentor.full_name AS mentor_name,
  COUNT(at.id) AS pending_reviews,
  MIN(at.due_date) AS nearest_due_date
FROM assignment_tasks at
JOIN onboarding_assignments oa ON oa.id = at.assignment_id
JOIN users mentor ON mentor.id = oa.mentor_id
WHERE at.status = 'pending_review'
GROUP BY oa.mentor_id, mentor.email, mentor.full_name;
