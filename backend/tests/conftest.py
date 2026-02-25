import os
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

TEST_DATABASE_URL = os.getenv('TEST_DATABASE_URL')
if not TEST_DATABASE_URL:
    pytest.skip('TEST_DATABASE_URL is required for backend integration tests', allow_module_level=True)

os.environ.setdefault('DATABASE_URL', TEST_DATABASE_URL)
os.environ.setdefault('JWT_SECRET_KEY', 'test-access-secret-32-chars-min-0001')
os.environ.setdefault('JWT_REFRESH_SECRET_KEY', 'test-refresh-secret-32-chars-min-0002')
os.environ.setdefault('APP_ENV', 'test')
os.environ.setdefault('CORS_ORIGINS', 'http://localhost:3000')
os.environ.setdefault('FIRST_ADMIN_EMAIL', 'seed-super-admin@example.com')
os.environ.setdefault('FIRST_ADMIN_PASSWORD', 'SeedPass123!')

from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.rbac import Role, User, UserRole
from app.core.security import hash_password


engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


@pytest.fixture(autouse=True)
def setup_database() -> Generator[None, None, None]:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    db = TestingSessionLocal()
    try:
        _seed_roles(db)
        _seed_users(db)
        db.commit()
    finally:
        db.close()

    yield

    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def db_session() -> Generator[Session, None, None]:
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(db_session: Session) -> Generator[TestClient, None, None]:
    def _override_db() -> Generator[Session, None, None]:
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = _override_db

    with TestClient(app) as api_client:
        yield api_client

    app.dependency_overrides.clear()


def _seed_roles(db: Session) -> None:
    roles = [
        ('super_admin', 'Full access'),
        ('admin', 'Admin access'),
        ('mentor', 'Mentor access'),
        ('employee', 'Employee access'),
        ('hr_viewer', 'HR access'),
        ('reviewer', 'Reviewer access'),
    ]
    for role_name, description in roles:
        db.add(Role(name=role_name, description=description))
    db.flush()


def _seed_users(db: Session) -> None:
    users = [
        ('seed-super-admin@example.com', 'Super Admin', ['super_admin', 'admin']),
        ('seed-admin@example.com', 'Admin User', ['admin']),
        ('seed-mentor@example.com', 'Mentor User', ['mentor']),
        ('seed-employee-1@example.com', 'Employee One', ['employee']),
        ('seed-employee-2@example.com', 'Employee Two', ['employee']),
    ]

    role_map = {role.name: role for role in db.scalars(select(Role)).all()}

    for email, full_name, role_names in users:
        user = User(
            email=email,
            full_name=full_name,
            hashed_password=hash_password('SeedPass123!'),
            is_active=True,
        )
        db.add(user)
        db.flush()

        for role_name in role_names:
            db.add(UserRole(user_id=user.id, role_id=role_map[role_name].id))

    db.flush()


def login(client: TestClient, email: str, password: str = 'SeedPass123!') -> dict:
    response = client.post(
        '/api/v1/auth/login',
        json={
            'email': email,
            'password': password,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def auth_header(access_token: str) -> dict[str, str]:
    return {'Authorization': f'Bearer {access_token}'}
