# API Surface (MVP)

Base path: `/api/v1`

## Core routes

- `GET /health`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`
- `POST /auth/password-reset-request` (MVP stub)

## Users and RBAC

- `GET /users`
- `POST /users`

## Tracks

- `GET /tracks`
- `POST /tracks`
- `GET /tracks/{template_id}`
- `POST /tracks/{template_id}/duplicate`
- `POST /tracks/{template_id}/publish/{version_id}`

## Assignments

- `GET /assignments`
- `POST /assignments`
- `GET /assignments/my`
- `GET /assignments/{assignment_id}`

## Progress

- `POST /progress/assignments/{assignment_id}/tasks/{task_id}/submit`
- `POST /progress/assignments/{assignment_id}/tasks/{task_id}/review`
- `GET /progress/assignments/{assignment_id}/next-task`

## Reports

- `GET /reports/admin-dashboard`
- `GET /reports/employee-dashboard`
- `GET /reports/mentor-dashboard`
