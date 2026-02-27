from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx
from fastapi import HTTPException, status

from app.core.config import settings


def _extract_output_text(data: dict[str, Any]) -> str:
    if isinstance(data.get("output_text"), str) and data["output_text"].strip():
        return data["output_text"].strip()

    output = data.get("output")
    if not isinstance(output, list):
        return ""

    parts: list[str] = []
    for item in output:
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        content = item.get("content")
        if not isinstance(content, list):
            continue
        for c in content:
            if not isinstance(c, dict):
                continue
            if c.get("type") in ("output_text", "text") and isinstance(c.get("text"), str):
                parts.append(c["text"])
    return "\n".join(parts).strip()


def _extract_refusal(data: dict[str, Any]) -> str:
    if isinstance(data.get("refusal"), str) and data["refusal"].strip():
        return data["refusal"].strip()

    output = data.get("output")
    if not isinstance(output, list):
        return ""
    for item in output:
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        content = item.get("content")
        if not isinstance(content, list):
            continue
        for c in content:
            if not isinstance(c, dict):
                continue
            if c.get("type") == "refusal":
                if isinstance(c.get("refusal"), str) and c["refusal"].strip():
                    return c["refusal"].strip()
                if isinstance(c.get("text"), str) and c["text"].strip():
                    return c["text"].strip()
    return ""


def _parse_json_from_text(text: str) -> dict[str, Any]:
    try:
        return json.loads(text)
    except Exception:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            raise
        return json.loads(match.group(0))


def _should_fallback_to_json_object(status_code: int, body_text: str) -> bool:
    if status_code != 400:
        return False
    return ("text.format" in body_text) and ("json_schema" in body_text) and ("not supported" in body_text.lower())


def call_openai_responses_json(
    *,
    instructions: str,
    input_text: str,
    schema_name: str,
    schema: dict[str, Any],
    temperature: float = 0.2,
    timeout_ms: int = 45_000,
) -> dict[str, Any]:
    api_key = (settings.OPENAI_API_KEY or os.environ.get("OPENAI_API_KEY", "")).strip()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OPENAI_API_KEY is not configured on the server.",
        )

    api_base = (settings.OPENAI_API_BASE or os.environ.get("OPENAI_API_BASE", "https://api.openai.com/v1")).strip()
    model = (settings.OPENAI_MODEL or os.environ.get("OPENAI_MODEL", "gpt-5.2-pro")).strip()
    url = f"{api_base}/responses"

    headers: dict[str, str] = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    project_id = (settings.OPENAI_PROJECT_ID or os.environ.get("OPENAI_PROJECT_ID", "")).strip()
    if project_id:
        headers["OpenAI-Project"] = project_id

    def make_body(mode: str) -> dict[str, Any]:
        if mode == "json_object":
            text_format: dict[str, Any] = {"type": "json_object"}
        else:
            text_format = {
                "type": "json_schema",
                "name": schema_name,
                "strict": True,
                "schema": schema,
            }

        return {
            "model": model,
            "instructions": instructions,
            "input": input_text,
            "temperature": temperature,
            "text": {"format": text_format},
        }

    primary_mode = (settings.OPENAI_TEXT_FORMAT or os.environ.get("OPENAI_TEXT_FORMAT", "")).strip().lower()
    mode = "json_object" if primary_mode == "json_object" else "json_schema"

    with httpx.Client(timeout=httpx.Timeout(timeout_ms / 1000.0)) as client:
        resp = client.post(url, headers=headers, json=make_body(mode))
        body_text = resp.text
        if not resp.is_success and mode == "json_schema" and _should_fallback_to_json_object(resp.status_code, body_text):
            mode = "json_object"
            resp = client.post(url, headers=headers, json=make_body(mode))
            body_text = resp.text

    if not resp.is_success:
        raise HTTPException(
            status_code=resp.status_code if 400 <= resp.status_code < 500 else status.HTTP_502_BAD_GATEWAY,
            detail=f"OpenAI upstream error {resp.status_code}: {body_text[:2000]}",
        )

    data = resp.json()
    refusal = _extract_refusal(data)
    if refusal:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"OpenAI refusal: {refusal}")

    output_text = _extract_output_text(data)
    if not output_text:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="OpenAI returned no text output.")

    try:
        return _parse_json_from_text(output_text)
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to parse OpenAI JSON output: {str(err)}",
        ) from err
