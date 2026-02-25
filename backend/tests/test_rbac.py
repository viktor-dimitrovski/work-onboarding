from fastapi.testclient import TestClient

from tests.conftest import auth_header, login


def test_role_protected_route_access(client: TestClient) -> None:
    employee_tokens = login(client, 'seed-employee-1@example.com')
    forbidden = client.get('/api/v1/users', headers=auth_header(employee_tokens['access_token']))
    assert forbidden.status_code == 403

    admin_tokens = login(client, 'seed-admin@example.com')
    allowed = client.get('/api/v1/users', headers=auth_header(admin_tokens['access_token']))
    assert allowed.status_code == 200
    payload = allowed.json()
    assert payload['meta']['total'] >= 1
