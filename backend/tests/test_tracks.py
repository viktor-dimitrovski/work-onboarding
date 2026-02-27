from fastapi.testclient import TestClient

from tests.conftest import login, tenant_headers


def test_track_creation(client: TestClient) -> None:
    admin = login(client, 'seed-admin@example.com')

    response = client.post(
        '/api/v1/tracks',
        headers=tenant_headers(admin['access_token']),
        json={
            'title': 'QA Engineer Onboarding',
            'description': 'Track for QA onboarding.',
            'role_target': 'qa',
            'estimated_duration_days': 30,
            'tags': ['qa', 'quality'],
            'phases': [
                {
                    'title': 'Orientation',
                    'description': 'Initial orientation tasks',
                    'order_index': 0,
                    'tasks': [
                        {
                            'title': 'Read SSDLC policy',
                            'description': 'Understand secure development lifecycle policy',
                            'instructions': 'Read and acknowledge policy',
                            'task_type': 'read_material',
                            'required': True,
                            'order_index': 0,
                            'estimated_minutes': 20,
                            'metadata': {'document': 's-sdlc-v3'},
                            'resources': [
                                {
                                    'resource_type': 'markdown_text',
                                    'title': 'SSDLC Notes',
                                    'content_text': '# SSDLC policy',
                                    'order_index': 0,
                                    'metadata': {},
                                }
                            ],
                        }
                    ],
                }
            ],
        },
    )

    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload['id']
    assert payload['versions'][0]['status'] == 'draft'
    assert payload['versions'][0]['phases'][0]['tasks'][0]['title'] == 'Read SSDLC policy'
