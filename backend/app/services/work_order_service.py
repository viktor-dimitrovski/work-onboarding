from __future__ import annotations

import datetime as dt
import re
from typing import Any

from app.schemas.work_orders import ServiceTouchedItem, WorkOrderParsed


def _slugify(text: str) -> str:
    value = (text or "").strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"^-+|-+$", "", value)
    return value or "work-order"


def _guess_year(wo_id: str) -> str:
    match = re.search(r"\b(20\d{2})\b", wo_id or "")
    if match:
        return match.group(1)
    return str(dt.datetime.utcnow().year)


def build_work_order_path(wo_id: str, title: str) -> str:
    year = _guess_year(wo_id)
    slug = _slugify(title)
    return f"work-orders/{year}/{wo_id}-{slug}.md"


def _to_inline_list(items: list[str]) -> str:
    cleaned = [item.strip() for item in items if item and item.strip()]
    if not cleaned:
        return "[]"
    return "[" + ", ".join(cleaned) + "]"


def compile_work_order_markdown(
    *,
    wo_id: str | None = None,
    title: str,
    wo_type: str | None = None,
    status: str | None = None,
    owner: str | None = None,
    requested_by: str | None = None,
    tenants_impacted: list[str] | None = None,
    risk: str | None = None,
    target_envs: list[str] | None = None,
    postman_testing_ref: str | None = None,
    services_touched: list[ServiceTouchedItem],
    body_markdown: str,
) -> str:
    fm_lines: list[str] = ["---"]
    if wo_id:
        fm_lines.append(f"id: {wo_id}")
    fm_lines.append(f"title: {title}")
    if wo_type:
        fm_lines.append(f"type: {wo_type}")
    if status:
        fm_lines.append(f"status: {status}")
    if owner:
        fm_lines.append(f"owner: {owner}")
    if requested_by:
        fm_lines.append(f"requested_by: {requested_by}")
    if tenants_impacted:
        fm_lines.append(f"tenants_impacted: {_to_inline_list(tenants_impacted)}")
    if risk:
        fm_lines.append(f"risk: {risk}")
    if target_envs:
        fm_lines.append(f"target_envs: {_to_inline_list(target_envs)}")
    if postman_testing_ref:
        fm_lines.append(f"postman_testing_ref: {postman_testing_ref}")
    fm_lines.append("")
    fm_lines.append("services_touched:")

    if not services_touched:
        fm_lines[-1] = "services_touched: []"
    else:
        for item in services_touched:
            fm_lines.append(f"  - service_id: {item.service_id}")
            fm_lines.append(f"    repo: {item.repo or ''}")
            if item.change_type:
                fm_lines.append(f"    change_type: {item.change_type}")
            fm_lines.append(f"    requires_deploy: {'true' if item.requires_deploy else 'false'}")
            fm_lines.append(f"    requires_db_migration: {'true' if item.requires_db_migration else 'false'}")
            fm_lines.append(f"    requires_config_change: {'true' if item.requires_config_change else 'false'}")
            fm_lines.append(f"    feature_flags: {_to_inline_list(item.feature_flags)}")
            fm_lines.append(f"    release_notes_ref: {item.release_notes_ref or ''}")

    fm_lines.append("---")
    body = (body_markdown or "").strip()
    if body:
        return "\n".join(fm_lines) + "\n\n" + body + "\n"
    return "\n".join(fm_lines) + "\n"


def _parse_inline_list(value: str) -> list[str]:
    value = (value or "").strip()
    if not value.startswith("[") or not value.endswith("]"):
        return []
    inner = value[1:-1].strip()
    if not inner:
        return []
    parts = []
    cur = ""
    in_q = False
    qchar = ""
    for ch in inner:
        if ch in ("'", '"'):
            if in_q and ch == qchar:
                in_q = False
                qchar = ""
            elif not in_q:
                in_q = True
                qchar = ch
            cur += ch
        elif ch == "," and not in_q:
            parts.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur.strip())

    def strip_quotes(s: str) -> str:
        s = s.strip()
        if len(s) >= 2 and ((s[0] == s[-1] == '"') or (s[0] == s[-1] == "'")):
            return s[1:-1]
        return s

    return [strip_quotes(p) for p in parts if strip_quotes(p)]


def _read_front_matter(lines: list[str]) -> tuple[dict[str, str], int]:
    if not lines or lines[0].strip() != "---":
        return {}, 0
    fm: dict[str, str] = {}
    i = 1
    while i < len(lines):
        if lines[i].strip() == "---":
            return fm, i + 1
        line = lines[i].rstrip("\n")
        if not line.strip() or line.lstrip().startswith("#"):
            i += 1
            continue
        if re.match(r"^[A-Za-z0-9_\-]+:\s*", line) and not line.startswith(" "):
            k, _, v = line.partition(":")
            fm[k.strip()] = v.strip()
        i += 1
    return fm, i


def _extract_services_block(lines: list[str]) -> list[ServiceTouchedItem]:
    if not lines or lines[0].strip() != "---":
        return []
    try:
        start = 1
        end = next(i for i in range(1, len(lines)) if lines[i].strip() == "---")
    except StopIteration:
        return []
    fm_lines = [l.rstrip("\n") for l in lines[start:end]]

    idx = None
    for i, line in enumerate(fm_lines):
        if line.strip() == "services_touched:":
            idx = i
            break
    if idx is None:
        return []
    block = []
    for line in fm_lines[idx + 1 :]:
        if line and not line.startswith(" "):
            break
        block.append(line)

    services: list[ServiceTouchedItem] = []
    current: dict[str, Any] | None = None

    def flush() -> None:
        nonlocal current
        if current and current.get("service_id"):
            services.append(ServiceTouchedItem(**current))
        current = None

    for raw in block:
        line = raw.rstrip()
        if not line.strip():
            continue
        if line.startswith("  - "):
            flush()
            rest = line[4:].strip()
            current = {
                "service_id": "",
                "repo": "",
                "change_type": None,
                "requires_deploy": False,
                "requires_db_migration": False,
                "requires_config_change": False,
                "feature_flags": [],
                "release_notes_ref": "",
            }
            if ":" in rest:
                k, _, v = rest.partition(":")
                if k.strip() == "service_id":
                    current["service_id"] = v.strip()
            continue

        if current is None:
            continue
        match = re.match(r"^\s{4}([A-Za-z0-9_\-]+):\s*(.*)$", line)
        if not match:
            continue
        key = match.group(1).strip()
        value = match.group(2).strip()
        if key == "service_id":
            current["service_id"] = value
        elif key == "repo":
            current["repo"] = value
        elif key == "change_type":
            current["change_type"] = value or None
        elif key == "requires_deploy":
            current["requires_deploy"] = value.lower() in {"true", "yes", "1", "y", "on"}
        elif key == "requires_db_migration":
            current["requires_db_migration"] = value.lower() in {"true", "yes", "1", "y", "on"}
        elif key == "requires_config_change":
            current["requires_config_change"] = value.lower() in {"true", "yes", "1", "y", "on"}
        elif key == "feature_flags":
            current["feature_flags"] = _parse_inline_list(value)
        elif key == "release_notes_ref":
            current["release_notes_ref"] = value

    flush()
    return services


def parse_work_order_markdown(raw_markdown: str) -> WorkOrderParsed:
    lines = raw_markdown.splitlines(True)
    front_matter, end_idx = _read_front_matter(lines)
    title = front_matter.get("title", "").strip()
    wo_type = front_matter.get("type", "").strip() or None
    status = front_matter.get("status", "").strip() or None
    owner = front_matter.get("owner", "").strip() or None
    requested_by = front_matter.get("requested_by", "").strip() or None
    tenants_impacted = _parse_inline_list(front_matter.get("tenants_impacted", ""))
    risk = front_matter.get("risk", "").strip() or None
    target_envs = _parse_inline_list(front_matter.get("target_envs", ""))
    postman_testing_ref = front_matter.get("postman_testing_ref", "").strip() or None
    services = _extract_services_block(lines)
    body = "".join(lines[end_idx:]).lstrip("\n")
    return WorkOrderParsed(
        title=title,
        wo_type=wo_type,
        status=status,
        owner=owner,
        requested_by=requested_by,
        tenants_impacted=tenants_impacted,
        risk=risk,
        target_envs=target_envs,
        postman_testing_ref=postman_testing_ref,
        services_touched=services,
        body_markdown=body,
    )
