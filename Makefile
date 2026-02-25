.PHONY: dev backend-dev frontend-dev lint format test migrate seed reset-dev-db docker-up docker-down

dev:
	python scripts/dev.py

backend-dev:
	cd backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

frontend-dev:
	cd frontend && npm run dev

lint:
	cd backend && ruff check app tests
	cd frontend && npm run lint

format:
	cd backend && black app tests
	cd backend && ruff check app tests --fix
	cd frontend && npx prettier --write .

test:
	cd backend && pytest
	cd frontend && npm run test

migrate:
	cd backend && alembic upgrade head

seed:
	python scripts/seed_backend.py

reset-dev-db:
	python scripts/reset_dev_db.py --yes

docker-up:
	docker compose up --build

docker-down:
	docker compose down -v
