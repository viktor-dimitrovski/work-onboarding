-- Seed Open Banking Platform release track templates.
-- Three variants: Full Release (5 phases), DC Extension Deployment (3 phases),
-- Security/Emergency Release (5 phases, compressed).
-- Requires release_mgmt schema (migration 0016) and track_type (migration 0013).

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

  ob_full_def JSONB := $$[
    {
      "title": "Phase 1: Code Freeze & Engineering Readiness",
      "description": "Freeze code, tag all changed components, validate API contracts.",
      "tasks": [
        {"title":"All WO PRs reviewed and approved","task_type":"checklist","instructions":"Ensure every PR across all Work Order repos has been reviewed and approved by at least one reviewer.","required":true,"estimated_minutes":30,"due_days_offset":1,"metadata":{"gate":false}},
        {"title":"Merge feature → release branch per WO repo","task_type":"checklist","instructions":"Merge approved changes from feature branches into the release branch for each repository touched by any WO in this release.","required":true,"estimated_minutes":20,"due_days_offset":1,"metadata":{"gate":false}},
        {"title":"Resolve merge conflicts across all repos","task_type":"checklist","instructions":"Validate conflict resolution in all repos. Run unit tests after merging to confirm stability.","required":true,"estimated_minutes":30,"due_days_offset":2,"metadata":{"gate":false}},
        {"title":"Semantic version tag applied per changed component","task_type":"checklist","instructions":"Apply semver tags (x.y.z) to all changed services. For config repos, use the bank/country prefix format (e.g. pl_pko_1.3.2). Tag must match the release notes document.","required":true,"estimated_minutes":20,"due_days_offset":2,"metadata":{"gate":false}},
        {"title":"OpenAPI contract diff check","task_type":"checklist","instructions":"Run API contract diff for any Open Banking API surface changes. Document breaking changes and deprecations.","required":true,"estimated_minutes":25,"due_days_offset":2,"metadata":{"gate":false}},
        {"title":"Engineering lead sign-off","task_type":"mentor_approval","instructions":"Engineering lead confirms all repos are tagged, merged, and ready for QA. This is a hard gate — QA cannot start until approved.","required":true,"estimated_minutes":10,"due_days_offset":3,"metadata":{"gate":true}}
      ]
    },
    {
      "title": "Phase 2: QA & Testing",
      "description": "Full quality assurance including Open Banking compliance and multi-tenant isolation.",
      "tasks": [
        {"title":"Pre-prod smoke tests — all services","task_type":"checklist","instructions":"Deploy all changed services to pre-prod environment. Run smoke tests to verify basic functionality is intact.","required":true,"estimated_minutes":45,"due_days_offset":4,"metadata":{"gate":false}},
        {"title":"Open Banking compliance test run","task_type":"checklist","instructions":"Run PSD2 / FAPI / Open Banking UK standard validation suite. All mandatory checks must pass. Document any exceptions with justification.","required":true,"estimated_minutes":60,"due_days_offset":5,"metadata":{"gate":false}},
        {"title":"Multi-tenant isolation regression check","task_type":"checklist","instructions":"Verify no cross-tenant data leakage. Run tenant isolation test suite. Check API responses for tenant boundary correctness.","required":true,"estimated_minutes":40,"due_days_offset":5,"metadata":{"gate":false}},
        {"title":"Security & dependency scan","task_type":"checklist","instructions":"Run OWASP dependency audit and container image vulnerability scan for all changed services. Critical/High findings must be resolved before proceeding.","required":true,"estimated_minutes":30,"due_days_offset":5,"metadata":{"gate":false}},
        {"title":"Postman collection run (aggregated from WOs)","task_type":"checklist","instructions":"Run Postman collections referenced in the included Work Orders (postman_testing_ref field). All collections must pass.","required":false,"estimated_minutes":45,"due_days_offset":6,"metadata":{"gate":false}},
        {"title":"UAT sign-off","task_type":"mentor_approval","instructions":"Product owner or designated stakeholder signs off on user acceptance testing. UAT report must be attached or linked.","required":true,"estimated_minutes":15,"due_days_offset":7,"metadata":{"gate":true}}
      ]
    },
    {
      "title": "Phase 3: Release Preparation",
      "description": "Finalize release notes, generate the release plan, obtain CAB approval, and confirm deployment window.",
      "tasks": [
        {"title":"Release Notes finalized and published for all changed services","task_type":"checklist","instructions":"All Release Notes documents in the Release Notes module must be in Published status for each service/config version included in this release. Co-authors must have completed their contributions.","required":true,"estimated_minutes":30,"due_days_offset":8,"metadata":{"gate":false}},
        {"title":"Generate Release Plan","task_type":"checklist","instructions":"In the Platform Releases module: click Generate Release Plan on this release. The system will auto-aggregate: (1) services union with latest semver per (repo, branch), (2) changelog grouped by type, (3) deployment steps ordered per service. Review the generated output before proceeding.","required":true,"estimated_minutes":20,"due_days_offset":8,"metadata":{"gate":false}},
        {"title":"Rollback plan prepared per DC","task_type":"checklist","instructions":"Prepare rollback runbook for each target DC: kubectl rollout undo commands per service, DB rollback scripts if migrations are included, config repo git revert steps.","required":true,"estimated_minutes":45,"due_days_offset":9,"metadata":{"gate":false}},
        {"title":"Tenant communications drafted","task_type":"checklist","instructions":"Draft release changelog communication for affected tenants. Include: new features summary, API deprecations (if any), breaking changes notice with migration guide.","required":false,"estimated_minutes":30,"due_days_offset":9,"metadata":{"gate":false}},
        {"title":"Deployment window confirmed with Ops","task_type":"checklist","instructions":"Confirm deployment date/time window with the Ops team for each target DC. Update the release record with scheduled windows.","required":true,"estimated_minutes":15,"due_days_offset":9,"metadata":{"gate":false}},
        {"title":"CAB approval","task_type":"mentor_approval","instructions":"Change Advisory Board approver reviews and approves: generated services list, changelog, deployment steps, and rollback plan. Approval is required before any deployment can proceed.","required":true,"estimated_minutes":15,"due_days_offset":10,"metadata":{"gate":true}}
      ]
    },
    {
      "title": "Phase 4: Deployment & Verification on Target DC",
      "description": "Execute deployment to the primary/target DC, run all verification checks.",
      "tasks": [
        {"title":"Pre-deploy: DB backup and freeze check","task_type":"checklist","instructions":"Verify latest DB backup exists and is restorable. Confirm no other deployments are in progress on the target DC.","required":true,"estimated_minutes":15,"due_days_offset":11,"metadata":{"gate":false}},
        {"title":"Deploy services per deploy_list (runbook)","task_type":"external_link","instructions":"Follow the generated Deployment Steps from the Platform Release (Deployment Steps tab). Deploy services in the documented order. Record exact deployment time and any deviations.","required":true,"estimated_minutes":60,"due_days_offset":11,"metadata":{"gate":false}},
        {"title":"DB migrations executed and verified","task_type":"checklist","instructions":"Run all database migrations included in the release. Verify migrations succeeded (row counts, constraint checks). Run idempotency check.","required":true,"estimated_minutes":20,"due_days_offset":11,"metadata":{"gate":false}},
        {"title":"Post-deploy smoke tests on DC","task_type":"checklist","instructions":"Run smoke test suite against the target DC production environment. All critical paths must pass.","required":true,"estimated_minutes":30,"due_days_offset":11,"metadata":{"gate":false}},
        {"title":"Open Banking API health check on DC","task_type":"checklist","instructions":"Verify Open Banking API endpoints are responding correctly: /accounts, /transactions, /payments, /consents. Check PSD2 compliance headers are present.","required":true,"estimated_minutes":20,"due_days_offset":11,"metadata":{"gate":false}},
        {"title":"Internal fictive bank verification — full happy-path","task_type":"external_link","instructions":"Run the internal fictive bank verification suite against the target DC. This uses a dedicated internal test tenant (not real customer data). Verify complete happy-path flows: account creation, payment initiation, consent flow, transaction retrieval.","required":true,"estimated_minutes":30,"due_days_offset":11,"metadata":{"gate":false}},
        {"title":"30-min monitoring window","task_type":"checklist","instructions":"Monitor for 30 minutes after deployment: error rate (should be < baseline), p95 latency, upstream bank connection health, memory and CPU on all deployed services.","required":true,"estimated_minutes":30,"due_days_offset":11,"metadata":{"gate":false}},
        {"title":"Ops sign-off — DC deployed","task_type":"mentor_approval","instructions":"Ops lead confirms deployment is successful and all checks passed. This marks the DC as deployed in the system.","required":true,"estimated_minutes":10,"due_days_offset":12,"metadata":{"gate":true}}
      ]
    },
    {
      "title": "Phase 5: Post-Release Closure",
      "description": "Extended monitoring, tenant communications, WO closure, and retrospective.",
      "tasks": [
        {"title":"48h monitoring watch","task_type":"checklist","instructions":"Monitor for 48 hours: error rate trends, p95/p99 latency, upstream bank connection stability, memory leaks, unusual auth patterns. Document any anomalies.","required":true,"estimated_minutes":30,"due_days_offset":13,"metadata":{"gate":false}},
        {"title":"Tenant-facing changelog published","task_type":"checklist","instructions":"Publish the release changelog to the tenant-facing portal or notification channel. Include: new features, bug fixes, security improvements, API changes, deprecation notices.","required":false,"estimated_minutes":20,"due_days_offset":13,"metadata":{"gate":false}},
        {"title":"Mark all WOs as deployed on this DC","task_type":"checklist","instructions":"In the Platform Releases module: use Record Deployment to mark all included Work Orders as deployed to the target DC. This updates deployment status visible in the Work Orders list.","required":true,"estimated_minutes":10,"due_days_offset":13,"metadata":{"gate":false}},
        {"title":"Retrospective notes captured","task_type":"checklist","instructions":"Document: what went well, what went wrong, deployment duration vs estimate, any issues encountered and resolutions. Save to the release record.","required":false,"estimated_minutes":30,"due_days_offset":14,"metadata":{"gate":false}},
        {"title":"Release archived and closed","task_type":"checklist","instructions":"Set release status to Closed in the Platform Releases module. Archive release documentation.","required":true,"estimated_minutes":10,"due_days_offset":14,"metadata":{"gate":false}}
      ]
    }
  ]$$::jsonb;

  ob_dc_extension_def JSONB := $$[
    {
      "title": "Phase 1: Pre-Deployment Verification on Additional DC",
      "description": "Confirm images are available and the DC is ready. No tagging, merging, or CAB needed — all done for the primary DC.",
      "tasks": [
        {"title":"Confirm release plan versions match available images on new DC","task_type":"checklist","instructions":"Verify all container images from the release services_snapshot are available in the container registry accessible to the additional DC. Tag versions must exactly match the snapshot.","required":true,"estimated_minutes":15,"due_days_offset":1,"metadata":{"gate":false}},
        {"title":"DB backup verified on additional DC","task_type":"checklist","instructions":"Verify a current backup exists for the additional DC database. Confirm it is restorable. Check backup timestamp is within acceptable window.","required":true,"estimated_minutes":15,"due_days_offset":1,"metadata":{"gate":false}},
        {"title":"Freeze check — no conflicting deployments","task_type":"checklist","instructions":"Confirm no other deployments are running or scheduled on the additional DC during the deployment window.","required":true,"estimated_minutes":10,"due_days_offset":1,"metadata":{"gate":false}},
        {"title":"Ops sign-off to proceed","task_type":"mentor_approval","instructions":"Ops lead confirms the additional DC is ready for deployment. All pre-checks passed.","required":true,"estimated_minutes":10,"due_days_offset":1,"metadata":{"gate":true}}
      ]
    },
    {
      "title": "Phase 2: Deployment on Additional DC",
      "description": "Full deployment and verification on the additional DC using the same release plan as the primary DC.",
      "tasks": [
        {"title":"Deploy services per deploy_list (same order as primary DC)","task_type":"external_link","instructions":"Follow the same Deployment Steps from the original Platform Release. Deploy services in documented order to the additional DC. Record exact deployment time.","required":true,"estimated_minutes":60,"due_days_offset":2,"metadata":{"gate":false}},
        {"title":"DB migrations executed on additional DC","task_type":"checklist","instructions":"Run all DB migrations on the additional DC. Verify success. Run idempotency check.","required":true,"estimated_minutes":20,"due_days_offset":2,"metadata":{"gate":false}},
        {"title":"Post-deploy smoke tests on additional DC","task_type":"checklist","instructions":"Run smoke test suite against the additional DC environment.","required":true,"estimated_minutes":30,"due_days_offset":2,"metadata":{"gate":false}},
        {"title":"Open Banking API health check on additional DC","task_type":"checklist","instructions":"Verify all Open Banking API endpoints are responding. Check compliance headers.","required":true,"estimated_minutes":20,"due_days_offset":2,"metadata":{"gate":false}},
        {"title":"Internal fictive bank verification on additional DC","task_type":"external_link","instructions":"Run the internal fictive bank verification suite against the additional DC. Verify complete happy-path flows.","required":true,"estimated_minutes":30,"due_days_offset":2,"metadata":{"gate":false}},
        {"title":"30-min monitoring window on additional DC","task_type":"checklist","instructions":"Monitor for 30 minutes: error rate, latency, upstream bank health, CPU/memory.","required":true,"estimated_minutes":30,"due_days_offset":2,"metadata":{"gate":false}},
        {"title":"Ops sign-off — additional DC deployed","task_type":"mentor_approval","instructions":"Ops lead confirms deployment to additional DC is successful.","required":true,"estimated_minutes":10,"due_days_offset":2,"metadata":{"gate":true}}
      ]
    },
    {
      "title": "Phase 3: Closure for Additional DC",
      "description": "Record deployment and verify cross-DC consistency.",
      "tasks": [
        {"title":"Record WO deployments on additional DC","task_type":"checklist","instructions":"In Platform Releases: use Record Deployment to mark all included WOs as deployed to the additional DC.","required":true,"estimated_minutes":10,"due_days_offset":3,"metadata":{"gate":false}},
        {"title":"Cross-DC consistency check","task_type":"checklist","instructions":"If a shared data tier exists: verify data replication consistency between primary and additional DC. Check replication lag, queue depths, and data checksums.","required":false,"estimated_minutes":20,"due_days_offset":3,"metadata":{"gate":false}}
      ]
    }
  ]$$::jsonb;

  ob_security_def JSONB := $$[
    {
      "title": "Phase 1: Emergency Readiness",
      "description": "Fast-track code review and tagging. Compressed timeline — hours not days.",
      "tasks": [
        {"title":"Security hotfix PR reviewed and approved","task_type":"checklist","instructions":"EMERGENCY: Code review must be completed within 2 hours. At least one senior engineer must approve. Focus review on the security fix scope only.","required":true,"estimated_minutes":60,"due_days_offset":1,"metadata":{"gate":false}},
        {"title":"Merge to release branch and tag","task_type":"checklist","instructions":"Merge approved fix to release branch. Apply semver patch tag (x.y.Z+1). For config: bank_x.y.Z+1.","required":true,"estimated_minutes":15,"due_days_offset":1,"metadata":{"gate":false}},
        {"title":"Engineering lead sign-off","task_type":"mentor_approval","instructions":"Engineering lead confirms fix is correct and scoped. Emergency CAB: 2h SLA for approval.","required":true,"estimated_minutes":10,"due_days_offset":1,"metadata":{"gate":true}}
      ]
    },
    {
      "title": "Phase 2: Targeted QA",
      "description": "Minimal QA focused on the security fix scope and regression of impacted areas.",
      "tasks": [
        {"title":"Targeted regression of impacted areas","task_type":"checklist","instructions":"Run regression tests specifically for components affected by the security fix. Full regression is waived for emergency releases but must be documented.","required":true,"estimated_minutes":30,"due_days_offset":1,"metadata":{"gate":false}},
        {"title":"Security scan on patched services","task_type":"checklist","instructions":"MANDATORY GATE: Run security scan on the patched container images. No Critical or High vulnerabilities may remain. This is a hard gate regardless of timeline pressure.","required":true,"estimated_minutes":20,"due_days_offset":1,"metadata":{"gate":true}},
        {"title":"Smoke tests in pre-prod","task_type":"checklist","instructions":"Run minimal smoke tests in pre-prod. Document any skipped tests and reason.","required":true,"estimated_minutes":20,"due_days_offset":1,"metadata":{"gate":false}}
      ]
    },
    {
      "title": "Phase 3: Release Preparation",
      "description": "Minimal release prep — security advisory, emergency CAB.",
      "tasks": [
        {"title":"Security Release Notes published","task_type":"checklist","instructions":"Publish Release Notes with security item type. Include: CVE reference if applicable, severity, affected versions, fix summary.","required":true,"estimated_minutes":20,"due_days_offset":1,"metadata":{"gate":false}},
        {"title":"Generate Release Plan","task_type":"checklist","instructions":"Generate the Platform Release plan from selected WOs. Review services list and deployment steps.","required":true,"estimated_minutes":10,"due_days_offset":1,"metadata":{"gate":false}},
        {"title":"Emergency CAB approval","task_type":"mentor_approval","instructions":"Emergency Change Advisory Board — 2h response SLA. Approver reviews security advisory, fix scope, and deployment plan. Documents approval with timestamp.","required":true,"estimated_minutes":10,"due_days_offset":1,"metadata":{"gate":true}}
      ]
    },
    {
      "title": "Phase 4: Emergency Deployment & Verification",
      "description": "Deploy security patch and verify — same rigor as standard deployment.",
      "tasks": [
        {"title":"DB backup verified","task_type":"checklist","instructions":"Verify current backup before deployment even in emergency.","required":true,"estimated_minutes":10,"due_days_offset":2,"metadata":{"gate":false}},
        {"title":"Deploy security patch per deploy_list","task_type":"external_link","instructions":"Deploy following generated deployment steps. Record timing. Security patches must be deployed as quickly as possible after CAB approval.","required":true,"estimated_minutes":30,"due_days_offset":2,"metadata":{"gate":false}},
        {"title":"Post-deploy smoke tests","task_type":"checklist","instructions":"Run smoke tests to confirm service is operational after patch.","required":true,"estimated_minutes":20,"due_days_offset":2,"metadata":{"gate":false}},
        {"title":"Security fix verification","task_type":"checklist","instructions":"Verify the security vulnerability is remediated: run the exploit scenario (in a safe test environment) and confirm it no longer succeeds. Document verification method and result.","required":true,"estimated_minutes":20,"due_days_offset":2,"metadata":{"gate":false}},
        {"title":"Internal fictive bank verification","task_type":"external_link","instructions":"Run internal bank verification flows to confirm production platform is operational.","required":true,"estimated_minutes":20,"due_days_offset":2,"metadata":{"gate":false}},
        {"title":"Ops sign-off","task_type":"mentor_approval","instructions":"Ops lead confirms security patch deployed and verified.","required":true,"estimated_minutes":10,"due_days_offset":2,"metadata":{"gate":true}}
      ]
    },
    {
      "title": "Phase 5: Post-Patch Monitoring & Disclosure",
      "description": "Monitor, communicate, and document the security incident.",
      "tasks": [
        {"title":"24h monitoring watch","task_type":"checklist","instructions":"Monitor for 24 hours post-patch for any anomalies related to the security fix. Check auth patterns, access logs, error rates.","required":true,"estimated_minutes":20,"due_days_offset":3,"metadata":{"gate":false}},
        {"title":"Security advisory published","task_type":"checklist","instructions":"If required by policy or regulations: publish security advisory to affected tenants. Coordinate with legal/compliance if needed.","required":false,"estimated_minutes":30,"due_days_offset":3,"metadata":{"gate":false}},
        {"title":"Mark WOs as deployed","task_type":"checklist","instructions":"Record deployment in Platform Releases for all affected DCs.","required":true,"estimated_minutes":10,"due_days_offset":3,"metadata":{"gate":false}},
        {"title":"Incident retrospective","task_type":"checklist","instructions":"Document the security incident: root cause, detection method, fix timeline, and preventive measures. Store in the release record.","required":true,"estimated_minutes":45,"due_days_offset":4,"metadata":{"gate":false}}
      ]
    }
  ]$$::jsonb;

BEGIN
  SELECT id INTO v_admin_id FROM users ORDER BY created_at ASC LIMIT 1;

  -- Template 1: OB Platform — Full Release
  SELECT id INTO v_template_id FROM track_templates WHERE title = 'OB Platform — Full Release' LIMIT 1;
  IF v_template_id IS NULL THEN
    INSERT INTO track_templates (
      title, description, role_target, estimated_duration_days, tags, purpose, track_type, created_by, updated_by
    ) VALUES (
      'OB Platform — Full Release',
      'Standard quarterly/ad-hoc Open Banking Platform release. 5 phases covering engineering readiness, QA, release preparation, deployment, and closure. Includes Open Banking compliance checks, multi-tenant isolation, and fictive bank verification.',
      'release_manager',
      14,
      '["release","open-banking","quarterly"]'::jsonb,
      'release',
      'RELEASE',
      v_admin_id, v_admin_id
    ) RETURNING id INTO v_template_id;

    INSERT INTO track_versions (
      template_id, version_number, status, title, description, estimated_duration_days,
      tags, purpose, track_type, is_current, published_at, created_by, updated_by
    ) VALUES (
      v_template_id, 1, 'published',
      'OB Platform — Full Release',
      'Published baseline for OB Platform full release (quarterly, ad-hoc, bugfix).',
      14,
      '["release","open-banking","quarterly"]'::jsonb,
      'release', 'RELEASE', TRUE, NOW(), v_admin_id, v_admin_id
    ) RETURNING id INTO v_version_id;

    phase_order := 0;
    FOR phase_item IN SELECT value FROM jsonb_array_elements(ob_full_def) LOOP
      INSERT INTO track_phases (track_version_id, title, description, order_index, created_by, updated_by)
      VALUES (v_version_id, phase_item->>'title', phase_item->>'description', phase_order, v_admin_id, v_admin_id)
      RETURNING id INTO v_phase_id;
      task_order := 0;
      FOR task_item IN SELECT value FROM jsonb_array_elements(phase_item->'tasks') LOOP
        INSERT INTO track_tasks (
          track_phase_id, title, description, instructions, task_type, required,
          order_index, estimated_minutes, passing_score, metadata, due_days_offset, created_by, updated_by
        ) VALUES (
          v_phase_id, task_item->>'title', NULL, task_item->>'instructions',
          task_item->>'task_type',
          COALESCE((task_item->>'required')::BOOLEAN, TRUE),
          task_order,
          NULLIF(task_item->>'estimated_minutes', '')::INTEGER,
          NULLIF(task_item->>'passing_score', '')::INTEGER,
          COALESCE(task_item->'metadata', '{}'::jsonb),
          NULLIF(task_item->>'due_days_offset', '')::INTEGER,
          v_admin_id, v_admin_id
        ) RETURNING id INTO v_task_id;
        task_order := task_order + 1;
      END LOOP;
      phase_order := phase_order + 1;
    END LOOP;
  END IF;

  -- Template 2: OB Platform — DC Extension Deployment
  SELECT id INTO v_template_id FROM track_templates WHERE title = 'OB Platform — DC Extension Deployment' LIMIT 1;
  IF v_template_id IS NULL THEN
    INSERT INTO track_templates (
      title, description, role_target, estimated_duration_days, tags, purpose, track_type, created_by, updated_by
    ) VALUES (
      'OB Platform — DC Extension Deployment',
      'Deploy an already-generated and CAB-approved platform release to an additional data center. Skips engineering readiness, QA, and CAB (done for primary DC). Images are built; only deployment and verification phases are needed.',
      'ops',
      3,
      '["release","open-banking","dc-extension"]'::jsonb,
      'release',
      'RELEASE',
      v_admin_id, v_admin_id
    ) RETURNING id INTO v_template_id;

    INSERT INTO track_versions (
      template_id, version_number, status, title, description, estimated_duration_days,
      tags, purpose, track_type, is_current, published_at, created_by, updated_by
    ) VALUES (
      v_template_id, 1, 'published',
      'OB Platform — DC Extension Deployment',
      'Published baseline for deploying an existing release to an additional DC.',
      3,
      '["release","open-banking","dc-extension"]'::jsonb,
      'release', 'RELEASE', TRUE, NOW(), v_admin_id, v_admin_id
    ) RETURNING id INTO v_version_id;

    phase_order := 0;
    FOR phase_item IN SELECT value FROM jsonb_array_elements(ob_dc_extension_def) LOOP
      INSERT INTO track_phases (track_version_id, title, description, order_index, created_by, updated_by)
      VALUES (v_version_id, phase_item->>'title', phase_item->>'description', phase_order, v_admin_id, v_admin_id)
      RETURNING id INTO v_phase_id;
      task_order := 0;
      FOR task_item IN SELECT value FROM jsonb_array_elements(phase_item->'tasks') LOOP
        INSERT INTO track_tasks (
          track_phase_id, title, description, instructions, task_type, required,
          order_index, estimated_minutes, passing_score, metadata, due_days_offset, created_by, updated_by
        ) VALUES (
          v_phase_id, task_item->>'title', NULL, task_item->>'instructions',
          task_item->>'task_type',
          COALESCE((task_item->>'required')::BOOLEAN, TRUE),
          task_order,
          NULLIF(task_item->>'estimated_minutes', '')::INTEGER,
          NULLIF(task_item->>'passing_score', '')::INTEGER,
          COALESCE(task_item->'metadata', '{}'::jsonb),
          NULLIF(task_item->>'due_days_offset', '')::INTEGER,
          v_admin_id, v_admin_id
        ) RETURNING id INTO v_task_id;
        task_order := task_order + 1;
      END LOOP;
      phase_order := phase_order + 1;
    END LOOP;
  END IF;

  -- Template 3: OB Platform — Security / Emergency Release
  SELECT id INTO v_template_id FROM track_templates WHERE title = 'OB Platform — Security / Emergency Release' LIMIT 1;
  IF v_template_id IS NULL THEN
    INSERT INTO track_templates (
      title, description, role_target, estimated_duration_days, tags, purpose, track_type, created_by, updated_by
    ) VALUES (
      'OB Platform — Security / Emergency Release',
      'Emergency security patch or urgent bugfix. Same 5-phase structure as Full Release but with compressed timeline (hours not days). Security scan is a mandatory hard gate. Emergency CAB approval SLA is 2 hours.',
      'release_manager',
      4,
      '["release","open-banking","security","emergency"]'::jsonb,
      'release',
      'RELEASE',
      v_admin_id, v_admin_id
    ) RETURNING id INTO v_template_id;

    INSERT INTO track_versions (
      template_id, version_number, status, title, description, estimated_duration_days,
      tags, purpose, track_type, is_current, published_at, created_by, updated_by
    ) VALUES (
      v_template_id, 1, 'published',
      'OB Platform — Security / Emergency Release',
      'Published baseline for OB Platform security/emergency releases.',
      4,
      '["release","open-banking","security","emergency"]'::jsonb,
      'release', 'RELEASE', TRUE, NOW(), v_admin_id, v_admin_id
    ) RETURNING id INTO v_version_id;

    phase_order := 0;
    FOR phase_item IN SELECT value FROM jsonb_array_elements(ob_security_def) LOOP
      INSERT INTO track_phases (track_version_id, title, description, order_index, created_by, updated_by)
      VALUES (v_version_id, phase_item->>'title', phase_item->>'description', phase_order, v_admin_id, v_admin_id)
      RETURNING id INTO v_phase_id;
      task_order := 0;
      FOR task_item IN SELECT value FROM jsonb_array_elements(phase_item->'tasks') LOOP
        INSERT INTO track_tasks (
          track_phase_id, title, description, instructions, task_type, required,
          order_index, estimated_minutes, passing_score, metadata, due_days_offset, created_by, updated_by
        ) VALUES (
          v_phase_id, task_item->>'title', NULL, task_item->>'instructions',
          task_item->>'task_type',
          COALESCE((task_item->>'required')::BOOLEAN, TRUE),
          task_order,
          NULLIF(task_item->>'estimated_minutes', '')::INTEGER,
          NULLIF(task_item->>'passing_score', '')::INTEGER,
          COALESCE(task_item->'metadata', '{}'::jsonb),
          NULLIF(task_item->>'due_days_offset', '')::INTEGER,
          v_admin_id, v_admin_id
        ) RETURNING id INTO v_task_id;
        task_order := task_order + 1;
      END LOOP;
      phase_order := phase_order + 1;
    END LOOP;
  END IF;

END
$seed$;
