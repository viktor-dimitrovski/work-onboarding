from fastapi.testclient import TestClient

from tests.conftest import login


def test_auth_login_and_refresh(client: TestClient) -> None:
    auth_payload = login(client, 'seed-admin@example.com')
    assert auth_payload['access_token']
    assert auth_payload['refresh_token']
    assert auth_payload['user']['email'] == 'seed-admin@example.com'

    refresh_response = client.post(
        '/api/v1/auth/refresh',
        json={'refresh_token': auth_payload['refresh_token']},
    )
    assert refresh_response.status_code == 200

    refreshed = refresh_response.json()
    assert refreshed['access_token']
    assert refreshed['refresh_token']
    assert refreshed['refresh_token'] != auth_payload['refresh_token']
