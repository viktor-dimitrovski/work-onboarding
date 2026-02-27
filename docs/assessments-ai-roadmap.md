# Assessments AI/PDF Roadmap (P1/P2)

This document outlines planned enhancements beyond the Assessments P0 MVP. It is a design plan only.

## P1 — Source library + AI question generation

### Source library (PDF + links)
- **Purpose**: create a governed library of source materials for assessments.
- **Sources**:
  - PDF uploads (policy docs, runbooks, compliance manuals).
  - External links (optional).
- **Storage**:
  - File metadata table (`assessment_sources`): title, type, checksum, uploaded_by, tags, status.
  - File storage: existing file upload mechanism or object storage (S3/Azure Blob).

### Extraction & citations
- **Extraction pipeline**:
  - Extract text per page (or chunk).
  - Persist chunks with references (`page_number`, `section`, `hash`).
- **Citations**:
  - Each AI-generated question candidate includes citations:
    - `source_id`, `page_number`, `chunk_id`, `excerpt`.
  - Citations are displayed during review and stored with the question snapshot.

### AI question generation
- **Input**: selected sources + topic + difficulty + question count + type (single/multi).
- **Output**: question candidates (prompt + options + correct answers + explanation + citations).
- **Workflow**:
  1. Generate candidates (draft status).
  2. Review queue UI: approve/edit/reject.
  3. Approved questions are inserted into the Question Bank (published or draft).

### Review queue (MVP)
- List of candidates with quick approve/edit/reject.
- Batch operations (approve N).
- Minimal audit trail (who approved, when).

## P2 — Campaign windows, OAuth SSO, recommendations

### Campaign windows
- **Delivery windows**:
  - `starts_at` / `ends_at` enforced.
  - `duration_minutes` enforced from attempt start.
  - Grace handling: if attempt starts before `ends_at`, allow completion until `expires_at`.
- **Attempt rules**:
  - One in-progress attempt at a time.
  - Attempts tracked with `expires_at`.
  - Attempts beyond `attempts_allowed` blocked.

### OAuth SSO
- **Goal**: support Microsoft, Google, GitHub sign-in.
- **Options**:
  - NextAuth on frontend (if moving to standard OAuth flow).
  - FastAPI OAuth (server-side session + JWT).
- **Prereqs**:
  - Provider app registrations.
  - Callback URLs per environment.
  - Role mapping rules (email domain → role).

### Recommendations & trends
- **Aggregate reporting**:
  - Per-topic accuracy.
  - Question difficulty calibration (false positives/negatives).
  - Knowledge gaps by role/team.
- **Recommendations**:
  - Suggested training tracks based on low scores.
  - Flag questions with ambiguous answers (low consensus).
