from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class ReleaseManifestDeployItem(BaseModel):
    service_id: str
    repo: str | None = None
    version: str | None = None
    release_notes: str | None = None


class ReleaseManifestPreviewRequest(BaseModel):
    rel_id: str = Field(min_length=4)
    env: str = Field(min_length=2)
    window: str | None = ''
    work_orders: list[str] = Field(default_factory=list)
    versions: dict[str, str] = Field(default_factory=dict)
    release_notes: dict[str, str] = Field(default_factory=dict)
    ref: str | None = None


class ReleaseManifestPreviewOut(BaseModel):
    markdown: str
    deploy_list: list[ReleaseManifestDeployItem] = Field(default_factory=list)


class ReleaseManifestOut(BaseModel):
    rel_id: str
    path: str
    sha: str | None = None
    raw_markdown: str
    env: str | None = None
    window: str | None = None
    includes_work_orders: list[str] = Field(default_factory=list)
    versions: dict[str, str] = Field(default_factory=dict)
    release_notes: dict[str, str] = Field(default_factory=dict)
    deploy_list: list[ReleaseManifestDeployItem] = Field(default_factory=list)
    sync_status: str | None = None
    last_sync_at: datetime | None = None
    last_sync_error: str | None = None
    sync_requested_at: datetime | None = None
    pr_url: str | None = None
    branch: str | None = None
    git_repo_full_name: str | None = None
    git_folder_path: str | None = None
    git_path: str | None = None
    git_branch: str | None = None
    git_sha: str | None = None
