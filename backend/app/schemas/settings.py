from pydantic import BaseModel, Field


class TrackPurposeLabel(BaseModel):
    value: str
    label: str


class TenantSettingsOut(BaseModel):
    default_onboarding_target_days: int
    escalation_email: str | None = None
    notification_policy_notes: str | None = None
    track_purpose_labels: list[TrackPurposeLabel] = Field(default_factory=list)


class TenantSettingsUpdate(BaseModel):
    default_onboarding_target_days: int | None = None
    escalation_email: str | None = None
    notification_policy_notes: str | None = None
    track_purpose_labels: list[TrackPurposeLabel] | None = None
