-- Optional helper functions for lightweight reporting and UI logic.

CREATE OR REPLACE FUNCTION fn_assignment_progress(p_assignment_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    ROUND(
      100.0 *
      COUNT(*) FILTER (WHERE required AND status = 'completed') /
      NULLIF(COUNT(*) FILTER (WHERE required), 0),
      2
    ),
    0
  )
  FROM assignment_tasks
  WHERE assignment_id = p_assignment_id;
$$;

CREATE OR REPLACE FUNCTION fn_next_recommended_task(p_assignment_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT at.id
  FROM assignment_tasks at
  JOIN assignment_phases ap ON ap.id = at.assignment_phase_id
  WHERE at.assignment_id = p_assignment_id
    AND at.status IN ('not_started', 'in_progress', 'revision_requested', 'overdue')
  ORDER BY ap.order_index ASC, at.order_index ASC
  LIMIT 1;
$$;
