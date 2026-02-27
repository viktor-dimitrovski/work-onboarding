from fastapi.testclient import TestClient

from tests.conftest import login, tenant_headers


def test_task_completion_and_mentor_approval_flow(client: TestClient) -> None:
    admin = login(client, 'seed-admin@example.com')

    track_response = client.post(
        '/api/v1/tracks',
        headers=tenant_headers(admin['access_token']),
        json={
            'title': 'DevOps Engineer Onboarding',
            'description': 'Track for devops onboarding',
            'role_target': 'devops',
            'estimated_duration_days': 50,
            'tags': ['devops', 'infra'],
            'phases': [
                {
                    'title': 'Deployment Readiness',
                    'order_index': 0,
                    'tasks': [
                        {
                            'title': 'Request mentor approval for staging deployment exercise',
                            'task_type': 'mentor_approval',
                            'required': True,
                            'order_index': 0,
                            'estimated_minutes': 90,
                            'metadata': {'exercise': 'staging-deploy'},
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
    users = users_response.json()['items']
    employee = next(user for user in users if user['email'] == 'seed-employee-1@example.com')
    mentor = next(user for user in users if user['email'] == 'seed-mentor@example.com')

    assignment_response = client.post(
        '/api/v1/assignments',
        headers=tenant_headers(admin['access_token']),
        json={
            'employee_id': employee['id'],
            'mentor_id': mentor['id'],
            'track_version_id': version_id,
            'start_date': '2026-02-01',
            'target_date': '2026-03-15',
        },
    )
    assert assignment_response.status_code == 201, assignment_response.text

    assignment = assignment_response.json()
    assignment_id = assignment['id']
    task_id = assignment['phases'][0]['tasks'][0]['id']

    employee_login = login(client, 'seed-employee-1@example.com')
    submit_response = client.post(
        f'/api/v1/progress/assignments/{assignment_id}/tasks/{task_id}/submit',
        headers=tenant_headers(employee_login['access_token']),
        json={
            'submission_type': 'text',
            'answer_text': 'Deployed app to staging with monitoring enabled.',
            'metadata': {'deployment_id': 'dep-1001'},
        },
    )
    assert submit_response.status_code == 200, submit_response.text

    assignment_view = client.get(
        f'/api/v1/assignments/{assignment_id}',
        headers=tenant_headers(admin['access_token']),
    )
    assert assignment_view.status_code == 200
    assert assignment_view.json()['phases'][0]['tasks'][0]['status'] == 'pending_review'

    mentor_login = login(client, 'seed-mentor@example.com')
    review_response = client.post(
        f'/api/v1/progress/assignments/{assignment_id}/tasks/{task_id}/review',
        headers=tenant_headers(mentor_login['access_token']),
        json={'decision': 'approve', 'comment': 'Approved. Solid rollout notes.'},
    )
    assert review_response.status_code == 200, review_response.text

    final_assignment = client.get(
        f'/api/v1/assignments/{assignment_id}',
        headers=tenant_headers(admin['access_token']),
    )
    assert final_assignment.status_code == 200
    assert final_assignment.json()['phases'][0]['tasks'][0]['status'] == 'completed'
