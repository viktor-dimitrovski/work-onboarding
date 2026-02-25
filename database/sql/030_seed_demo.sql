-- Demo data for local development and stakeholder walkthroughs.
-- Includes:
-- - 6 users across required roles
-- - 2 track templates (DevOps, Backend)
-- - 5 phases and 15 tasks per track
-- - 1 onboarding assignment snapshot for employee demo flow

DO $seed$
DECLARE
  v_password_hash TEXT := '$2b$12$mZm2CsmY5ZJ9fnHJKVAIUu.mBFZ7izv2cDN.q0JnuMjyD9GpFpk7y';

  v_super_admin_id UUID;
  v_admin_id UUID;
  v_mentor_id UUID;
  v_employee_one_id UUID;
  v_employee_two_id UUID;
  v_hr_id UUID;

  v_role_super_admin UUID;
  v_role_admin UUID;
  v_role_mentor UUID;
  v_role_employee UUID;
  v_role_hr UUID;

  v_devops_template_id UUID;
  v_devops_version_id UUID;
  v_backend_template_id UUID;
  v_backend_version_id UUID;

  v_phase_id UUID;
  v_task_id UUID;
  v_assignment_id UUID;
  v_assignment_phase_id UUID;
  v_first_assignment_task_id UUID;

  phase_item JSONB;
  task_item JSONB;
  phase_order INTEGER;
  task_order INTEGER;

  devops_def JSONB := $$[
    {
      "title": "Phase 1: Organization and Foundations",
      "description": "Understand company standards, tooling, and environment setup.",
      "tasks": [
        {"title":"Read internal SSDLC policy","task_type":"read_material","instructions":"Read the secure SDLC policy and acknowledge key controls.","required":true,"estimated_minutes":20,"due_days_offset":1,"resource_type":"markdown_text","resource_content":"# SSDLC Policy\nUnderstand secure coding controls, code review requirements, and release gates."},
        {"title":"Watch infrastructure overview video","task_type":"video","instructions":"Watch the 20-minute infrastructure architecture walkthrough.","required":true,"estimated_minutes":20,"due_days_offset":1,"resource_type":"video_link","resource_url":"https://videos.example.com/devops/infra-overview"},
        {"title":"Complete workstation and VPN checklist","task_type":"checklist","instructions":"Confirm workstation hardening, VPN access, and MFA setup.","required":true,"estimated_minutes":30,"due_days_offset":2,"resource_type":"external_url","resource_url":"https://wiki.example.com/onboarding/workstation-checklist"}
      ]
    },
    {
      "title": "Phase 2: Security and Compliance",
      "description": "Build baseline operational security knowledge.",
      "tasks": [
        {"title":"Complete secrets management quiz","task_type":"quiz","instructions":"Take quiz on secrets lifecycle and rotation standards.","required":true,"estimated_minutes":25,"passing_score":80,"due_days_offset":4,"resource_type":"pdf_link","resource_url":"https://docs.example.com/security/secrets-management.pdf"},
        {"title":"Read IAM baseline policy","task_type":"read_material","instructions":"Review IAM least privilege and break-glass policy.","required":true,"estimated_minutes":15,"due_days_offset":4,"resource_type":"pdf_link","resource_url":"https://docs.example.com/security/iam-baseline.pdf"},
        {"title":"Configure SSO and privileged access workflow","task_type":"checklist","instructions":"Enable required identity providers and privileged session approvals.","required":true,"estimated_minutes":30,"due_days_offset":5,"resource_type":"external_url","resource_url":"https://wiki.example.com/security/privileged-access"}
      ]
    },
    {
      "title": "Phase 3: Platform Tooling",
      "description": "Work through CI/CD and platform automation workflows.",
      "tasks": [
        {"title":"Clone and inspect IaC platform repository","task_type":"checklist","instructions":"Clone repo, run formatter, and inspect environment modules.","required":true,"estimated_minutes":30,"due_days_offset":7,"resource_type":"external_url","resource_url":"https://github.example.com/platform/iac"},
        {"title":"Watch CI/CD pipeline walkthrough","task_type":"video","instructions":"Watch pipeline standards and deployment guardrails walkthrough.","required":true,"estimated_minutes":25,"due_days_offset":7,"resource_type":"video_link","resource_url":"https://videos.example.com/devops/cicd-pipeline"},
        {"title":"Submit sample API service with Dockerfile and healthcheck","task_type":"code_assignment","instructions":"Create a minimal API service, containerize it, and include /health endpoint.","required":true,"estimated_minutes":120,"due_days_offset":10,"resource_type":"code_snippet","resource_content":"FROM python:3.11-slim\n# Build your service and expose /health"}
      ]
    },
    {
      "title": "Phase 4: Deployment Practice",
      "description": "Practice real deployment workflow with mentor oversight.",
      "tasks": [
        {"title":"Deploy sample service to development namespace","task_type":"checklist","instructions":"Deploy service and confirm logs and metrics availability.","required":true,"estimated_minutes":60,"due_days_offset":12,"resource_type":"external_url","resource_url":"https://wiki.example.com/platform/deployment-checklist"},
        {"title":"Request mentor approval for staging deployment exercise","task_type":"mentor_approval","instructions":"Share deployment evidence and request mentor decision.","required":true,"estimated_minutes":45,"due_days_offset":13,"resource_type":"rich_text","resource_content":"Submit deployment link, observability screenshot, and rollback notes."},
        {"title":"Upload post-deployment validation report","task_type":"file_upload","instructions":"Upload validation summary including latency, errors, and incident notes.","required":true,"estimated_minutes":35,"due_days_offset":14,"resource_type":"pdf_link","resource_url":"https://templates.example.com/deployment-validation-template"}
      ]
    },
    {
      "title": "Phase 5: Operational Readiness",
      "description": "Finish readiness checks before production access expansion.",
      "tasks": [
        {"title":"Read incident response runbook","task_type":"read_material","instructions":"Understand escalation matrix and severity workflow.","required":true,"estimated_minutes":20,"due_days_offset":16,"resource_type":"pdf_link","resource_url":"https://docs.example.com/sre/incident-response-runbook.pdf"},
        {"title":"Complete on-call shadowing checklist","task_type":"checklist","instructions":"Shadow one on-call handoff and complete checklist items.","required":true,"estimated_minutes":45,"due_days_offset":18,"resource_type":"external_url","resource_url":"https://wiki.example.com/sre/on-call-shadowing"},
        {"title":"Review observability and alerting playbook","task_type":"external_link","instructions":"Review dashboards, alerts, and ownership policy for services.","required":true,"estimated_minutes":25,"due_days_offset":18,"resource_type":"external_url","resource_url":"https://wiki.example.com/sre/observability-playbook"}
      ]
    }
  ]$$::jsonb;

  backend_def JSONB := $$[
    {
      "title": "Phase 1: Product Context and Architecture",
      "description": "Understand product domain and backend architecture principles.",
      "tasks": [
        {"title":"Read backend architecture principles","task_type":"read_material","instructions":"Review service boundaries, layering, and reliability principles.","required":true,"estimated_minutes":25,"due_days_offset":1,"resource_type":"markdown_text","resource_content":"# Backend Architecture\nFocus on domain boundaries, contracts, and observability."},
        {"title":"Watch backend platform overview","task_type":"video","instructions":"Watch architecture briefing for core APIs and data flows.","required":true,"estimated_minutes":20,"due_days_offset":1,"resource_type":"video_link","resource_url":"https://videos.example.com/backend/platform-overview"},
        {"title":"Complete development environment checklist","task_type":"checklist","instructions":"Install dependencies, run local API and test suite.","required":true,"estimated_minutes":30,"due_days_offset":2,"resource_type":"external_url","resource_url":"https://wiki.example.com/backend/env-setup"}
      ]
    },
    {
      "title": "Phase 2: API Standards and Security",
      "description": "Apply API design and secure coding standards.",
      "tasks": [
        {"title":"Read API style guide","task_type":"read_material","instructions":"Review naming conventions, error model, and pagination rules.","required":true,"estimated_minutes":20,"due_days_offset":4,"resource_type":"pdf_link","resource_url":"https://docs.example.com/api/style-guide.pdf"},
        {"title":"Complete API security quiz","task_type":"quiz","instructions":"Quiz on auth, authorization, and data validation patterns.","required":true,"estimated_minutes":25,"passing_score":80,"due_days_offset":4,"resource_type":"pdf_link","resource_url":"https://docs.example.com/security/api-security-handbook.pdf"},
        {"title":"Complete API versioning checklist","task_type":"checklist","instructions":"Validate backward compatibility and deprecation policy steps.","required":true,"estimated_minutes":20,"due_days_offset":5,"resource_type":"external_url","resource_url":"https://wiki.example.com/api/versioning"}
      ]
    },
    {
      "title": "Phase 3: Service Development",
      "description": "Build and validate a production-ready API service.",
      "tasks": [
        {"title":"Submit sample API service","task_type":"code_assignment","instructions":"Build a small API with auth guard, tests, and metrics endpoint.","required":true,"estimated_minutes":150,"due_days_offset":9,"resource_type":"code_snippet","resource_content":"Implement GET /health and role-protected endpoint /api/v1/sample."},
        {"title":"Execute integration test checklist","task_type":"checklist","instructions":"Run integration tests and capture test evidence.","required":true,"estimated_minutes":35,"due_days_offset":10,"resource_type":"external_url","resource_url":"https://wiki.example.com/backend/testing-standards"},
        {"title":"Request mentor review for implementation","task_type":"mentor_approval","instructions":"Request mentor review of architecture and code quality.","required":true,"estimated_minutes":30,"due_days_offset":10,"resource_type":"rich_text","resource_content":"Include link to repository branch and summary of design choices."}
      ]
    },
    {
      "title": "Phase 4: Data and Reliability",
      "description": "Deepen database and resilience practices.",
      "tasks": [
        {"title":"Read database migration policy","task_type":"read_material","instructions":"Understand migration review, rollback, and release procedures.","required":true,"estimated_minutes":20,"due_days_offset":12,"resource_type":"pdf_link","resource_url":"https://docs.example.com/backend/migration-policy.pdf"},
        {"title":"Complete caching and performance quiz","task_type":"quiz","instructions":"Quiz on caching strategy and response-time budgeting.","required":true,"estimated_minutes":25,"passing_score":75,"due_days_offset":13,"resource_type":"pdf_link","resource_url":"https://docs.example.com/backend/performance-handbook.pdf"},
        {"title":"Upload service runbook draft","task_type":"file_upload","instructions":"Upload operational runbook for your sample service.","required":true,"estimated_minutes":40,"due_days_offset":14,"resource_type":"pdf_link","resource_url":"https://templates.example.com/backend/runbook-template"}
      ]
    },
    {
      "title": "Phase 5: Launch Readiness",
      "description": "Final readiness checks before full environment access.",
      "tasks": [
        {"title":"Read release readiness checklist","task_type":"read_material","instructions":"Review criteria for production deployment approvals.","required":true,"estimated_minutes":15,"due_days_offset":16,"resource_type":"external_url","resource_url":"https://wiki.example.com/release/readiness-checklist"},
        {"title":"Run staging smoke tests","task_type":"checklist","instructions":"Execute smoke suite in staging and record findings.","required":true,"estimated_minutes":30,"due_days_offset":17,"resource_type":"external_url","resource_url":"https://wiki.example.com/qa/staging-smoke"},
        {"title":"Request mentor approval for production readiness","task_type":"mentor_approval","instructions":"Present evidence and request readiness sign-off.","required":true,"estimated_minutes":35,"due_days_offset":18,"resource_type":"rich_text","resource_content":"Provide test summary, risk log, and rollback plan."}
      ]
    }
  ]$$::jsonb;
BEGIN
  SELECT id INTO v_role_super_admin FROM roles WHERE name = 'super_admin';
  SELECT id INTO v_role_admin FROM roles WHERE name = 'admin';
  SELECT id INTO v_role_mentor FROM roles WHERE name = 'mentor';
  SELECT id INTO v_role_employee FROM roles WHERE name = 'employee';
  SELECT id INTO v_role_hr FROM roles WHERE name = 'hr_viewer';

  INSERT INTO users (email, full_name, hashed_password, is_active)
  VALUES ('super.admin@example.com', 'Super Admin User', v_password_hash, TRUE)
  ON CONFLICT (email) DO NOTHING;

  INSERT INTO users (email, full_name, hashed_password, is_active)
  VALUES ('admin.operations@example.com', 'Operations Admin', v_password_hash, TRUE)
  ON CONFLICT (email) DO NOTHING;

  INSERT INTO users (email, full_name, hashed_password, is_active)
  VALUES ('mentor.devops@example.com', 'DevOps Mentor', v_password_hash, TRUE)
  ON CONFLICT (email) DO NOTHING;

  INSERT INTO users (email, full_name, hashed_password, is_active)
  VALUES ('employee.alex@example.com', 'Alex Rivera', v_password_hash, TRUE)
  ON CONFLICT (email) DO NOTHING;

  INSERT INTO users (email, full_name, hashed_password, is_active)
  VALUES ('employee.morgan@example.com', 'Morgan Lee', v_password_hash, TRUE)
  ON CONFLICT (email) DO NOTHING;

  INSERT INTO users (email, full_name, hashed_password, is_active)
  VALUES ('hr.viewer@example.com', 'HR Viewer', v_password_hash, TRUE)
  ON CONFLICT (email) DO NOTHING;

  SELECT id INTO v_super_admin_id FROM users WHERE email = 'super.admin@example.com';
  SELECT id INTO v_admin_id FROM users WHERE email = 'admin.operations@example.com';
  SELECT id INTO v_mentor_id FROM users WHERE email = 'mentor.devops@example.com';
  SELECT id INTO v_employee_one_id FROM users WHERE email = 'employee.alex@example.com';
  SELECT id INTO v_employee_two_id FROM users WHERE email = 'employee.morgan@example.com';
  SELECT id INTO v_hr_id FROM users WHERE email = 'hr.viewer@example.com';

  INSERT INTO user_roles (user_id, role_id)
  VALUES
    (v_super_admin_id, v_role_super_admin),
    (v_super_admin_id, v_role_admin),
    (v_admin_id, v_role_admin),
    (v_mentor_id, v_role_mentor),
    (v_employee_one_id, v_role_employee),
    (v_employee_two_id, v_role_employee),
    (v_hr_id, v_role_hr)
  ON CONFLICT (user_id, role_id) DO NOTHING;

  SELECT id INTO v_devops_template_id FROM track_templates WHERE title = 'DevOps Engineer Onboarding' LIMIT 1;
  IF v_devops_template_id IS NULL THEN
    INSERT INTO track_templates (
      title, description, role_target, estimated_duration_days, tags, created_by, updated_by
    )
    VALUES (
      'DevOps Engineer Onboarding',
      'Structured onboarding for platform, security, deployment, and operational readiness.',
      'devops',
      45,
      '["devops", "platform", "security"]'::jsonb,
      v_admin_id,
      v_admin_id
    )
    RETURNING id INTO v_devops_template_id;

    INSERT INTO track_versions (
      template_id, version_number, status, title, description, estimated_duration_days,
      tags, is_current, published_at, created_by, updated_by
    )
    VALUES (
      v_devops_template_id,
      1,
      'published',
      'DevOps Engineer Onboarding',
      'Published MVP baseline for DevOps onboarding.',
      45,
      '["devops", "platform", "security"]'::jsonb,
      TRUE,
      NOW(),
      v_admin_id,
      v_admin_id
    )
    RETURNING id INTO v_devops_version_id;

    phase_order := 0;
    FOR phase_item IN SELECT value FROM jsonb_array_elements(devops_def)
    LOOP
      INSERT INTO track_phases (
        track_version_id, title, description, order_index, created_by, updated_by
      )
      VALUES (
        v_devops_version_id,
        phase_item->>'title',
        phase_item->>'description',
        phase_order,
        v_admin_id,
        v_admin_id
      )
      RETURNING id INTO v_phase_id;

      task_order := 0;
      FOR task_item IN SELECT value FROM jsonb_array_elements(phase_item->'tasks')
      LOOP
        INSERT INTO track_tasks (
          track_phase_id, title, description, instructions, task_type, required,
          order_index, estimated_minutes, passing_score, metadata, due_days_offset,
          created_by, updated_by
        )
        VALUES (
          v_phase_id,
          task_item->>'title',
          NULL,
          task_item->>'instructions',
          task_item->>'task_type',
          COALESCE((task_item->>'required')::BOOLEAN, TRUE),
          task_order,
          NULLIF(task_item->>'estimated_minutes', '')::INTEGER,
          NULLIF(task_item->>'passing_score', '')::INTEGER,
          '{}'::jsonb,
          NULLIF(task_item->>'due_days_offset', '')::INTEGER,
          v_admin_id,
          v_admin_id
        )
        RETURNING id INTO v_task_id;

        INSERT INTO task_resources (
          task_id, resource_type, title, content_text, url, order_index, metadata, created_by, updated_by
        )
        VALUES (
          v_task_id,
          COALESCE(task_item->>'resource_type', 'external_url'),
          (task_item->>'title') || ' Resource',
          NULLIF(task_item->>'resource_content', ''),
          NULLIF(task_item->>'resource_url', ''),
          0,
          '{}'::jsonb,
          v_admin_id,
          v_admin_id
        );

        task_order := task_order + 1;
      END LOOP;

      phase_order := phase_order + 1;
    END LOOP;
  ELSE
    SELECT id INTO v_devops_version_id
    FROM track_versions
    WHERE template_id = v_devops_template_id
    ORDER BY version_number DESC
    LIMIT 1;
  END IF;

  SELECT id INTO v_backend_template_id FROM track_templates WHERE title = 'Backend Developer Onboarding' LIMIT 1;
  IF v_backend_template_id IS NULL THEN
    INSERT INTO track_templates (
      title, description, role_target, estimated_duration_days, tags, created_by, updated_by
    )
    VALUES (
      'Backend Developer Onboarding',
      'Structured onboarding for API standards, service development, and launch readiness.',
      'backend',
      40,
      '["backend", "api", "reliability"]'::jsonb,
      v_admin_id,
      v_admin_id
    )
    RETURNING id INTO v_backend_template_id;

    INSERT INTO track_versions (
      template_id, version_number, status, title, description, estimated_duration_days,
      tags, is_current, published_at, created_by, updated_by
    )
    VALUES (
      v_backend_template_id,
      1,
      'published',
      'Backend Developer Onboarding',
      'Published MVP baseline for backend developer onboarding.',
      40,
      '["backend", "api", "reliability"]'::jsonb,
      TRUE,
      NOW(),
      v_admin_id,
      v_admin_id
    )
    RETURNING id INTO v_backend_version_id;

    phase_order := 0;
    FOR phase_item IN SELECT value FROM jsonb_array_elements(backend_def)
    LOOP
      INSERT INTO track_phases (
        track_version_id, title, description, order_index, created_by, updated_by
      )
      VALUES (
        v_backend_version_id,
        phase_item->>'title',
        phase_item->>'description',
        phase_order,
        v_admin_id,
        v_admin_id
      )
      RETURNING id INTO v_phase_id;

      task_order := 0;
      FOR task_item IN SELECT value FROM jsonb_array_elements(phase_item->'tasks')
      LOOP
        INSERT INTO track_tasks (
          track_phase_id, title, description, instructions, task_type, required,
          order_index, estimated_minutes, passing_score, metadata, due_days_offset,
          created_by, updated_by
        )
        VALUES (
          v_phase_id,
          task_item->>'title',
          NULL,
          task_item->>'instructions',
          task_item->>'task_type',
          COALESCE((task_item->>'required')::BOOLEAN, TRUE),
          task_order,
          NULLIF(task_item->>'estimated_minutes', '')::INTEGER,
          NULLIF(task_item->>'passing_score', '')::INTEGER,
          '{}'::jsonb,
          NULLIF(task_item->>'due_days_offset', '')::INTEGER,
          v_admin_id,
          v_admin_id
        )
        RETURNING id INTO v_task_id;

        INSERT INTO task_resources (
          task_id, resource_type, title, content_text, url, order_index, metadata, created_by, updated_by
        )
        VALUES (
          v_task_id,
          COALESCE(task_item->>'resource_type', 'external_url'),
          (task_item->>'title') || ' Resource',
          NULLIF(task_item->>'resource_content', ''),
          NULLIF(task_item->>'resource_url', ''),
          0,
          '{}'::jsonb,
          v_admin_id,
          v_admin_id
        );

        task_order := task_order + 1;
      END LOOP;

      phase_order := phase_order + 1;
    END LOOP;
  ELSE
    SELECT id INTO v_backend_version_id
    FROM track_versions
    WHERE template_id = v_backend_template_id
    ORDER BY version_number DESC
    LIMIT 1;
  END IF;

  SELECT id INTO v_assignment_id
  FROM onboarding_assignments
  WHERE title = 'DevOps Engineer Onboarding'
    AND employee_id = v_employee_one_id
  LIMIT 1;

  IF v_assignment_id IS NULL THEN
    INSERT INTO onboarding_assignments (
      employee_id, mentor_id, template_id, track_version_id, title,
      start_date, target_date, status, progress_percent, snapshot,
      created_by, updated_by
    )
    VALUES (
      v_employee_one_id,
      v_mentor_id,
      v_devops_template_id,
      v_devops_version_id,
      'DevOps Engineer Onboarding',
      CURRENT_DATE,
      CURRENT_DATE + 45,
      'in_progress',
      0,
      jsonb_build_object(
        'source_track_version_id', v_devops_version_id,
        'generated_at', NOW(),
        'seed', TRUE
      ),
      v_admin_id,
      v_admin_id
    )
    RETURNING id INTO v_assignment_id;

    v_first_assignment_task_id := NULL;

    FOR v_phase_id IN
      SELECT id
      FROM track_phases
      WHERE track_version_id = v_devops_version_id
      ORDER BY order_index
    LOOP
      INSERT INTO assignment_phases (
        assignment_id, source_phase_id, title, description, order_index,
        status, progress_percent, created_by, updated_by
      )
      SELECT
        v_assignment_id,
        phase.id,
        phase.title,
        phase.description,
        phase.order_index,
        'not_started',
        0,
        v_admin_id,
        v_admin_id
      FROM track_phases phase
      WHERE phase.id = v_phase_id
      RETURNING id INTO v_assignment_phase_id;

      FOR v_task_id IN
        SELECT id
        FROM track_tasks
        WHERE track_phase_id = v_phase_id
        ORDER BY order_index
      LOOP
        INSERT INTO assignment_tasks (
          assignment_id, assignment_phase_id, source_task_id, title, description,
          instructions, task_type, required, order_index, estimated_minutes,
          passing_score, metadata, due_date, status, progress_percent,
          is_next_recommended, created_by, updated_by
        )
        SELECT
          v_assignment_id,
          v_assignment_phase_id,
          task.id,
          task.title,
          task.description,
          task.instructions,
          task.task_type,
          task.required,
          task.order_index,
          task.estimated_minutes,
          task.passing_score,
          task.metadata,
          CURRENT_DATE + COALESCE(task.due_days_offset, 0),
          'not_started',
          0,
          FALSE,
          v_admin_id,
          v_admin_id
        FROM track_tasks task
        WHERE task.id = v_task_id
        RETURNING id INTO v_task_id;

        IF v_first_assignment_task_id IS NULL THEN
          v_first_assignment_task_id := v_task_id;
        END IF;
      END LOOP;
    END LOOP;

    IF v_first_assignment_task_id IS NOT NULL THEN
      UPDATE assignment_tasks
      SET is_next_recommended = TRUE
      WHERE id = v_first_assignment_task_id;
    END IF;
  END IF;

  INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, status, details)
  VALUES
    (v_super_admin_id, 'seed_demo_users', 'users', NULL, 'success', jsonb_build_object('count', 6)),
    (v_admin_id, 'seed_demo_tracks', 'track_templates', NULL, 'success', jsonb_build_object('tracks', 2)),
    (v_admin_id, 'seed_demo_assignment', 'onboarding_assignments', v_assignment_id, 'success', jsonb_build_object('employee', v_employee_one_id))
  ON CONFLICT DO NOTHING;
END
$seed$;

