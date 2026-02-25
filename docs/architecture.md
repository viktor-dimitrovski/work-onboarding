# System Overview

The platform is implemented as a modular monolith with clear domain boundaries inside one FastAPI backend and one Next.js frontend.

## Backend Domains

- Identity and access: users, roles, JWT access/refresh flow, RBAC guards.
- Tracks: templates, versions, phases, tasks, resources, publish/duplicate workflows.
- Assignments: assignment snapshot creation from published track versions.
- Progress: submissions, mentor reviews, quiz attempts, next-task recommendation.
- Reporting: role-specific dashboard aggregates.

## Frontend Zones

- Auth and role-aware app shell.
- Track builder and publication views.
- Assignment operations and employee onboarding flow.
- Reports, user administration, settings placeholders.

## Persistence

- PostgreSQL is mandatory.
- Alembic migration initializes schema from SQLAlchemy models.
- Raw SQL scripts provide DBA-reviewed bootstrap, demo seeds, views, verification, and drop/reset.
