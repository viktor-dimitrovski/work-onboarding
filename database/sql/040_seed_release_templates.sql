-- Seed release-related track templates (Release/Hotfix/Tenant Creation/Work Order).
-- Requires track_type columns (migration 0013_release_tracks_and_assignment_metadata).

DO $seed$
DECLARE
  v_admin_id UUID;

  v_template_id UUID;
  v_version_id UUID;
  v_phase_id UUID;
  v_task_id UUID;
  phase_item JSONB;
  task_item JSONB;
  phase_order INTEGER;
  task_order INTEGER;

  release_def JSONB := $$[
    {
      "title": "Phase 1: Engineering readiness",
      "description": "Finalize code quality and merge readiness.",
      "tasks": [
        {"title":"Code review complete","task_type":"checklist","instructions":"Ensure all PRs are reviewed and approved.","required":true,"estimated_minutes":20,"due_days_offset":1,"metadata":{"gate":true}},
        {"title":"Merge feature → release branch","task_type":"checklist","instructions":"Merge approved changes into release branch.","required":true,"estimated_minutes":15,"due_days_offset":1,"metadata":{"gate":true}},
        {"title":"Resolve merge conflicts checklist","task_type":"checklist","instructions":"Validate conflict resolution and run tests.","required":true,"estimated_minutes":25,"due_days_offset":2,"metadata":{}}
      ]
    },
    {
      "title": "Phase 2: QA & testing",
      "description": "Execute smoke/regression/UAT as needed.",
      "tasks": [
        {"title":"Pre-prod smoke testing","task_type":"checklist","instructions":"Run smoke tests in staging/pre-prod.","required":true,"estimated_minutes":30,"due_days_offset":3,"metadata":{"gate":true}},
        {"title":"Regression & sanity checks","task_type":"checklist","instructions":"Complete regression checklist.","required":true,"estimated_minutes":45,"due_days_offset":4,"metadata":{}},
        {"title":"UAT sign-off","task_type":"mentor_approval","instructions":"Collect UAT sign-off if required.","required":false,"estimated_minutes":20,"due_days_offset":5,"metadata":{"gate":true}}
      ]
    },
    {
      "title": "Phase 3: Release preparation",
      "description": "Versioning and notes.",
      "tasks": [
        {"title":"Tag version (semantic)","task_type":"checklist","instructions":"Create Git tag per service/versioning policy.","required":true,"estimated_minutes":15,"due_days_offset":6,"metadata":{"gate":true}},
        {"title":"Draft release notes","task_type":"checklist","instructions":"Summarize changes and link notes.","required":true,"estimated_minutes":30,"due_days_offset":6,"metadata":{}},
        {"title":"Generate aggregated WOs","task_type":"checklist","instructions":"Aggregate WOs into REL.","required":true,"estimated_minutes":15,"due_days_offset":6,"metadata":{}}
      ]
    },
    {
      "title": "Phase 4: Deployment & verification",
      "description": "Execute deploy and post-release checks.",
      "tasks": [
        {"title":"Deploy to production (runbook)","task_type":"external_link","instructions":"Follow runbook and record timing.","required":true,"estimated_minutes":45,"due_days_offset":7,"metadata":{"gate":true}},
        {"title":"Post-release smoke tests","task_type":"checklist","instructions":"Run smoke tests post deploy.","required":true,"estimated_minutes":25,"due_days_offset":7,"metadata":{"gate":true}},
        {"title":"Monitor logs and error rates","task_type":"checklist","instructions":"Observe metrics and logs for anomalies.","required":true,"estimated_minutes":30,"due_days_offset":8,"metadata":{}}
      ]
    }
  ]$$::jsonb;

  hotfix_def JSONB := $$[
    {
      "title": "Phase 1: Hotfix readiness",
      "description": "Fast review + validation.",
      "tasks": [
        {"title":"Code review (hotfix)","task_type":"checklist","instructions":"Quick review + approval.","required":true,"estimated_minutes":15,"due_days_offset":1,"metadata":{"gate":true}},
        {"title":"Targeted regression checklist","task_type":"checklist","instructions":"Validate impacted areas.","required":true,"estimated_minutes":20,"due_days_offset":1,"metadata":{}}
      ]
    },
    {
      "title": "Phase 2: Deploy & verify",
      "description": "Deploy hotfix and verify.",
      "tasks": [
        {"title":"Deploy hotfix","task_type":"external_link","instructions":"Deploy following hotfix runbook.","required":true,"estimated_minutes":30,"due_days_offset":2,"metadata":{"gate":true}},
        {"title":"Post-deploy verification","task_type":"checklist","instructions":"Confirm issue resolved and metrics stable.","required":true,"estimated_minutes":20,"due_days_offset":2,"metadata":{"gate":true}}
      ]
    }
  ]$$::jsonb;

  tenant_def JSONB := $$[
    {
      "title": "Phase 1: Provisioning",
      "description": "Tenant provisioning and DNS.",
      "tasks": [
        {"title":"DNS / Cloudflare setup","task_type":"checklist","instructions":"Create DNS entries and SSL.","required":true,"estimated_minutes":30,"due_days_offset":1,"metadata":{"gate":true}},
        {"title":"Create tenant record","task_type":"checklist","instructions":"Create tenant + enable modules.","required":true,"estimated_minutes":20,"due_days_offset":1,"metadata":{}}
      ]
    },
    {
      "title": "Phase 2: Configuration",
      "description": "Secrets and integrations.",
      "tasks": [
        {"title":"Secrets & credentials","task_type":"checklist","instructions":"Provision secrets and API keys.","required":true,"estimated_minutes":30,"due_days_offset":2,"metadata":{"gate":true}},
        {"title":"Environment config","task_type":"checklist","instructions":"Set env vars and feature flags.","required":true,"estimated_minutes":25,"due_days_offset":2,"metadata":{}}
      ]
    },
    {
      "title": "Phase 3: Deployment & smoke",
      "description": "Deploy and validate tenant.",
      "tasks": [
        {"title":"Deploy tenant services","task_type":"checklist","instructions":"Deploy to target env.","required":true,"estimated_minutes":40,"due_days_offset":3,"metadata":{"gate":true}},
        {"title":"Smoke testing","task_type":"checklist","instructions":"Run tenant smoke tests.","required":true,"estimated_minutes":30,"due_days_offset":3,"metadata":{"gate":true}}
      ]
    },
    {
      "title": "Phase 4: Handover",
      "description": "Finalize docs and handover.",
      "tasks": [
        {"title":"Handover notes","task_type":"checklist","instructions":"Provide runbooks and ownership.","required":true,"estimated_minutes":20,"due_days_offset":4,"metadata":{}}
      ]
    }
  ]$$::jsonb;

  work_order_def JSONB := $$[
    {
      "title": "Phase 1: Request",
      "description": "Capture scope and requirements.",
      "tasks": [
        {"title":"Define request scope","task_type":"checklist","instructions":"Capture scope, links, and dependencies.","required":true,"estimated_minutes":20,"due_days_offset":1,"metadata":{}}
      ]
    },
    {
      "title": "Phase 2: Approval",
      "description": "Review and approval.",
      "tasks": [
        {"title":"Approval gate","task_type":"mentor_approval","instructions":"Obtain approval to execute.","required":true,"estimated_minutes":15,"due_days_offset":2,"metadata":{"gate":true}}
      ]
    },
    {
      "title": "Phase 3: Execution",
      "description": "Perform the work order.",
      "tasks": [
        {"title":"Execute tasks","task_type":"checklist","instructions":"Complete planned actions.","required":true,"estimated_minutes":60,"due_days_offset":3,"metadata":{}}
      ]
    },
    {
      "title": "Phase 4: Verification",
      "description": "Verify outcomes.",
      "tasks": [
        {"title":"Verify results","task_type":"checklist","instructions":"Validate outcome and metrics.","required":true,"estimated_minutes":20,"due_days_offset":4,"metadata":{"gate":true}}
      ]
    },
    {
      "title": "Phase 5: Closure",
      "description": "Close and document.",
      "tasks": [
        {"title":"Close work order","task_type":"checklist","instructions":"Finalize docs and close.","required":true,"estimated_minutes":10,"due_days_offset":5,"metadata":{}}
      ]
    }
  ]$$::jsonb;
BEGIN
  SELECT id INTO v_admin_id FROM users ORDER BY created_at ASC LIMIT 1;

  -- Release (standard)
  SELECT id INTO v_template_id FROM track_templates WHERE title = 'Release (Standard)' LIMIT 1;
  IF v_template_id IS NULL THEN
    INSERT INTO track_templates (
      title, description, role_target, estimated_duration_days, tags, purpose, track_type, created_by, updated_by
    )
    VALUES (
      'Release (Standard)',
      'Standard release flow with gates and verification.',
      'release_manager',
      14,
      '["release"]'::jsonb,
      'release',
      'RELEASE',
      v_admin_id,
      v_admin_id
    )
    RETURNING id INTO v_template_id;

    INSERT INTO track_versions (
      template_id, version_number, status, title, description, estimated_duration_days,
      tags, purpose, track_type, is_current, published_at, created_by, updated_by
    )
    VALUES (
      v_template_id,
      1,
      'published',
      'Release (Standard)',
      'Published baseline for standard releases.',
      14,
      '["release"]'::jsonb,
      'release',
      'RELEASE',
      TRUE,
      NOW(),
      v_admin_id,
      v_admin_id
    )
    RETURNING id INTO v_version_id;

    phase_order := 0;
    FOR phase_item IN SELECT value FROM jsonb_array_elements(release_def)
    LOOP
      INSERT INTO track_phases (track_version_id, title, description, order_index, created_by, updated_by)
      VALUES (v_version_id, phase_item->>'title', phase_item->>'description', phase_order, v_admin_id, v_admin_id)
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
          COALESCE(task_item->'metadata', '{}'::jsonb),
          NULLIF(task_item->>'due_days_offset', '')::INTEGER,
          v_admin_id,
          v_admin_id
        )
        RETURNING id INTO v_task_id;

        task_order := task_order + 1;
      END LOOP;
      phase_order := phase_order + 1;
    END LOOP;
  END IF;

  -- Release (Hotfix)
  SELECT id INTO v_template_id FROM track_templates WHERE title = 'Release (Hotfix)' LIMIT 1;
  IF v_template_id IS NULL THEN
    INSERT INTO track_templates (
      title, description, role_target, estimated_duration_days, tags, purpose, track_type, created_by, updated_by
    )
    VALUES (
      'Release (Hotfix)',
      'Hotfix release flow with tighter gates.',
      'release_manager',
      7,
      '["release","hotfix"]'::jsonb,
      'release',
      'RELEASE',
      v_admin_id,
      v_admin_id
    )
    RETURNING id INTO v_template_id;

    INSERT INTO track_versions (
      template_id, version_number, status, title, description, estimated_duration_days,
      tags, purpose, track_type, is_current, published_at, created_by, updated_by
    )
    VALUES (
      v_template_id,
      1,
      'published',
      'Release (Hotfix)',
      'Published baseline for hotfix releases.',
      7,
      '["release","hotfix"]'::jsonb,
      'release',
      'RELEASE',
      TRUE,
      NOW(),
      v_admin_id,
      v_admin_id
    )
    RETURNING id INTO v_version_id;

    phase_order := 0;
    FOR phase_item IN SELECT value FROM jsonb_array_elements(hotfix_def)
    LOOP
      INSERT INTO track_phases (track_version_id, title, description, order_index, created_by, updated_by)
      VALUES (v_version_id, phase_item->>'title', phase_item->>'description', phase_order, v_admin_id, v_admin_id)
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
          COALESCE(task_item->'metadata', '{}'::jsonb),
          NULLIF(task_item->>'due_days_offset', '')::INTEGER,
          v_admin_id,
          v_admin_id
        )
        RETURNING id INTO v_task_id;
        task_order := task_order + 1;
      END LOOP;
      phase_order := phase_order + 1;
    END LOOP;
  END IF;

  -- Tenant creation
  SELECT id INTO v_template_id FROM track_templates WHERE title = 'Tenant creation' LIMIT 1;
  IF v_template_id IS NULL THEN
    INSERT INTO track_templates (
      title, description, role_target, estimated_duration_days, tags, purpose, track_type, created_by, updated_by
    )
    VALUES (
      'Tenant creation',
      'Tenant provisioning and deployment workflow.',
      'ops',
      10,
      '["tenant","ops"]'::jsonb,
      'tenant_creation',
      'TENANT_CREATION',
      v_admin_id,
      v_admin_id
    )
    RETURNING id INTO v_template_id;

    INSERT INTO track_versions (
      template_id, version_number, status, title, description, estimated_duration_days,
      tags, purpose, track_type, is_current, published_at, created_by, updated_by
    )
    VALUES (
      v_template_id,
      1,
      'published',
      'Tenant creation',
      'Published baseline for tenant creation.',
      10,
      '["tenant","ops"]'::jsonb,
      'tenant_creation',
      'TENANT_CREATION',
      TRUE,
      NOW(),
      v_admin_id,
      v_admin_id
    )
    RETURNING id INTO v_version_id;

    phase_order := 0;
    FOR phase_item IN SELECT value FROM jsonb_array_elements(tenant_def)
    LOOP
      INSERT INTO track_phases (track_version_id, title, description, order_index, created_by, updated_by)
      VALUES (v_version_id, phase_item->>'title', phase_item->>'description', phase_order, v_admin_id, v_admin_id)
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
          COALESCE(task_item->'metadata', '{}'::jsonb),
          NULLIF(task_item->>'due_days_offset', '')::INTEGER,
          v_admin_id,
          v_admin_id
        )
        RETURNING id INTO v_task_id;
        task_order := task_order + 1;
      END LOOP;
      phase_order := phase_order + 1;
    END LOOP;
  END IF;

  -- Work order template (optional runtime flow)
  SELECT id INTO v_template_id FROM track_templates WHERE title = 'Work order' LIMIT 1;
  IF v_template_id IS NULL THEN
    INSERT INTO track_templates (
      title, description, role_target, estimated_duration_days, tags, purpose, track_type, created_by, updated_by
    )
    VALUES (
      'Work order',
      'Workflow for executing work orders.',
      'ops',
      5,
      '["work-order"]'::jsonb,
      'work_order',
      'WORK_ORDER',
      v_admin_id,
      v_admin_id
    )
    RETURNING id INTO v_template_id;

    INSERT INTO track_versions (
      template_id, version_number, status, title, description, estimated_duration_days,
      tags, purpose, track_type, is_current, published_at, created_by, updated_by
    )
    VALUES (
      v_template_id,
      1,
      'published',
      'Work order',
      'Published baseline for work orders.',
      5,
      '["work-order"]'::jsonb,
      'work_order',
      'WORK_ORDER',
      TRUE,
      NOW(),
      v_admin_id,
      v_admin_id
    )
    RETURNING id INTO v_version_id;

    phase_order := 0;
    FOR phase_item IN SELECT value FROM jsonb_array_elements(work_order_def)
    LOOP
      INSERT INTO track_phases (track_version_id, title, description, order_index, created_by, updated_by)
      VALUES (v_version_id, phase_item->>'title', phase_item->>'description', phase_order, v_admin_id, v_admin_id)
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
          COALESCE(task_item->'metadata', '{}'::jsonb),
          NULLIF(task_item->>'due_days_offset', '')::INTEGER,
          v_admin_id,
          v_admin_id
        )
        RETURNING id INTO v_task_id;
        task_order := task_order + 1;
      END LOOP;
      phase_order := phase_order + 1;
    END LOOP;
  END IF;
END
$seed$;
