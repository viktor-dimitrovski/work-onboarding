ROLE_VALUES = [
    'super_admin',
    'admin',
    'mentor',
    'employee',
    'hr_viewer',
    'reviewer',
]

TRACK_VERSION_STATUS_VALUES = ['draft', 'published', 'archived']
TASK_TYPE_VALUES = [
    'read_material',
    'video',
    'checklist',
    'quiz',
    'code_assignment',
    'external_link',
    'mentor_approval',
    'file_upload',
    'assessment_test',
]
RESOURCE_TYPE_VALUES = [
    'markdown_text',
    'rich_text',
    'pdf_link',
    'video_link',
    'external_url',
    'code_snippet',
]
ASSIGNMENT_STATUS_VALUES = [
    'not_started',
    'in_progress',
    'blocked',
    'completed',
    'overdue',
    'archived',
]
ASSIGNMENT_PHASE_STATUS_VALUES = ['not_started', 'in_progress', 'completed']
ASSIGNMENT_TASK_STATUS_VALUES = [
    'not_started',
    'in_progress',
    'blocked',
    'pending_review',
    'revision_requested',
    'completed',
    'overdue',
]
SUBMISSION_STATUS_VALUES = ['submitted', 'reviewed', 'revision_requested']
MENTOR_DECISION_VALUES = ['approve', 'reject', 'revision_requested']
COMMENT_VISIBILITY_VALUES = ['all', 'mentor_only', 'admin_only']
