from __future__ import annotations

import base64
from typing import Any

import httpx
from fastapi import HTTPException, status

from app.core.config import settings

GITHUB_API_BASE = "https://api.github.com"


def _require_github_config() -> tuple[str, str, str]:
    token = (settings.GITHUB_TOKEN or "").strip()
    owner = (settings.GITHUB_REPO_OWNER or "").strip()
    repo = (settings.GITHUB_REPO_NAME or "").strip()
    if not token or not owner or not repo:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GitHub integration is not configured (GITHUB_TOKEN/REPO_OWNER/REPO_NAME).",
        )
    return token, owner, repo


def _build_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "onboarding-release-center",
    }


def _handle_error(resp: httpx.Response, context: str) -> None:
    detail = resp.text[:2000]
    if resp.status_code == 404:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{context} not found.")
    if resp.status_code in {401, 403}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"{context} forbidden. Check GitHub token scopes and repo access.",
        )
    if resp.status_code == 409:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"{context} conflict: {detail}")
    if resp.status_code == 422:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{context} invalid: {detail}")
    if resp.status_code == 429:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="GitHub rate limit exceeded.")
    raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"{context} failed: {detail}")


def _request(method: str, path: str, *, params: dict[str, Any] | None = None, json: Any | None = None) -> Any:
    token, owner, repo = _require_github_config()
    url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}{path}"
    headers = _build_headers(token)
    with httpx.Client(timeout=20.0) as client:
        resp = client.request(method, url, headers=headers, params=params, json=json)
    if not resp.is_success:
        _handle_error(resp, context=f"GitHub API {method} {path}")
    if resp.status_code == 204:
        return None
    return resp.json()


def get_ref_sha(branch: str) -> str:
    data = _request("GET", f"/git/ref/heads/{branch}")
    sha = data.get("object", {}).get("sha")
    if not sha:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="GitHub ref returned no sha.")
    return str(sha)


def create_branch(new_branch: str, from_branch: str) -> str:
    base_sha = get_ref_sha(from_branch)
    try:
        _request(
            "POST",
            "/git/refs",
            json={"ref": f"refs/heads/{new_branch}", "sha": base_sha},
        )
    except HTTPException as exc:
        if exc.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY:
            # Branch already exists; return its sha for reuse.
            return get_ref_sha(new_branch)
        raise
    return base_sha


def get_file(path: str, *, ref: str) -> dict[str, Any]:
    data = _request("GET", f"/contents/{path}", params={"ref": ref})
    if isinstance(data, list):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Requested path is a directory.")
    content_b64 = data.get("content") or ""
    sha = data.get("sha")
    try:
        decoded = base64.b64decode(content_b64).decode("utf-8")
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to decode GitHub file content.",
        ) from exc
    return {"content": decoded, "sha": sha, "path": data.get("path")}


def upsert_file(
    path: str,
    *,
    content: str,
    branch: str,
    message: str,
    sha: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "message": message,
        "content": base64.b64encode(content.encode("utf-8")).decode("utf-8"),
        "branch": branch,
    }
    if sha:
        payload["sha"] = sha
    data = _request("PUT", f"/contents/{path}", json=payload)
    return {"content": data.get("content"), "commit": data.get("commit")}


def create_pr(*, title: str, head: str, base: str, body: str) -> dict[str, Any]:
    data = _request(
        "POST",
        "/pulls",
        json={"title": title, "head": head, "base": base, "body": body},
    )
    return {"url": data.get("html_url"), "number": data.get("number")}


def list_dir(path: str, *, ref: str) -> list[dict[str, Any]]:
    data = _request("GET", f"/contents/{path}", params={"ref": ref})
    if not isinstance(data, list):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Requested path is not a directory.")
    return data
