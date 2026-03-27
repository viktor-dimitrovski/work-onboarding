# Plan: Release Management — Open Banking Platform

Extends the existing release management module with:
- Tenant-scoped Data Centers (k8s clusters per geo/DC)
- Structured Release Notes (per service + version, typed items)
- Platform Releases (replaces Release Manifests for quarterly + ad-hoc flows)
- Multi-DC deployment tracking
- Three track template variants (Full Release, DC Extension, Security/Emergency)

---

## Design Decisions (final)

| Decision | Answer |
|---|---|
| Service identity | `(repo, branch)` tuple — services use one main branch, config repos use per-bank branches |
| Config repo model | One config repo, one branch per bank — each branch versioned independently |
| Deployment step grouping | Per-service grouping (not a single global order) |
| Deploy to Another DC | Full deployment phases EXCEPT Phase 1 (code freeze/tagging) — images already built |
| Release cadence | Not only quarterly — supports ad-hoc, security patch, urgent bug variants |
| DC scope | Tenant-scoped — each tenant configures their own DCs in settings |
| Release Notes co-authorship | Multiple developers can co-author the same Release Note |
| Release Notes approval | Optional, single named approver, tracked (who + when) |
| Version conflict resolution | Always take the latest semver — no manual override |
| Internal test bank | Production-only fictive tenant for verification after each DC deployment |
| CAB approval | Single named approver, tracked (who approved + when + notes) |

---

## Service Identity Model — Services vs Configuration

This is the most important structural distinction in the whole data model.

### Microservices (application code)

```
Repo:    my-org/open-banking-gateway
Branch:  main  (always — one branch, one version for all banks)
Tag:     2.4.1

→ Deployed identically to all banks on a DC
```

### Configuration repos (per-bank settings, credentials, mappings)

```
Repo:    my-org/ob-config
Branch:  pl_pko   → Tag: pl_pko_1.3.2   (Polish PKO bank config)
Branch:  de_ing   → Tag: ing_2.1.0      (German ING bank config)
Branch:  pl_mbank → Tag: pl_mbank_2.0.0 (Polish mBank config)

→ Each branch is an independent deployment unit
→ Two WOs can both touch my-org/ob-config but on different branches
→ They are NOT the same "service" — they are different bank configs
```

### Consequence for deduplication

The dedup key throughout the whole system is `(repo, branch)` — not just `repo`.

| Scenario | Dedup key | Result |
|---|---|---|
| Two WOs update `ob-gateway` main at v2.3.1 and v2.4.0 | `(ob-gateway, main)` | Pick `2.4.0` |
| WO-1 updates `ob-config` branch `pl_pko` and WO-2 updates `ob-config` branch `de_ing` | `(ob-config, pl_pko)` and `(ob-config, de_ing)` | Two separate entries — both included |
| Two WOs update `ob-config` branch `pl_pko` at v1.2.0 and v1.3.2 | `(ob-config, pl_pko)` | Pick `pl_pko_1.3.2` |

**Branch is `null` / `main` for all service repos. Branch is the bank name for all config repos.**

---

## Tag Format Rules

| Component type | Branch | Tag format | Example |
|---|---|---|---|
| Microservice / library | `main` (or `null`) | `x.x.x` semver | `2.4.1` |
| Bank-specific config | `bankId` | `bankId_x.x.x` | `ing_2.1.0` |
| Country-bank config | `country_bank` | `country_bank_x.x.x` | `pl_pko_1.3.2` |

Tag format is free-text — the system does not enforce the format, only uses it for display and snapshot evidence.
The branch name in the config repo always matches the bank identifier prefix in the tag (e.g. branch `pl_pko` → tags are `pl_pko_*`).

---

## Release Types

The system supports four release types. All use the same `platform_releases` entity.
The release type drives: naming convention, which track template is applied, urgency display.

| Type | `release_type` | Naming convention | Cadence |
|---|---|---|---|
| Quarterly | `quarterly` | `Q2-2026` | Planned, 4x per year |
| Ad-hoc | `ad_hoc` | `ADH-2026-03` | Unplanned feature/need |
| Security patch | `security` | `SEC-2026-03-25` | Urgent security issue |
| Urgent bug fix | `bugfix` | `BUG-2026-03-25` | Can't wait for quarterly |

The difference between types at the template level is **phase duration** and **mandatory tasks** — security patches compress the timeline and make the security scan mandatory with a gate. The phase structure is otherwise the same for all types except "DC Extension" deployments.

---

## Data Model

### New Tables (all in `release_mgmt` schema)

#### `data_centers`

```
id              UUID PK
tenant_id       UUID FK → tenants
name            TEXT        -- "EU Primary", "EU DR", "US East"
slug            TEXT        -- "eu-primary", "eu-dr"  (unique per tenant)
location        TEXT        -- "Frankfurt", "Amsterdam", "Virginia"
cluster_url     TEXT        -- https://k8s-eu1.internal
k8s_context     TEXT        -- eks-eu-prod
environment     TEXT        -- production | staging | dr
is_primary      BOOLEAN     -- true for the main production DC
is_dr           BOOLEAN     -- true for disaster recovery DCs
is_active       BOOLEAN DEFAULT true
created_by, updated_by, created_at, updated_at
```

#### `release_notes`  (header — per service/config + tag)

```
id              UUID PK
tenant_id       UUID FK → tenants
repo            TEXT        -- "my-org/open-banking-gateway" or "my-org/ob-config"
branch          TEXT        -- NULL / "main" for services; bank name for config ("pl_pko", "de_ing")
service_name    TEXT        -- display name e.g. "Open Banking Gateway" or "Config: PL PKO"
component_type  TEXT        -- service | config   (derived from branch, stored for fast filtering)
tag             TEXT        -- "2.4.1" for services; "pl_pko_1.3.2" for configs
status          TEXT        -- draft | published | approved
approved_by     UUID FK → users (nullable)
approved_at     TIMESTAMPTZ (nullable)
created_by, updated_by, created_at, updated_at

UNIQUE (tenant_id, repo, branch, tag)  -- one RN per exact version of a component
```

The `(repo, branch)` pair is the **component identity**. Multiple tags (versions) of the same
component each get their own `release_notes` row.

#### `release_note_authors`  (co-author junction)

```
release_note_id UUID FK → release_notes
user_id         UUID FK → users
added_at        TIMESTAMPTZ
PRIMARY KEY (release_note_id, user_id)
```

#### `release_note_items`  (the structured rows — one per change)

```
id              UUID PK
release_note_id UUID FK → release_notes
item_type       TEXT        -- feature | bug_fix | security | api_change |
                              breaking_change | config_change
title           TEXT        -- short description (single line)
description     TEXT        -- long description (markdown)
migration_step  TEXT        -- deployment/migration instruction (markdown, nullable)
                              → feeds into aggregated deployment steps
order_index     INTEGER     -- ordering within this release note
created_by, updated_at
```

#### `platform_releases`  (the quarterly / ad-hoc release plan)

```
id              UUID PK
tenant_id       UUID FK → tenants
name            TEXT        -- "Q2-2026", "SEC-2026-03-25"
release_type    TEXT        -- quarterly | ad_hoc | security | bugfix
status          TEXT        -- draft | preparation | cab_approved |
                              deploying | deployed | closed
environment     TEXT        -- production | staging

-- CAB approval
cab_approver_id UUID FK → users (nullable)
cab_approved_at TIMESTAMPTZ
cab_notes       TEXT

-- Immutable snapshot created by "Generate Release Plan" action
generated_at    TIMESTAMPTZ
generated_by    UUID FK → users
-- Each is a JSONB array, populated at generation time:
services_snapshot      JSONB
-- [{
--    repo, branch, service_name, component_type,  -- branch=null for services
--    tag, change_type, wo_ids[]
-- }]
-- One entry per (repo, branch) dedup key.
-- Services: one entry (branch null). Config repos: one entry per bank branch.

changelog_snapshot     JSONB
-- [{
--    item_type, title, description,
--    repo, branch, service_name, tag,
--    wo_id, wo_number
-- }]

deploy_steps_snapshot  JSONB
-- Grouped per (repo, branch) — each group is a service/config section in the runbook:
-- [{
--    repo, branch, service_name, component_type, tag,
--    steps: [{order_index, migration_step, wo_id}]
-- }]
-- Services appear first (component_type=service), config entries follow (component_type=config)
-- Within config entries, each bank branch is its own section

created_by, updated_by, created_at, updated_at
```

#### `platform_release_work_orders`  (junction — WOs included in a release)

```
platform_release_id UUID FK → platform_releases
work_order_id       UUID FK → release_mgmt.work_orders
included_at         TIMESTAMPTZ
included_by         UUID FK → users
PRIMARY KEY (platform_release_id, work_order_id)
```

#### `wo_dc_deployments`  (created at deployment time only, never before)

```
id                   UUID PK
work_order_id        UUID FK → release_mgmt.work_orders
data_center_id       UUID FK → data_centers
platform_release_id  UUID FK → platform_releases
environment          TEXT
status               TEXT   -- pending | deploying | deployed | failed | rolled_back
deployed_at          TIMESTAMPTZ
deployed_by          UUID FK → users
notes                TEXT
```

### Existing tables — changes needed

**`release_mgmt.work_order_services`** — needs `branch` field added (Milestone 3 migration):
```
branch   TEXT   -- NULL for service repos; bank branch name for config repos ("pl_pko", "de_ing")
```
This is required so the generation engine can correctly identify `(repo, branch)` per service entry.
`release_notes_ref` TEXT stays as a freeform pointer for now; a future step can add `release_note_id` FK once Release Notes module is live.

**`release_mgmt.work_orders`** — `target_envs` JSONB stays as-is (intended scope of WO, not actual DC deployment).

---

## Track Templates — Three Variants

### Template 1: "OB Platform — Full Release"
Used for: `quarterly`, `ad_hoc`, `bugfix`, `security` types (adjust `due_days_offset` for urgency)

**Phase 1 — Code Freeze & Engineering Readiness** `gate: true`
- All WO PRs reviewed and approved across all repos
- Merge to release branch per WO repo
- Semantic version tag applied per changed component/service
- OpenAPI contract diff check (for any Open Banking API surface changes)
- `[gate]` Engineering lead sign-off

**Phase 2 — QA & Testing** `gate: true`
- Pre-prod smoke tests (all services deployed to pre-prod)
- Open Banking compliance run (PSD2 / FAPI validation)
- Multi-tenant isolation regression check (no cross-tenant data leakage)
- Security & dependency scan — `required: true, gate: true` for `security` type
- Postman collection run (aggregated from WO `postman_testing_ref` fields)
- `[gate]` UAT sign-off — `task_type: mentor_approval`

**Phase 3 — Release Preparation** `gate: true`
- Release Notes finalized and published for all changed services
- **Generate Release Plan** — manually triggered, auto-aggregates: services (latest semver), changelog (by type), deployment steps (per service)
- Rollback plan prepared per target DC
- Tenant communications drafted (features, deprecations, API changes)
- Deployment window confirmed with ops team
- `[gate]` CAB approval — `task_type: mentor_approval`

**Phase 4 — Deployment & Verification on Target DC** `gate: true`
- Pre-deploy: DB backup verified, freeze check
- Execute deployment per deploy_list (runbook link, service order)
- DB migrations executed and verified
- Post-deploy smoke tests on DC
- Open Banking API health check on deployed DC
- Internal fictive bank verification — full happy-path flows `task_type: external_link`
- 30-min monitoring window: error rate, p95 latency, upstream bank connections
- `[gate]` Ops sign-off — DC marked as deployed

**Phase 5 — Post-Release Closure**
- 48h monitoring watch (error rate, bank API upstream health)
- All included WOs marked as `deployed` on target DC (system action)
- Tenant-facing changelog published
- Retrospective notes captured
- Release archived / closed

### Template 2: "OB Platform — DC Extension Deployment"
Used for: deploying an already-generated and approved release plan to an additional DC.
Images are built. Versions frozen. CAB already approved. Starts at deployment.

**Phase 1 — Pre-Deployment Verification** `gate: true`
- Confirm release plan versions match available images on new DC
- DB backup verified on new DC
- Freeze check — no conflicting deployments in progress
- `[gate]` Ops sign-off to proceed

**Phase 2 — Deployment on Additional DC** `gate: true`
- Execute deployment per deploy_list (same order as primary DC)
- DB migrations executed and verified
- Post-deploy smoke tests on new DC
- Open Banking API health check on new DC
- Internal fictive bank verification on new DC
- 30-min monitoring window on new DC
- `[gate]` Ops sign-off — DC marked as deployed

**Phase 3 — Closure**
- All included WOs marked as `deployed` on this DC
- Cross-DC consistency check (if shared data tier)
- Deployment record finalized

### Template 3: "OB Platform — Security / Emergency Release"
Same 5 phases as Template 1 but with:
- Compressed `due_days_offset` values (days instead of weeks)
- Security scan task is `required: true, gate: true`
- CAB approval is expedited (note in instructions: "Emergency CAB — 2h SLA")
- Phase 1 reduced to: code review + hotfix branch + tag only (no full OpenAPI diff)
- Phase 2 reduced to: targeted regression + security scan + UAT bypass allowed (documented)

---

## Client-Facing Pages

### Settings → Data Centers (new tab in existing settings page)

**What it looks like:**
- A table: Name | Location | Environment badge (PROD / DR / STAGING) | Primary / DR chips | Cluster URL | Active toggle
- "Add Data Center" button → slide-over sheet with form fields
- Edit / Delete inline actions
- Validation: at least one DC must be marked as Primary before releases can be created

### Release Notes — new section under Releases module

**List page `/release-notes`**

Columns: Component | Type chip (Service / Config) | Branch (for config) | Tag | Status badge | Authors (avatar stack) | Items count | Last updated | Actions

- Service rows show: `Open Banking Gateway` — `main` — `2.4.1`
- Config rows show: `ob-config` — `pl_pko` — `pl_pko_1.3.2` with a bank chip

Filters: Repo (search/select), Component type (Service / Config), Bank branch (for config repos), Status, Item type

**Detail / Editor page `/release-notes/[id]`**

Top area:
- Component name + repo link
- If config: **Bank branch badge** prominently shown (e.g. `pl_pko`) so it's always clear which bank this RN covers
- Tag badge
- Status pill (Draft → Published → Approved)
- Author avatars + "Add Co-author" button (user picker)
- "Request Approval" button (if published) → select named approver → saves `approved_by`
- "Publish" button (if draft and has at least one item)

Items section:
- A structured table / card list grouped by `item_type` with colored section headers
- Each item row: **Type badge** | **Title** | **Description** (truncated, expand on click) | **Migration Step** indicator (paperclip icon if present) | drag handle | edit / delete
- "Add Item" button → opens a side sheet:
  - Type dropdown (Feature / Bug Fix / Security / API Change / Breaking Change / Config Change)
  - Title — single-line text
  - Description — markdown textarea
  - Migration Step — markdown textarea (label: "Deployment / migration instruction")
- Items are drag-reorderable within the note (affects deployment step order in aggregated releases)

Item type badge colors:
| Type | Color |
|---|---|
| Feature | Blue |
| Bug Fix | Amber |
| Security | Red |
| API Change | Purple |
| Breaking Change | Rose |
| Config Change | Slate |

### Work Orders `/work-orders` (enhanced existing page)

New columns added:
- **Deployment Status** — chips per DC where this WO has been deployed: `EU-Primary ✓` `EU-DR ⏳` `EU-DR ✗`
- **Release Plan** — link badge to the platform release this WO is included in

New filters:
- **Data Center** — select (from tenant's configured DCs)
- **Deployed / Not Deployed** — toggle to show only WOs not yet deployed to a specific DC

### Platform Releases `/platform-releases` (new — replaces Release Manifests for this flow)

**List page**

Columns: Name | Type chip (Quarterly / Ad-hoc / Security / Bug Fix) | Environment | Status | Target DC | # WOs | # Services | CAB Approved by | Generated | Actions

**Creation wizard `/platform-releases/new`**

Three-step wizard:

**Step 1 — Basic Info**
- Release name (auto-suggested based on type: Q2-2026, SEC-2026-03-25, etc. — editable)
- Release type select (Quarterly / Ad-hoc / Security / Bug Fix)
- Target Data Center select (from tenant's configured DCs)
- Environment select
- CAB Approver select (user picker, required before CAB step can complete)

**Step 2 — Select Work Orders**
- Multi-select grid: WO Number | Title | # Services | Risk Level | Postman Ref | Status
- Default filter: "Not yet deployed to selected DC" (toggle shows all)
- Selected count shown in aside with "# services will be included (estimate)"

**Step 3 — Review & Save**
- Summary: selected WO count, DC, type, approver
- Save as Draft (generation happens from detail page, not during creation)

**Detail page `/platform-releases/[id]`**

**Header area:** Release name, type chip, environment, DC name, status badge, timeline bar

**Status workflow:**
```
Draft → Preparation → CAB Approved → Deploying → Deployed → Closed
```

**Action buttons (context-sensitive):**
- `Draft`: "Generate Release Plan" — triggers aggregation (see below)
- `Preparation`: "Request CAB Approval"
- `CAB Approved`: "Assign to DevOps" (creates track assignment), "Deploy to Another DC"
- `Deploying / Deployed`: "Record Deployment" per DC, "View Deployment History"

**"Generate Release Plan" action:**
1. System iterates all included WOs → all `work_order_services` rows (each row has `repo` + `branch`)
2. Groups by `(repo, branch)` — deduplication: keeps the highest semver tag per group
   - Service repos: grouped by `(repo, null)` → one entry per service, same version for all banks
   - Config repos: grouped by `(repo, bank_branch)` → one entry per bank — `pl_pko` and `de_ing` are separate even if from the same config repo
3. For each `(repo, branch, tag)` → looks up matching `release_notes` + `release_note_items`
4. Produces three snapshots saved to `platform_releases`:
   - `services_snapshot`: services first (sorted by name), then config entries grouped by repo then by bank branch
   - `changelog_snapshot`: all items across all components, tagged with `component_type` for filtering
   - `deploy_steps_snapshot`: services section first, config sections after (one section per bank branch per config repo)
5. Status transitions to `Preparation`
6. Snapshots are immutable — "Regenerate" button available if WO selection changes (only in Draft/Preparation status)

**Tabs:**

**Overview tab**
- CAB approval card: approver name, status, notes, approve date
- Timeline of status transitions
- "Assign to DevOps" → select assignee → system creates a TRACK assignment from the matching template (Full Release / DC Extension) with pre-filled: DC, environment, manifest link, release name

**Work Orders tab**
- List of included WOs: WO number, title, # services, risk, deployment status on this DC
- "Add / Remove WOs" button (only in Draft status — triggers re-generation warning)

**Services & Versions tab**
- Two sections: **Application Services** and **Bank Configurations** (each collapsible)
- Application Services table: Service Name | Repo link | Tag | Change Type | Source WOs
- Bank Configurations table: Config Repo | Bank (branch) | Tag | Change Type | Source WOs
  - Rows grouped by config repo, with bank branch as a sub-identifier
  - Makes it immediately clear: "we are deploying 3 bank configs from ob-config: pl_pko v1.3.2, de_ing v2.1.0, pl_mbank v2.0.0"
- Generated from `services_snapshot`
- Shows which WOs contributed to each component version

**Changelog tab**
- Grouped by item type with counts in section headers
- Each group is a collapsible list: Title | Description | Service | WO number
- Color-coded by type (same badge scheme as Release Notes editor)
- "Export Changelog" button → downloads markdown document

**Deployment Steps tab**
- Two top-level sections: **Application Services** then **Bank Configurations**
- Each section is divided per component (service or bank branch):
  - Service section header: `[Service Name] — v2.4.1` (repo link)
  - Config section header: `[Config Repo] / [bank branch] — pl_pko_1.3.2`
- Within each component: numbered migration steps rendered as markdown
- Step cards show: instruction (markdown rendered), source WO link
- Why this order matters: services must be deployed before their bank configs in almost all cases — this natural grouping respects that dependency
- "Export Deployment Steps" button → downloads runbook markdown with same structure

**Deployment History tab**
- Table: DC Name | Environment | Status | Deployed By | Deployed At | Notes
- "Record Deployment" button → slide-over: select DC (defaults to target DC), deployed by, date/time, notes → creates `wo_dc_deployments` records for all included WOs on that DC
- "Deploy to Another DC" button → opens wizard:
  - Select destination DC
  - Creates a new TRACK assignment from "OB Platform — DC Extension Deployment" template
  - Pre-filled with: all services + versions from snapshot, deploy steps, DC info
  - Note: no new version resolution, no CAB needed — snapshots are reused as-is

---

## Milestones & Build Order

| # | Milestone | Key deliverables | Effort | DB Migration |
|---|---|---|---|---|
| **0** | OB Release track templates SQL | `041_seed_ob_platform_release_templates.sql` — 3 templates (Full / DC Extension / Security) seeded | 2–3h | No |
| **1** | Data Centers | Model, API CRUD, Settings → Data Centers tab | 1 day | Yes — `0047_data_centers` |
| **2** | Release Notes module | Model + items, API (CRUD + publish + approval), list page, editor page with structured items table | 3–4 days | Yes — `0048_release_notes` |
| **3** | Work Orders enhancements | Add `branch` field to `work_order_services` (required for config repo identity); DC deployment status chips, release plan link column, DC + deployed/not-deployed filters | 1–2 days | Yes — `0049_wo_dc_deployments_and_branch` |
| **4** | Platform Releases — creation + generation | Model, creation wizard, generation engine (semver resolution, changelog + deploy steps aggregation) | 3 days | Yes — `0050_platform_releases` |
| **5** | Platform Releases — detail page (all tabs) | All 5 tabs, export buttons, status workflow | 2 days | No |
| **6** | Track auto-create + DC Extension flow | "Assign to DevOps" creates TRACK, "Deploy to Another DC" wizard, `wo_dc_deployments` recording | 2 days | No |

**Total estimated effort: ~13–15 days of development**

---

## How to use this file

Tell the AI: **"Build Milestone 0"**, **"Build Milestone 1"**, etc.
Each milestone is self-contained and can be built independently.
Milestones 1–4 require running `python -m alembic upgrade head` after the migration file is generated.

Milestone 0 (SQL seed) can be executed at any time — it only adds new track templates.
