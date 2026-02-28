from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass

from fastapi import HTTPException, status

from app.core.config import settings
from app.schemas.release_manifests import ReleaseManifestDeployItem
from app.schemas.work_orders import ServiceTouchedItem
from app.services import github_repo_service, work_order_service


@dataclass
class ParsedWorkOrder:
    wo_id: str
    title: str
    path: str
    services: list[ServiceTouchedItem]


def guess_year_from_id(any_id: str) -> str:
    match = re.search(r"\b(20\d{2})\b", any_id or "")
    if match:
        return match.group(1)
    return str(dt.datetime.utcnow().year)


def _list_work_order_files(ref: str) -> list[str]:
    try:
        years = github_repo_service.list_dir("work-orders", ref=ref)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_404_NOT_FOUND:
            return []
        raise
    paths: list[str] = []
    for entry in years:
        if entry.get("type") != "dir":
            continue
        year_path = entry.get("path")
        if not year_path:
            continue
        files = github_repo_service.list_dir(year_path, ref=ref)
        for file_item in files:
            if file_item.get("type") != "file":
                continue
            path = file_item.get("path") or ""
            if path.endswith(".md"):
                paths.append(path)
    return paths


def _find_work_order_path(wo_id: str, ref: str) -> str:
    for path in _list_work_order_files(ref):
        filename = path.split("/")[-1]
        if filename.startswith(f"{wo_id}-") or filename == f"{wo_id}.md":
            return path
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Work order {wo_id} not found")


def load_work_orders_from_repo(wo_ids: list[str], *, ref: str | None = None) -> list[ParsedWorkOrder]:
    repo_ref = ref or settings.GITHUB_BASE_BRANCH
    parsed: list[ParsedWorkOrder] = []
    for wo_id in wo_ids:
        path = _find_work_order_path(wo_id, repo_ref)
        raw = github_repo_service.get_file(path, ref=repo_ref)
        data = work_order_service.parse_work_order_markdown(raw["content"])
        parsed.append(
            ParsedWorkOrder(
                wo_id=wo_id,
                title=data.title,
                path=path,
                services=data.services_touched,
            )
        )
    return parsed


def aggregate_distinct_services(work_orders: list[ParsedWorkOrder]) -> dict[str, ServiceTouchedItem]:
    agg: dict[str, ServiceTouchedItem] = {}
    for wo in work_orders:
        for item in wo.services:
            sid = (item.service_id or "").strip()
            if not sid:
                continue
            if sid not in agg:
                agg[sid] = ServiceTouchedItem(
                    service_id=sid,
                    repo=item.repo,
                    requires_deploy=item.requires_deploy,
                    requires_db_migration=item.requires_db_migration,
                    requires_config_change=item.requires_config_change,
                    feature_flags=list(item.feature_flags or []),
                    release_notes_ref=item.release_notes_ref,
                )
                continue
            current = agg[sid]
            current.repo = current.repo or item.repo
            current.requires_deploy = current.requires_deploy or item.requires_deploy
            current.requires_db_migration = current.requires_db_migration or item.requires_db_migration
            current.requires_config_change = current.requires_config_change or item.requires_config_change
            flags = list(dict.fromkeys((current.feature_flags or []) + (item.feature_flags or [])))
            current.feature_flags = flags
            if not current.release_notes_ref and item.release_notes_ref:
                current.release_notes_ref = item.release_notes_ref
    return agg


def _inline_list(items: list[str]) -> str:
    if not items:
        return "[]"
    return "[" + ", ".join(items) + "]"


def generate_rel_markdown(
    *,
    rel_id: str,
    env: str,
    window: str,
    work_orders: list[ParsedWorkOrder],
    versions: dict[str, str],
    release_notes: dict[str, str],
) -> tuple[str, list[ReleaseManifestDeployItem]]:
    agg = aggregate_distinct_services(work_orders)
    deploy_services = [item for item in agg.values() if item.requires_deploy]
    deploy_services.sort(key=lambda row: row.service_id)

    migration_services = [item for item in agg.values() if item.requires_db_migration]
    migration_services.sort(key=lambda row: row.service_id)

    config_services = [
        item
        for item in agg.values()
        if item.requires_config_change or (item.feature_flags and len(item.feature_flags) > 0)
    ]
    config_services.sort(key=lambda row: row.service_id)

    wo_ids = [wo.wo_id for wo in work_orders]

    fm_lines: list[str] = []
    fm_lines.append("---")
    fm_lines.append(f"id: {rel_id}")
    fm_lines.append(f"env: {env}")
    fm_lines.append(f'window: "{window or ""}"')
    fm_lines.append(f"includes_work_orders: {_inline_list(wo_ids)}")
    fm_lines.append("deploy_list:")

    deploy_items: list[ReleaseManifestDeployItem] = []
    for item in deploy_services:
        version = versions.get(item.service_id, "TBD")
        rn = release_notes.get(item.service_id) or item.release_notes_ref or "TBD"
        fm_lines.append(f"  - service_id: {item.service_id}")
        fm_lines.append(f"    repo: {item.repo or 'TBD'}")
        fm_lines.append(f"    version: {version}")
        fm_lines.append(f'    release_notes: "{rn}"')
        deploy_items.append(
            ReleaseManifestDeployItem(
                service_id=item.service_id,
                repo=item.repo or None,
                version=version,
                release_notes=rn,
            )
        )

    fm_lines.append("migrations:")
    if not migration_services:
        fm_lines.append("  - none")
    else:
        for item in migration_services:
            fm_lines.append(f"  - service_id: {item.service_id}")
            fm_lines.append('    note: "TBD - describe migration steps"')

    fm_lines.append("config_changes:")
    if not config_services:
        fm_lines.append("  - none")
    else:
        for item in config_services:
            fm_lines.append(f"  - service_id: {item.service_id}")
            fm_lines.append(f"    feature_flags: {_inline_list(item.feature_flags or [])}")
            fm_lines.append('    note: "TBD - config keys / helm values / env vars"')

    fm_lines.append("post_deploy:")
    fm_lines.append('  smoke_tests: ["TBD"]')
    fm_lines.append('  monitoring: ["TBD"]')
    fm_lines.append("rollback:")
    fm_lines.append('  strategy: "TBD"')
    fm_lines.append("---")

    body: list[str] = []
    body.append("")
    body.append("## Included work orders")
    for wo in work_orders:
        label = f" - {wo.wo_id}"
        if wo.title:
            label += f": {wo.title}"
        label += f" (source: {wo.path})"
        body.append(label)
    body.append("")
    body.append("## Notes")
    body.append("- Fill versions and release_notes where TBD.")
    body.append("- Confirm migrations/config changes and add exact steps.")
    body.append("- Add smoke tests and monitoring checklist specific to this release.")
    body.append("")

    return "\n".join(fm_lines + body), deploy_items
