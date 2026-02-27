from fastapi.testclient import TestClient

from tests.conftest import login, tenant_headers


def test_assignment_creation(client: TestClient) -> None:
    admin = login(client, 'seed-admin@example.com')

    track_response = client.post(
        '/api/v1/tracks',
        headers=tenant_headers(admin['access_token']),
        json={
            'title': 'Backend Engineer Onboarding',
            'description': 'Track for backend onboarding',
            'role_target': 'backend',
            'estimated_duration_days': 45,
            'tags': ['backend', 'api'],
            'phases': [
                {
                    'title': 'Foundations',
                    'order_index': 0,
                    'tasks': [
                        {
                            'title': 'Read API standards',
                            'task_type': 'read_material',
                            'required': True,
                            'order_index': 0,
                            'estimated_minutes': 30,
                            'metadata': {},
                            'resources': [],
                        }
                    ],
                }
            ],
        },
    )
    assert track_response.status_code == 201, track_response.text
    track_payload = track_response.json()

    template_id = track_payload['id']
    version_id = track_payload['versions'][0]['id']

    publish_response = client.post(
        f'/api/v1/tracks/{template_id}/publish/{version_id}',
        headers=tenant_headers(admin['access_token']),
    )
    assert publish_response.status_code == 200, publish_response.text

    users_response = client.get('/api/v1/users', headers=tenant_headers(admin['access_token']))
    employees = [user for user in users_response.json()['items'] if 'employee' in user['roles']]
    mentors = [user for user in users_response.json()['items'] if 'mentor' in user['roles']]
    assert employees and mentors

    assignment_response = client.post(
        '/api/v1/assignments',
        headers=tenant_headers(admin['access_token']),
        json={
            'employee_id': employees[0]['id'],
            'mentor_id': mentors[0]['id'],
            'track_version_id': version_id,
            'start_date': '2026-02-01',
            'target_date': '2026-03-15',
        },
    )
    assert assignment_response.status_code == 201, assignment_response.text
    assignment_payload = assignment_response.json()
    assert assignment_payload['id']
    assert assignment_payload['phases'][0]['tasks'][0]['title'] == 'Read API standards'
