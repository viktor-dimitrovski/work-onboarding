# PLAN: Deployment Checklist, Functionality Search & Release Planning

> **Status:** Approved for implementation — decisions finalized  
> **Scope:** Release Management module — five features + one WO enhancement + architecture notes  
> **Author:** AI Architect (verified against Senior Release Planning Engineering best practices)

---

## Background & Guiding Principle

Work Orders (WOs) are **development-phase artifacts** — source of truth for what changed and why during development. They are **not deployment artifacts**.

Standard enterprise release practice:

> **Plan phase** → Select WOs → Generate aggregated Release Manifest (`PlatformRelease`) → The manifest becomes the single deployment artifact. DevOps **never** works from WOs — they work from the manifest.

The `PlatformRelease` already contains `deploy_steps_snapshot` (flat, aggregated, service-grouped deployment instructions). This is exactly what the deployer should see during deployment execution.

---

## Feature 0 — WO ↔ Release Notes Linking (UX Enhancement)

### Goal

When creating or editing a Work Order, the developer must be able to easily link existing Release Notes documents (written within this application) to services listed in the WO. The UX must be frictionless and noise-free — showing only Release Notes that are actually useful to link.

### Filtering Rules for the Picker (what is shown)

Only Release Notes that meet **all** of the following are shown:

| Rule | Reason |
|---|---|
| Status is `draft` or `published` (not `approved`) | Approved = already finalized, shouldn't be re-linked |
| Not already linked to a service in **another** WO | Prevents duplication / shared ownership confusion |
| Not part of a `PlatformRelease` that is `deployed` or `closed` | Already shipped — cannot re-use for new WO |
| Matches the service's repo (when a repo is already selected) | Contextual narrowing — only relevant docs |

### UX Design — Inline Picker in WO Service Row

Each service entry in the WO form has a **"Link Release Notes"** slot:

```
┌─ Service row ────────────────────────────────────────────────────────────┐
│  Repo: [org/payment-service ▾]    Branch: [main]    Tag: [2.4.1]        │
│                                                                           │
│  Release Notes:  [ 🔗 Link existing ]  or  [ + Create new ]              │
│                                                                           │
│  ↳ Linked: ● payment-service @ 2.4.1  [draft]  ✕                        │
└───────────────────────────────────────────────────────────────────────────┘
```

**"Link existing" click behaviour:**

1. Opens an inline dropdown/popover (not a modal — stays in context)
2. Shows filtered Release Notes as chips with key info:
   ```
   ● payment-service @ 2.4.1   [draft]   3 items   Updated 2h ago
   ● payment-service @ 2.3.9   [published]   7 items   Updated 3d ago
   ```
3. Single click to link — immediately reflected in the row
4. If no eligible Release Notes exist → shows: *"No unlinked release notes for this repo. Create one?"* with a button that opens the New Release Note sheet pre-filled with the repo + tag.

**"Create new" click behaviour:**

- Opens the New Release Note sheet pre-filled with `repo`, `branch`, `tag` from the service row
- On save → automatically links back to this WO service entry

### Backend

```
GET /release-notes?linkable_for_wo={wo_id}&repo={repo}
```

Returns only eligible Release Notes per the filtering rules above. New query parameter added to the existing list endpoint — no new endpoint needed.

---

## Feature 1 — Functionality Search

### Goal

Allow anyone to search for a feature or bug fix by partial text across all Release Note items and immediately see a matrix of deployment status across all configured Data Centers.

### New Page

`/release-notes/search`

### Backend

```
GET /release-notes/items/search?q=text&status=&component_type=&dc_id=&include_draft=true
```

- Full-text search across `release_note_items.title + description`
- Joins through:
  `release_notes → work_order_services → work_orders → platform_release_work_orders → platform_releases → wo_dc_deployments`
- Returns per-item deployment status per DC
- `include_draft=true` by default — draft items are included but flagged

### UI — Results Grid

| ⚠️ | Feature | Type | Service @ Tag | DC: EU-W1 | DC: EU-DR | DC: US-E1 |
|---|---|---|---|---|---|---|
| — | PSD2 consent flow | Feature | payment-svc @ 2.4.1 | ✅ 14 Mar | ✅ 16 Mar | ⏳ — |
| — | Token refresh fix | Bug Fix | auth-svc @ 1.9.3 | ✅ 14 Mar | ⚠️ Blocked | ⏳ — |
| 📝 | Open Banking scope | Feature | core-svc @ 3.1.0 | ⏳ — | ⏳ — | ⏳ — |

**Draft indicator column (⚠️ / 📝):**
- First column: narrow, icon only
- Empty = published or approved Release Note (reliable content)
- 📝 = item comes from a `draft` Release Note
- Hovering the icon shows tooltip: *"From draft Release Note — content may be incomplete"*
- Draft rows are slightly de-emphasized (lighter text) but not hidden

**Other grid behaviours:**
- DC columns are **dynamic** — generated from tenant's configured Data Centers
- Click any DC cell → tooltip: Platform Release name + deployer + timestamp
- Filter bar: DC selector, component type (service / config), deployment status (all / deployed / not deployed / blocked), draft toggle (show/hide drafts)
- Search is debounced, runs on every keystroke after 2+ characters

---

## Feature 2 — Deployment Checklist

### Goal

Replace the single "Record Deployment" button on Platform Release detail with a fully interactive deployment checklist. DevOps engineer sees a flat, ordered, service-grouped action list — zero WO references. They mark progress item by item (or all at once), flag problems with notes, and the system maintains a complete audit trail per DC per deployment run.

### Design Principles

- DevOps sees **deployment steps only** — no WO numbers, no project management context
- Checklist is **materialized from `deploy_steps_snapshot` at run creation** — immutable, independent of any future regeneration
- Supports both **mark all at once** (happy path) and **item-by-item** tracking (real deployment)
- Blocked/postponed items require a **mandatory note**
- Run completion auto-creates `WODCDeployment` records for audit trail

### Decisions (finalized)

| # | Decision | Answer |
|---|---|---|
| 1 | Multiple concurrent runs | **One active run per release + DC + ENV** — enforced at API level. Starting a new run while one is active returns HTTP 409. |
| 2 | Re-opening partial/completed runs | **Allowed** — a `completed` or `partial` run can be re-opened to address blocked items. Re-opening sets status back to `in_progress`. A re-open reason note is required. |
| 3 | Blocked item notifications | **Yes** — blocked items trigger an email notification. Recipient list is configurable per tenant in Settings (see Feature 3). |
| 4 | Search scope | **Draft included** — draft Release Note items appear in search but are visually distinguished (📝 icon + de-emphasized row + tooltip). |

---

## New Database Schema

### Table: `release_mgmt.deployment_runs`

One run = one deployment session (Platform Release + DC + ENV).

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID | RLS |
| `platform_release_id` | UUID FK | → `platform_releases.id` CASCADE |
| `data_center_id` | UUID FK | → `data_centers.id` |
| `environment` | TEXT | production / staging / dr |
| `status` | TEXT | `pending` \| `in_progress` \| `completed` \| `partial` \| `aborted` |
| `started_by` | UUID | user who started the run |
| `started_at` | TIMESTAMPTZ | |
| `completed_at` | TIMESTAMPTZ | nullable |
| `reopened_at` | TIMESTAMPTZ | nullable — set when run is re-opened |
| `reopened_by` | UUID | nullable |
| `reopen_reason` | TEXT | nullable — required when re-opened |
| `notes` | TEXT | post-deployment notes |
| `created_at` | TIMESTAMPTZ | |

**Unique constraint:** `(platform_release_id, data_center_id, environment)` WHERE `status IN ('pending', 'in_progress')` — enforces one active run per release+DC+ENV.

### Table: `release_mgmt.deployment_run_items`

One row per step in the checklist. Copied from snapshot at run creation — never mutated from the snapshot side.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `deployment_run_id` | UUID FK | → `deployment_runs.id` CASCADE |
| `group_key` | TEXT | e.g. `"payment-svc@2.4.1"` |
| `group_label` | TEXT | Display name for the service/config group |
| `step_index` | INTEGER | Order within the group |
| `item_title` | TEXT | Copied from snapshot |
| `migration_step` | TEXT | Copied from snapshot (the command/instruction) |
| `status` | TEXT | `pending` \| `in_progress` \| `done` \| `blocked` \| `postponed` \| `skipped` |
| `notes` | TEXT | Required when `blocked` or `postponed` |
| `marked_by` | UUID | user who last updated status |
| `marked_at` | TIMESTAMPTZ | |

---

## Feature 3 — Notification Settings for Blocked Deployments

### Goal

Tenant-configurable list of email recipients who receive notifications when a deployment run item is marked as **blocked**.

### Settings UI

Added as a new section in **Settings → Notifications** (or a sub-section under Release Management settings):

```
┌─ Deployment Blocked Item Notifications ──────────────────────────────────┐
│                                                                           │
│  Send email when a deployment step is blocked to:                        │
│                                                                           │
│  [John Doe <john@company.com>]  [Jane Smith <jane@company.com>]  [+ Add] │
│                                                                           │
│  ☑ Also notify the Platform Release owner (created_by)                   │
│  ☑ Also notify the user who started the deployment run                   │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

### Email Notification Content

```
Subject: [BLOCKED] Deployment step blocked — {release_name} on {dc_name}

Release:    Q1-2026
Data Center: EU-WEST-1 (production)
Service:    auth-service @ 1.9.3
Step:       Run token migration

Blocked by: John Doe  at  14 Mar 2026 09:47
Reason:     Migration fails on users_v2 — DB schema mismatch.

→ View deployment run: https://app/platform-releases/{id}#deployment-runs
```

### Backend / Schema

New JSONB field added to tenant `settings_json`:

```json
{
  "release_notifications": {
    "blocked_step_emails": ["john@company.com", "jane@company.com"],
    "notify_release_owner": true,
    "notify_run_starter": true
  }
}
```

No separate DB table needed — stored in existing tenant settings JSONB.

---

## Backend API

### Deployment Runs

| Method | Path | Action |
|---|---|---|
| `POST` | `/platform-releases/{id}/deployment-runs` | Start new run — enforces one active run per release+DC+ENV |
| `GET` | `/platform-releases/{id}/deployment-runs` | List all runs for this release |
| `GET` | `/deployment-runs/{run_id}` | Full run with all items |
| `PATCH` | `/deployment-runs/{run_id}/items/{item_id}` | Update single item status + notes; triggers notification if `blocked` |
| `POST` | `/deployment-runs/{run_id}/items/mark-all-done` | Bulk mark all pending → done |
| `POST` | `/deployment-runs/{run_id}/complete` | Finalize run → creates `WODCDeployment` records |
| `POST` | `/deployment-runs/{run_id}/reopen` | Re-open completed/partial run with mandatory reason |
| `POST` | `/deployment-runs/{run_id}/abort` | Abort run with mandatory reason |

### Functionality Search

| Method | Path | Action |
|---|---|---|
| `GET` | `/release-notes/items/search` | Full-text search with DC deployment matrix, draft flag per item |

### WO Release Notes Linking

| Method | Path | Action |
|---|---|---|
| `GET` | `/release-notes?linkable_for_wo={wo_id}&repo={repo}` | Filtered list for WO inline picker |

---

## Frontend UI

### WO Editor — Release Notes Inline Picker

See Feature 0 above. Added to each service row in the WO create/edit form:
- Inline popover (not modal) showing filtered, linkable Release Notes
- Pre-filtered by repo when repo is already selected
- "Create new" shortcut pre-fills the New Release Note sheet

### Deployment Checklist Tab

Replaces the single "Record Deployment" button on the Platform Release detail page. A new 7th tab: **Deployment Runs**.

#### Active Run — Header Bar

```
[EU-WEST-1 · production]  Started by: John D.  14 Mar 2026 09:15
Progress: ████████████░░░  12 / 15 steps  ·  1 Blocked  ·  2 Pending

[Mark All Done]   [Complete Deployment ✓]   [Abort ✕]
```

- `Complete Deployment` enabled only when 0 pending/in_progress items remain
- `Mark All Done` marks all `pending` → `done` with one confirmation dialog
- `Abort` requires a reason note

#### Re-opened Run Banner

```
┌─ ⚠️ This run was re-opened on 15 Mar 2026 by John D. ──────────────────┐
│  Reason: Token migration failed — schema fix applied, retrying.          │
└───────────────────────────────────────────────────────────────────────────┘
```

#### Checklist Body — Grouped by Service/Config

```
┌─ payment-service @ 2.4.1  ─────────────────── [3/3 ✅] ──────────────┐
│  ✅  Run DB migration         kubectl apply -f...   John D. 09:18      │
│  ✅  Deploy service image     helm upgrade...       John D. 09:22      │
│  ✅  Smoke test endpoint      curl https://...      John D. 09:25      │
└───────────────────────────────────────────────────────────────────────┘

┌─ auth-service @ 1.9.3  ───────────────────── [1/2 ⚠️] ──────────────┐
│  ✅  Deploy service image     helm upgrade...       John D. 09:30      │
│  🔴  Run token migration      ─── BLOCKED ─────────────────────────  │
│      Note: Migration fails on users_v2 — DB schema mismatch.          │
│      [Edit note]  [Mark Done]  [Postpone]                              │
└───────────────────────────────────────────────────────────────────────┘

┌─ config: acme-bank @ acme-bank_1.2.0  ──────── [0/1 ⏳] ────────────┐
│  ⏳  Apply bank config patch   kubectl apply...                        │
│      [✅ Done]  [▶️ In Progress]  [🔴 Block]  [⏸️ Postpone]            │
└───────────────────────────────────────────────────────────────────────┘
```

#### Item Status Colors

| Color | Status | Meaning |
|---|---|---|
| 🟢 Green | `done` | Executed successfully |
| 🔵 Blue | `in_progress` | Currently executing |
| 🔴 Red | `blocked` | Failed / requires action — note mandatory — triggers notification |
| 🟡 Amber | `postponed` | Deferred to next deployment window — note mandatory |
| ⬜ White/Gray | `pending` | Not yet started |

#### Per-Item Actions (shown on hover)

- `✅ Done` → marks item + timestamps immediately
- `▶️ In Progress` → marks blue (for long-running steps)
- `🔴 Blocked` → opens inline note input (mandatory), marks red, **triggers email notification**
- `⏸️ Postpone` → opens inline note input (mandatory), marks amber
- `↩️ Reset` → revert to pending (if mistakenly marked)

#### Run Completion

When `Complete Deployment` is clicked:
- If any items are `blocked` → confirmation dialog: *"X items are blocked. Complete anyway?"*
- Automatically creates `WODCDeployment` records for all WOs in the release
  - Status = `deployed` if all done
  - Status = `partial` if any blocked/postponed
- Run status → `completed` or `partial`

#### Past Runs List (below active run)

Collapsed list of previous runs for this release, each showing:
- DC + ENV + status badge + started by + date + step summary (X/Y done, Z blocked)
- Click to expand → read-only view of the run items and their final states
- `Re-open` button visible on `completed` and `partial` runs

---

## Integration with Existing Features

After a deployment run completes, the following update automatically:

| Surface | What updates |
|---|---|
| **Release Notes editor** | DC deployment status badges in header |
| **Functionality Search** | Exact DC deployment status per feature item |
| **Platform Release → History tab** | Shows deployment runs with progress summary |
| **Work Orders page** | DC deployment chips per WO row |
| **Settings → Notifications** | Configures who receives blocked-step emails |

---

## Implementation Artifacts

| Artifact | Type |
|---|---|
| Alembic migration — `deployment_runs` + `deployment_run_items` tables | Backend DB |
| SQLAlchemy models for both new tables | Backend |
| Pydantic schemas for runs and items | Backend |
| `deployment_run_service.py` — run lifecycle + item updates + notification trigger | Backend |
| Email notification service integration for blocked items | Backend |
| Tenant settings schema extension — `release_notifications` JSONB block | Backend |
| 9 new API endpoints registered in router | Backend |
| Deployment Checklist tab (7th tab) on Platform Release detail page | Frontend |
| Re-open run flow with reason dialog | Frontend |
| Past runs list with expandable read-only view | Frontend |
| Settings section — blocked deployment notification recipients | Frontend |
| WO editor — inline Release Notes picker per service row | Frontend |
| `/release-notes/search` page with dynamic DC matrix + draft indicator column | Frontend |
| Search API endpoint with full-text join + draft flag | Backend |
| `GET /release-notes?linkable_for_wo=` filter on existing endpoint | Backend |

---

## Feature 4 — Release Calendar (Release Planning)

### Goal

Give the team a lightweight forward-looking planner where upcoming releases can be registered **before** they are ready to be executed. This allows the organisation to communicate release windows to stakeholders, coordinate across teams, and lock in dates early — with the ability to edit, reorder, and insert ad-hoc emergency releases at any time.

### Do we need a new page?

**Yes — a dedicated page is needed**, but it reuses the existing `PlatformRelease` data model with a new `planned` lifecycle stage. Rationale:

| Option | Assessment |
|---|---|
| Reuse the existing `/platform-releases` list page | Too execution-focused; mixing planned placeholders with active releases creates noise |
| A separate `/release-calendar` page | ✅ Correct — different layout (timeline/list hybrid), different actions, different audience (product managers vs. DevOps) |
| New separate DB table for "planned releases" | ❌ Overkill — extend the existing `PlatformRelease` model with a `planned` status instead |

### New `PlatformRelease` Lifecycle Extension

Add `planned` as a pre-draft status:

```
planned → draft → in_progress → approved → deployed → closed
                                          ↑
                              ad-hoc inserted here too
```

A `planned` release is a **lightweight placeholder**. It has:
- Name / code
- Target quarter or date range (start_date, end_date)
- Release type (RELEASE / HOTFIX / EMERGENCY)
- Optional description / goals (free text)
- Target DC(s) (optional at this stage)

It does **not** yet have: Work Orders, snapshots, deployment steps, or an approver.

A planned release is **promoted to draft** when the team starts adding WOs and working on the actual content.

### New Column (migration needed)

Add to `release_mgmt.platform_releases`:

| Column | Type | Notes |
|---|---|---|
| `planned_start` | DATE | Target release window start |
| `planned_end` | DATE | Target release window end |
| `planning_notes` | TEXT | High-level goals, scope summary (editable any time) |

### New Page: `/release-calendar`

#### Layout

Three-column layout: left sidebar (year/quarter filter) + centre timeline + right detail panel.

```
┌─ Release Calendar ──────────────────────────────────── [+ Plan Release] ─┐
│                                                                            │
│  2026 ▾       Q1  Q2  Q3  Q4                                              │
│                                                                            │
│  JANUARY ──────────────────────────────────────────────────────────────── │
│    ● Q1-2026 — Open Banking Core     15–20 Jan   [planned]   EU-W1, US-E1 │
│                                                                            │
│  MARCH ─────────────────────────────────────────────────────────────────  │
│    ● Q1-2026 Hotfix — PSD2 patch     8 Mar       [in_progress] EU-W1      │
│    ★ Q1-2026 AD-HOC — Emergency fix  12 Mar      [planned]                │
│                                                                            │
│  JUNE ──────────────────────────────────────────────────────────────────  │
│    ● Q2-2026 — Platform Refresh      10–14 Jun   [planned]                │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

- **●** = standard planned release; **★** = ad-hoc/emergency (visually distinct, e.g., amber)
- Click any row → right panel slides open showing editable details
- Status badge colour-coded: `planned` (slate), `draft` (blue), `in_progress` (amber), `deployed` (green)

#### Right Detail Panel (inline, no navigation)

```
┌─ Q2-2026 — Platform Refresh ──────────────────────────── [Open Full] ─┐
│                                                                         │
│  Status:   [planned ▾]       Type:  [RELEASE ▾]                        │
│  Window:   [10 Jun 2026]  →  [14 Jun 2026]                             │
│  Target DC:  EU-W1  EU-DR  [+ Add DC]                                  │
│                                                                         │
│  Planning Notes:                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Main goal: complete tenant self-service onboarding flow.         │  │
│  │ Includes: config service v2, portal UX refresh.                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  [Promote to Draft →]      [Insert Ad-hoc Before]   [Delete]           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

- All fields are **inline editable** — no save button; autosave
- `Promote to Draft →` transitions status and navigates to the full PlatformRelease detail page
- `Insert Ad-hoc Before` — creates a new `planned` release with type `EMERGENCY` immediately before this one on the timeline

#### "+ Plan Release" Dialog

Minimal creation flow — 5 fields only:

```
Name / code:     [Q3-2026 — Open Banking v4          ]
Type:            [RELEASE ▾]
Window start:    [Sep 15, 2026]
Window end:      [Sep 19, 2026]
Planning notes:  [Optional high-level goals…        ]

[Cancel]   [Create Planned Release]
```

Newly created release appears immediately in the calendar — no page reload.

#### Editing Dates and Inserting Ad-hoc

- **Drag to reorder** within the same month is not needed — dates drive order
- **Date editing** is always available regardless of status (even `deployed` can have its dates corrected retrospectively for historical accuracy)
- **Ad-hoc between planned**: "Insert Ad-hoc Before" button available on every row. Creates a release with `release_type = EMERGENCY` and `planned_start` set to one day before the target release. User fills in the details in the panel.
- **Sorting**: Timeline always sorted by `planned_start ASC`; releases without a date appear at the bottom in a separate "Unscheduled" section

### Backend

Extend existing endpoints — no new router file needed:

| Change | Details |
|---|---|
| Add `planned` to `status` enum on `PlatformRelease` | Schema + model |
| Add `planned_start`, `planned_end`, `planning_notes` columns | Alembic migration |
| `POST /platform-releases` | Accept `status: planned` + new fields |
| `PATCH /platform-releases/{id}` | Allow editing `planned_start`, `planned_end`, `planning_notes` at any status |
| `GET /platform-releases?view=calendar&year=2026` | Returns all releases ordered by `planned_start`, including planned ones |
| `POST /platform-releases/{id}/promote` | Transition `planned → draft` |

---

## Feature 5 — Release Management User Manual Page

### Goal

A single, always-available help page that explains the entire Release Management module in plain language — understandable by any team member regardless of technical background. Similar in structure to the existing Assessments guide page.

### Page Location

`/release-management/guide`

Linked with a **"? How it works"** button or small book icon placed directly next to the page title on the **Platform Releases** main page (the first page a user lands on in this module).

### Structure

The page is divided into clearly titled sections, each self-contained. No jargon. Short sentences. Real examples.

---

#### Section 1 — What Is This Module For?

> The Release Management module helps your team plan, prepare, execute, and track the deployment of software releases across your Open Banking Platform.
>
> Think of it as your team's control centre: from the moment a developer writes code, all the way to confirming that the code is running live in your data centres.

---

#### Section 2 — The Big Picture (how it all connects)

Visual diagram (simple boxes and arrows):

```
Developer writes code
       ↓
Creates a Work Order (WO) — describes what changed and why
       ↓
Writes Release Notes for each changed service — lists deployment steps
       ↓
Release Manager picks WOs → creates a Platform Release (Release Manifest)
       ↓
System auto-generates: service list, changelog, deployment checklist
       ↓
CAB approves the release
       ↓
DevOps runs the Deployment Checklist on each Data Centre
       ↓
Release closed ✓ — everything is recorded for audit
```

---

#### Section 3 — Key Concepts (glossary in plain language)

| Term | Plain English |
|---|---|
| **Work Order (WO)** | A document that says "we changed X to solve Y." One WO per feature or bug fix. |
| **Release Notes** | A list of what changed in a specific service, with exact deployment instructions. Written by developers. |
| **Platform Release** | The combined deployment package. Picks up many WOs, merges them into one deployment plan. |
| **Data Center (DC)** | A physical server cluster in a specific location (e.g., EU West, US East). You deploy to one or more DCs. |
| **Release Calendar** | A forward-looking schedule of planned releases for the year — like a sprint plan, but for releases. |
| **Deployment Checklist** | The step-by-step to-do list for DevOps, auto-generated from Release Notes. Each step gets checked off live. |
| **CAB Approval** | A named person formally approves the release before it can be deployed. Creates an audit trail. |
| **Deployment Run** | One execution of the deployment checklist on a specific DC and environment. Can be completed, partial, or re-opened. |

---

#### Section 4 — Step-by-Step: How to Use the Module

**Step 1 — Developer: Create a Work Order**

Go to *Work Orders* → click *New Work Order*. Fill in the title, description, and the services (repos) you changed. For each service, link the Release Notes document you wrote (or create one on the spot).

**Step 2 — Developer: Write Release Notes**

Go to *Release Notes* → open your document. Add items by clicking *Add item*. Choose a type (Feature, Bug Fix, Security…), write a title, description, and — most importantly — the exact deployment step (the command DevOps needs to run). Drag to reorder. Click *Publish* when ready.

**Step 3 — Release Manager: Plan the Release**

Go to *Release Calendar* → create a planned release for the upcoming quarter. Give it a date window and a name. This is just a placeholder at this stage.

**Step 4 — Release Manager: Build the Release Manifest**

When ready, go to *Platform Releases* → open (or promote) the release. On the *Work Orders* tab, select which WOs are included. Then click *Generate Release Plan*. The system automatically:
- Merges all services (picks the latest version if the same service appears in multiple WOs)
- Builds the changelog (all features, fixes, security changes)
- Builds the deployment checklist (all deployment steps, grouped by service)

**Step 5 — CAB Approval**

Click *Request CAB Approval*, select the approver. The approver reviews and clicks *Approve*. The release is now locked for deployment.

**Step 6 — DevOps: Run the Deployment Checklist**

Go to the release → *Deployment Runs* tab → *Start Deployment Run*. Choose the Data Center and environment. Work through the checklist item by item. If something fails, click *Blocked* and add a note — the team is notified automatically. When done, click *Complete Deployment*.

**Step 7 — Repeat for Other Data Centres**

If deploying to multiple DCs, use *Deploy to Another DC* to start a new deployment run for the next cluster. The checklist is the same — the service images are already built.

**Step 8 — Close the Release**

Once all DCs are deployed and verified, the Release Manager clicks *Close Release*. Everything is recorded, timestamped, and searchable forever.

---

#### Section 5 — Tips & Common Questions

**Can I search for a specific feature to see if it's deployed?**
Yes — go to *Functionality Search* under Release Notes. Type any text and see a table showing which Data Centres have it and which don't.

**What if we need an emergency release between two planned ones?**
Go to *Release Calendar*, find the next planned release, and click *Insert Ad-hoc Before*. Fill in the details and proceed as normal.

**Can two people work on the same Release Notes document?**
Yes — use *Add Co-author* to invite another developer. Multiple people can add items. For approval, a person who did not create the document must approve it (a safeguard to avoid self-approval).

**What is the difference between a Draft and a Published Release Note?**
Draft means work is still in progress — the developer has not finished writing. Published means it is complete and ready to be included in a release. A Release Note must be published before it shows up as "fully ready" in search results (though drafts are still searchable, just marked separately).

---

### Implementation Notes

- Page is a static/server-rendered React component (no API calls needed — content is fixed documentation)
- Can include a simple inline diagram using CSS boxes or a small SVG — no external charting library required
- Linked from `PlatformReleasesPage` header via a `BookOpen` icon button: `<Link href="/release-management/guide"><BookOpen /></Link>`
- Use collapsible `<Accordion>` sections for mobile-friendly layout
- Language: always second-person ("you", "your team") — never passive voice

---

## Architecture Note — Tenant ID in New Tables

### Decision

| Table | Needs `tenant_id`? | Reason |
|---|---|---|
| `deployment_runs` | ✅ **Yes** | Top-level entity. RLS policy must be applied. Already in the schema above. |
| `deployment_run_items` | ❌ **No** | Child of `deployment_runs`. Protected via FK cascade — same pattern as `release_note_items` (which also has no `tenant_id`, relying on its FK to `release_notes`). Applying RLS here would require `tenant_id` on the table, adding redundant data and complexity with no security benefit. |

### Pattern (established in this project)

```
release_notes           ← has tenant_id, RLS applied
  └── release_note_items  ← NO tenant_id, protected via FK

deployment_runs         ← has tenant_id, RLS applied
  └── deployment_run_items ← NO tenant_id, protected via FK
```

This is consistent with how the existing `release_note_items` migration was designed (migration `0048` explicitly removed `release_note_items` from `TENANT_TABLES` for the same reason).

**For the Release Calendar extension** — no new tables are needed. The new columns (`planned_start`, `planned_end`, `planning_notes`) are added to the existing `platform_releases` table which already has `tenant_id` and RLS. No extra work required.

---

## Feature 6 — Release Center (Operations Dashboard)

### Goal

A single command-centre page where any team member — release manager, developer, DevOps engineer, or executive — can instantly see:

- Every in-flight release and exactly where it is stuck
- Who is responsible for the next action
- What is missing or blocking progress
- How to push things forward with one click

This is the **first page** a user lands on when entering the Release Management module. It replaces the current flat list as the module's home screen. The existing `/platform-releases` list page remains for full management (create, search, filter history) — the Release Center is the **operational view only**.

### Page Location

`/release-center` — already defined as a nav item in the module. This becomes the module's `defaultHref`.

### Design Philosophy (Senior Release Manager perspective)

A senior release manager does not want to open five tabs to understand the state of a release. The Release Center answers three questions immediately on load:

1. **What is blocked right now and who is holding it up?**
2. **What is the next action needed on each active release, and can I trigger it from here?**
3. **Is anything approaching its planned date without enough progress made?**

The visual metaphor is a **shipping trajectory**: each release is a horizontal track with phase checkpoints — like a package tracking screen or a flight progress bar. You see exactly where the "dot" is, whether it is on time, and what the next station is.

---

### Page Layout

```
┌─ Release Center ──────────────────────────────────────────── [+ New Release] ─┐
│                                                                                 │
│  ⚠️ 2 releases need your attention                                              │
│                                                                                 │
│  IN FLIGHT ──────────────────────────────────────────────────────────────────  │
│                                                                                 │
│  ● Q1-2026 — Open Banking Core                    [PREP] ──── ⚠️ WAITING       │
│  ● Q1-2026 Hotfix — PSD2 Token Fix                [DEPLOY] ── 🔴 BLOCKED        │
│                                                                                 │
│  PLANNED — UPCOMING ─────────────────────────────────────────────────────────  │
│                                                                                 │
│  ○ Q2-2026 — Platform Refresh           10–14 Jun 2026   planned   3 WOs       │
│  ○ Q2-2026 Hotfix                       TBD               planned              │
│                                                                                 │
│  RECENTLY CLOSED ────────────────────────────────────────────────────────────  │
│                                                                                 │
│  ✓ Q4-2025 — Auth Refresh               Closed 12 Jan 2026   3 DCs             │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

The page is split into three visual bands:
- **In Flight** — everything currently `draft`, `in_progress`, or `approved` (needs attention)
- **Planned — Upcoming** — `planned` releases on the calendar
- **Recently Closed** — last 3–5 `deployed` / `closed` releases for quick reference

---

### Release Track Card (In Flight)

Each in-flight release renders as a **full-width card** with a trajectory strip:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  ● Q1-2026 — Open Banking Core           RELEASE · EU-W1, EU-DR           [Open] │
│                                                                                    │
│  ●━━━━━━━━━●━━━━━━━━━●━━━━━━━━━○━━━━━━━━━○                                       │
│  Engineering   QA        Prep         Deploy      Closed                          │
│     ✅          ✅        🔄                                                        │
│                          ▲ CURRENT                                                │
│                                                                                    │
│  ⚠️ Waiting for CAB Approval — Assigned to: John Doe                              │
│     Planned deploy window:  15–20 Mar 2026  ·  5 days remaining                  │
│                                                                                    │
│  Quick actions:  [Approve CAB ✓]   [Reassign Approver]   [View Release →]        │
└────────────────────────────────────────────────────────────────────────────────────┘
```

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  🔴 Q1-2026 Hotfix — PSD2 Token Fix      HOTFIX · EU-W1                  [Open] │
│                                                                                    │
│  ●━━━━━━━━━●━━━━━━━━━●━━━━━━━━━●━━━━━━━━━○                                       │
│  Engineering   QA        Prep        Deploy      Closed                           │
│     ✅          ✅         ✅          🔴                                            │
│                                       ▲ CURRENT                                   │
│                                                                                    │
│  🔴 Deployment blocked — 2 steps blocked on EU-W1 / production                   │
│     Blocked by: Jane Smith   ·   Since: 2h ago                                    │
│     Last note: "Migration fails on users_v2 — schema mismatch"                   │
│                                                                                    │
│  Quick actions:  [View Checklist →]   [Notify Jane]   [View Blocked Items]       │
└────────────────────────────────────────────────────────────────────────────────────┘
```

#### Trajectory Strip Detail

Each phase checkpoint is a filled circle (●) if complete, half-filled (◑) if in progress, empty (○) if not started. The connecting line between them uses colour:

| Segment | Colour | Meaning |
|---|---|---|
| Completed segment | Solid green | Done |
| Current segment | Solid blue, animated pulse | Active now |
| Future segment | Light gray dashed | Not started |
| Blocked segment | Solid red | Requires intervention |

The number of phases shown matches the release's assigned track template (Engineering → QA → Prep → Deploy → Closure by default). Ad-hoc/security templates show fewer phases.

#### Status Banner (below trajectory)

One-line contextual banner that summarises **exactly what is needed next** and **who owns it**:

| Situation | Banner |
|---|---|
| Waiting on CAB approver | ⚠️ Waiting for CAB Approval — **John Doe** — requested 2 days ago |
| Deployment in progress | 🔵 Deployment running on EU-W1 — **Jane Smith** — 12 / 15 steps done |
| Deployment blocked | 🔴 2 steps blocked on EU-W1 — **Jane Smith** — since 2h ago |
| No WOs selected | ⚠️ No Work Orders selected — cannot generate Release Plan |
| Plan not generated | ⚠️ Release Plan not generated — click Generate to proceed |
| No approver assigned | ⚠️ CAB Approver not assigned |
| Ready to deploy | ✅ Approved — ready for deployment on **EU-W1, EU-DR** |
| On time | ✅ On track — planned window: 15–20 Mar |
| At risk (date) | ⏰ At risk — planned window starts in 3 days, still in QA |

#### Quick Actions (context-sensitive buttons on the card)

Only actions that are **currently valid** are shown — never a list of all possible actions:

| Current state | Quick actions shown |
|---|---|
| Draft, no WOs | [Add Work Orders] [Open Release →] |
| Draft, WOs selected, plan not generated | [Generate Release Plan ⚡] [Open Release →] |
| Plan generated, no CAB approver | [Request CAB Approval] [Open Release →] |
| Awaiting CAB approval | [Approve CAB ✓] (if current user is the approver) / [Reassign Approver] / [Open Release →] |
| Approved, no deployment run | [Start Deployment Run 🚀] [Open Release →] |
| Deployment in progress | [View Checklist →] [Open Release →] |
| Deployment blocked | [View Blocked Items] [Notify Responsible] [Open Release →] |
| All DCs deployed | [Close Release ✓] [Open Release →] |

The `[Open Release →]` button is always present as an escape hatch to the full detail page.

---

### Planned Releases Strip (Upcoming)

Compact rows — not full cards. Shows name, type badge, planned date window, status, and WO count:

```
○ Q2-2026 — Platform Refresh     10–14 Jun 2026   planned   3 WOs  [Promote to Draft]
○ Q3-2026 — Auth v2              Sep 2026          planned   —      [Edit]
○ Emergency — Security patch     TBD               planned   —      [Edit]
```

Clicking [Promote to Draft] transitions the release to `draft` and navigates to the full detail page.

---

### Attention Banner (top of page)

A dismissible yellow/red bar at the top summarises the most urgent issues across ALL in-flight releases:

```
⚠️  2 releases need attention:
    · Q1-2026 Hotfix — 2 deployment steps BLOCKED (since 2h ago)
    · Q2-2026 — CAB approval pending for 3 days (John Doe)
```

Each item is a link. Dismissing hides the banner for the session only — it re-appears if new blockers appear.

---

### Backend

No new DB tables. New API endpoint:

```
GET /release-center/summary
```

Returns a single, pre-aggregated JSON response:

```json
{
  "in_flight": [
    {
      "id": "...",
      "name": "Q1-2026 — Open Banking Core",
      "release_type": "RELEASE",
      "status": "in_progress",
      "phase": "prep",
      "data_centers": ["EU-W1", "EU-DR"],
      "planned_start": "2026-03-15",
      "planned_end": "2026-03-20",
      "days_to_window": 5,
      "blocker": null,
      "waiting_on": { "type": "cab_approval", "user": "John Doe", "since": "2026-03-12T10:00:00Z" },
      "next_action": "cab_approval",
      "work_orders_count": 8,
      "deployment_runs": [...]
    }
  ],
  "planned": [...],
  "recently_closed": [...]
}
```

Endpoint is lightweight — no heavy joins. Uses existing columns on `platform_releases`, `deployment_runs`, `wo_dc_deployments`. The `waiting_on` and `next_action` fields are computed server-side (state-machine logic, ~50 lines).

**Quick action endpoints** (all already exist or are being added in other features):
- `POST /platform-releases/{id}/approve-cab`
- `POST /platform-releases/{id}/deployment-runs`
- `PATCH /deployment-runs/{run_id}/items/{item_id}`
- `POST /platform-releases/{id}/close`

No new write endpoints needed for the Release Center.

---

### Frontend

Single page component: `app/(app)/release-center/page.tsx`

Component breakdown:

| Component | Purpose |
|---|---|
| `ReleaseCenterPage` | Page shell, fetches `/release-center/summary`, auto-refreshes every 60s |
| `AttentionBanner` | Top-of-page urgent items bar |
| `ReleaseTrackCard` | Full-width card for each in-flight release |
| `TrajectoryStrip` | Phase checkpoint visualisation (CSS-based, no chart library) |
| `StatusBanner` | One-line contextual status + owner inside the card |
| `QuickActionBar` | Context-sensitive action buttons |
| `PlannedReleasesStrip` | Compact upcoming releases list |
| `RecentlyClosedStrip` | Last 3–5 closed releases |

**Auto-refresh:** The page polls `GET /release-center/summary` every 60 seconds silently (no loading spinner on refresh — data updates in place). A small "Updated Xs ago" indicator sits in the page header.

**No navigation away for quick actions:** CAB approval, starting a deployment run, or notifying a blocked-item owner all happen via API call triggered directly from the card — a success toast confirms, the card updates in place. Only "Open Release →" navigates away.

---

### Roles & Access

| User | What they see |
|---|---|
| **Release Manager** | All releases, all quick actions available |
| **Developer** | All releases visible (read-only cards), no quick action buttons except "Open Release →" |
| **DevOps Engineer** | In-flight releases; "Start Deployment Run" and "View Checklist" quick actions visible |
| **CAB Approver** | "Approve CAB ✓" quick action visible only on releases where they are named as approver |
| **Executive / Observer** | Read-only view of all cards, attention banner, trajectory — no action buttons |
