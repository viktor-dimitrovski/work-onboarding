from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import HTTPException, status

from app.core.config import settings


def get_embedding(text: str) -> list[float]:
    api_key = (settings.OPENAI_API_KEY or os.environ.get("OPENAI_API_KEY", "")).strip()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OPENAI_API_KEY is not configured on the server.",
        )
    api_base = (settings.OPENAI_API_BASE or os.environ.get("OPENAI_API_BASE", "https://api.openai.com/v1")).strip()
    model = (settings.OPENAI_EMBEDDING_MODEL or os.environ.get("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")).strip()
    url = f"{api_base}/embeddings"

    headers: dict[str, str] = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    project_id = (settings.OPENAI_PROJECT_ID or os.environ.get("OPENAI_PROJECT_ID", "")).strip()
    if project_id:
        headers["OpenAI-Project"] = project_id

    payload: dict[str, Any] = {"model": model, "input": text}
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(url, headers=headers, json=payload)
    if resp.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Embedding request failed ({resp.status_code}).",
        )
    data = resp.json()
    items = data.get("data") or []
    if not items:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Embedding response missing data.")
    embedding = items[0].get("embedding")
    if not isinstance(embedding, list):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Invalid embedding response.")
    return [float(x) for x in embedding]
