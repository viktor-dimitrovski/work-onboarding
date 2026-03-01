from pydantic import BaseModel, Field


class TrackPurposeLabel(BaseModel):
    value: str
    label: str


class WorkOrdersGitHubSettings(BaseModel):
    enabled: bool = False
    repo_full_name: str | None = None  # e.g. org/repo
    folder_path: str = "work-orders"  # root folder in repo
    release_manifests_folder_path: str = "releases"
    base_branch: str | None = None  # defaults to backend GITHUB_BASE_BRANCH
    installation_id: int | None = None  # GitHub App installation id
    sync_on_save: bool = True


class TenantSettingsOut(BaseModel):
    default_onboarding_target_days: int
    escalation_email: str | None = None
    notification_policy_notes: str | None = None
    track_purpose_labels: list[TrackPurposeLabel] = Field(default_factory=list)
    work_orders_github: WorkOrdersGitHubSettings = Field(default_factory=WorkOrdersGitHubSettings)


class TenantSettingsUpdate(BaseModel):
    default_onboarding_target_days: int | None = None
    escalation_email: str | None = None
    notification_policy_notes: str | None = None
    track_purpose_labels: list[TrackPurposeLabel] | None = None
    work_orders_github: WorkOrdersGitHubSettings | None = None
