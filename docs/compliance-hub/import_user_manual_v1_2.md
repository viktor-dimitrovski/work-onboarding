# Compliance Hub — Tenant Import User Manual (v1.2)

**Canonical import file:** `ComplianceHubTenantImportPackage` (`schema_version: 1.2-tenant`)  
**Key rule:** Import is **per-tenant** and imports **only** the global library snapshot *inside that tenant’s namespace*.

## What’s inside the import file
The file contains exactly:
- `meta` — dataset info (server stores payload hash in import batch)
- `tenant_scope` — tenant hint (optional if tenant is resolved via Host header)
- `library` — the canonical library:
  - `frameworks[]`
  - `domains[]`
  - `controls[]`
  - `profiles[]`

## What is NOT imported
- Evidence (only Text + Links via UI)
- Any tenant runtime state: `control_status`, `tenant_profiles`, audit history

## Why we removed `legacy_csv_controls`
CSV embedding is redundant (all CSV columns map 1:1 to `library.controls`), increases file size, and confuses users about what to edit.  
If someone prefers editing in CSV/Excel, keep a separate CSV sheet and convert it to this JSON format before import.

## Recommended import flow (UI)
1) Compliance Hub → Library Admin → Import
2) Upload JSON
3) Validation + dry-run diff preview
4) Apply → server stores import batch (payload hash)
5) Enable exactly one active profile for the tenant

## Must-pass validations
- Unique IDs: `frameworks.id`, `domains.code`, `controls.id`, `controls.code`, `profiles.id`
- References integrity:
  - `controls[].domain` exists in `domains[].code`
  - `controls[].references[].framework_id` exists in `frameworks[].id`
  - `profiles[].control_ids[]` exist in `controls[].id`
- Enums:
  - `criticality` in {Low, Medium, High}
  - `default_status` in {not_started, in_progress, partial, mostly, implemented, na}
  - `default_score` between 0 and 1

## Editing guidance (what users should change)
- Add/update frameworks/domains/controls/profiles under `library`
- Keep stable keys (`FW_*`, `CTL_*`, `PROFILE_*`) once published to avoid breaking continuity
