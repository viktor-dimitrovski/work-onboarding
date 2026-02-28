#!/usr/bin/env python3
import argparse
import datetime as dt
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple


@dataclass
class ServiceTouch:
    service_id: str
    repo: str = ""
    requires_deploy: bool = False
    requires_db_migration: bool = False
    requires_config_change: bool = False
    feature_flags: List[str] = field(default_factory=list)
    release_notes_ref: str = ""


@dataclass
class WorkOrder:
    wo_id: str
    title: str = ""
    path: Path = Path()
    services: List[ServiceTouch] = field(default_factory=list)


def parse_bool(v: str) -> bool:
    v = (v or "").strip().lower()
    return v in ("true", "yes", "1", "y", "on")


def parse_inline_list(v: str) -> List[str]:
    # expects: [a, b, "c d"]
    v = (v or "").strip()
    if not v.startswith("[") or not v.endswith("]"):
        return []
    inner = v[1:-1].strip()
    if not inner:
        return []
    # split by comma not inside quotes (very simple)
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


def read_front_matter(lines: List[str]) -> Tuple[Dict[str, str], int]:
    """
    Reads simple YAML front matter between first two '---' lines.
    Returns: (kv_map, end_index_after_front_matter)
    """
    if not lines or lines[0].strip() != "---":
        return {}, 0
    fm = {}
    i = 1
    while i < len(lines):
        if lines[i].strip() == "---":
            return fm, i + 1
        line = lines[i].rstrip("\n")
        if not line.strip() or line.lstrip().startswith("#"):
            i += 1
            continue
        # only parse "key: value" at top level (no indent)
        if re.match(r"^[A-Za-z0-9_\-]+:\s*", line) and not line.startswith(" "):
            k, _, v = line.partition(":")
            fm[k.strip()] = v.strip()
        i += 1
    return fm, i


def extract_services_block(lines: List[str]) -> List[ServiceTouch]:
    """
    Extracts services_touched list-of-maps from the YAML front matter.
    Assumes template indentation:
      services_touched:
        - service_id: ...
          repo: ...
          requires_deploy: true
          feature_flags: [a, b]
    """
    if not lines or lines[0].strip() != "---":
        return []

    # find start of front matter and locate "services_touched:"
    try:
        start = 1
        end = next(i for i in range(1, len(lines)) if lines[i].strip() == "---")
    except StopIteration:
        return []

    fm_lines = [l.rstrip("\n") for l in lines[start:end]]

    idx = None
    for i, l in enumerate(fm_lines):
        if l.strip() == "services_touched:":
            idx = i
            break
    if idx is None:
        return []

    # collect indented lines until next top-level key (no leading spaces) or end
    block = []
    for l in fm_lines[idx + 1 :]:
        if l and not l.startswith(" "):  # next top-level key
            break
        block.append(l)

    services: List[ServiceTouch] = []
    current: Optional[ServiceTouch] = None

    def flush():
        nonlocal current
        if current and current.service_id:
            # normalize flags list (dedupe, keep order)
            seen = set()
            ff = []
            for x in current.feature_flags:
                x = (x or "").strip()
                if x and x not in seen:
                    seen.add(x)
                    ff.append(x)
            current.feature_flags = ff
            services.append(current)
        current = None

    for raw in block:
        line = raw.rstrip()
        if not line.strip():
            continue

        if line.startswith("  - "):
            flush()
            # "- key: value" after dash
            rest = line[4:].strip()
            current = ServiceTouch(service_id="")
            if ":" in rest:
                k, _, v = rest.partition(":")
                k = k.strip()
                v = v.strip()
                if k == "service_id":
                    current.service_id = v
            continue

        if current is None:
            continue

        # expected "    key: value"
        m = re.match(r"^\s{4}([A-Za-z0-9_\-]+):\s*(.*)$", line)
        if not m:
            continue
        k = m.group(1).strip()
        v = m.group(2).strip()

        if k == "service_id":
            current.service_id = v
        elif k == "repo":
            current.repo = v
        elif k == "requires_deploy":
            current.requires_deploy = parse_bool(v)
        elif k == "requires_db_migration":
            current.requires_db_migration = parse_bool(v)
        elif k == "requires_config_change":
            current.requires_config_change = parse_bool(v)
        elif k == "feature_flags":
            current.feature_flags = parse_inline_list(v)
        elif k == "release_notes_ref":
            current.release_notes_ref = v

    flush()
    return services


def find_work_order_file(wo_id: str) -> Path:
    base = Path("work-orders")
    matches = list(base.rglob(f"{wo_id}-*.md"))
    if not matches:
        # fallback: exact file name wo_id.md
        matches = list(base.rglob(f"{wo_id}.md"))
    if not matches:
        raise FileNotFoundError(f"Could not find file for {wo_id} under work-orders/")
    # if multiple, pick the first (or prefer shortest path)
    matches.sort(key=lambda p: len(str(p)))
    return matches[0]


def load_work_order(wo_id: str) -> WorkOrder:
    path = find_work_order_file(wo_id)
    lines = path.read_text(encoding="utf-8").splitlines(True)
    fm, _ = read_front_matter(lines)
    title = fm.get("title", "").strip()
    services = extract_services_block(lines)
    return WorkOrder(wo_id=wo_id, title=title, path=path, services=services)


def parse_pairs(s: str) -> Dict[str, str]:
    """
    Parses "a=b,c=d" into dict.
    """
    out: Dict[str, str] = {}
    s = (s or "").strip()
    if not s:
        return out
    parts = [p.strip() for p in s.split(",") if p.strip()]
    for p in parts:
        if "=" not in p:
            continue
        k, v = p.split("=", 1)
        k = k.strip()
        v = v.strip()
        if k and v:
            out[k] = v
    return out


def guess_year_from_id(any_id: str) -> str:
    m = re.search(r"\b(20\d{2})\b", any_id)
    if m:
        return m.group(1)
    return str(dt.datetime.utcnow().year)


def to_yaml_list(items: List[str]) -> str:
    if not items:
        return "[]"
    return "[" + ", ".join(items) + "]"


def generate_rel_markdown(
    release_id: str,
    env: str,
    window: str,
    work_orders: List[WorkOrder],
    versions: Dict[str, str],
    release_notes: Dict[str, str],
) -> str:
    # Aggregate distinct services
    agg: Dict[str, ServiceTouch] = {}
    for wo in work_orders:
        for s in wo.services:
            sid = (s.service_id or "").strip()
            if not sid:
                continue
            if sid not in agg:
                agg[sid] = ServiceTouch(
                    service_id=sid,
                    repo=s.repo,
                    requires_deploy=s.requires_deploy,
                    requires_db_migration=s.requires_db_migration,
                    requires_config_change=s.requires_config_change,
                    feature_flags=list(s.feature_flags or []),
                    release_notes_ref=s.release_notes_ref,
                )
            else:
                a = agg[sid]
                if not a.repo and s.repo:
                    a.repo = s.repo
                a.requires_deploy = a.requires_deploy or s.requires_deploy
                a.requires_db_migration = a.requires_db_migration or s.requires_db_migration
                a.requires_config_change = a.requires_config_change or s.requires_config_change
                # merge feature flags
                a.feature_flags = list(dict.fromkeys((a.feature_flags or []) + (s.feature_flags or [])))
                # keep any release_notes_ref if exists
                if not a.release_notes_ref and s.release_notes_ref:
                    a.release_notes_ref = s.release_notes_ref

    # Build lists
    deploy_services = [s for s in agg.values() if s.requires_deploy]
    deploy_services.sort(key=lambda x: x.service_id)

    migration_services = [s for s in agg.values() if s.requires_db_migration]
    migration_services.sort(key=lambda x: x.service_id)

    config_services = [s for s in agg.values() if (s.requires_config_change or (s.feature_flags and len(s.feature_flags) > 0))]
    config_services.sort(key=lambda x: x.service_id)

    wo_ids = [wo.wo_id for wo in work_orders]

    # YAML front matter
    fm_lines = []
    fm_lines.append("---")
    fm_lines.append(f"id: {release_id}")
    fm_lines.append(f"env: {env}")
    fm_lines.append(f"window: \"{window}\"" if window else "window: \"\"")
    fm_lines.append(f"includes_work_orders: {to_yaml_list(wo_ids)}")
    fm_lines.append("deploy_list:")

    for s in deploy_services:
        ver = versions.get(s.service_id, "TBD")
        rn = release_notes.get(s.service_id, "")
        if not rn:
            rn = "TBD"
        fm_lines.append(f"  - service_id: {s.service_id}")
        fm_lines.append(f"    repo: {s.repo or 'TBD'}")
        fm_lines.append(f"    version: {ver}")
        fm_lines.append(f"    release_notes: \"{rn}\"")

    fm_lines.append("migrations:")
    if not migration_services:
        fm_lines.append("  - none")
    else:
        for s in migration_services:
            fm_lines.append(f"  - service_id: {s.service_id}")
            fm_lines.append("    note: \"TBD - describe migration steps\"")

    fm_lines.append("config_changes:")
    if not config_services:
        fm_lines.append("  - none")
    else:
        for s in config_services:
            fm_lines.append(f"  - service_id: {s.service_id}")
            if s.feature_flags:
                fm_lines.append(f"    feature_flags: {to_yaml_list(s.feature_flags)}")
            else:
                fm_lines.append("    feature_flags: []")
            fm_lines.append("    note: \"TBD - config keys / helm values / env vars\"")

    fm_lines.append("post_deploy:")
    fm_lines.append("  smoke_tests: [\"TBD\"]")
    fm_lines.append("  monitoring: [\"TBD\"]")
    fm_lines.append("rollback:")
    fm_lines.append("  strategy: \"TBD\"")
    fm_lines.append("---")

    # Body
    body = []
    body.append("")
    body.append("## Included work orders")
    for wo in work_orders:
        t = f" - {wo.wo_id}"
        if wo.title:
            t += f": {wo.title}"
        t += f" (source: {wo.path.as_posix()})"
        body.append(t)

    body.append("")
    body.append("## Notes")
    body.append("- Fill versions and release_notes where TBD.")
    body.append("- Confirm migrations/config changes and add exact steps.")
    body.append("- Add smoke tests and monitoring checklist specific to this release.")
    body.append("")

    return "\n".join(fm_lines + body)


def main() -> int:
    ap = argparse.ArgumentParser(description="Aggregate multiple Work Orders into a Release Manifest (REL).")
    ap.add_argument("--release-id", required=True, help="REL id e.g. REL-2025-12-19-prod-01")
    ap.add_argument("--env", required=True, help="Environment e.g. prod, staging")
    ap.add_argument("--window", default="", help="Deployment window free text")
    ap.add_argument("--work-orders", required=True, help="Comma-separated WO ids e.g. WO-2025-0123,WO-2025-0129")
    ap.add_argument("--versions", default="", help="Optional: service_id=tag pairs comma-separated")
    ap.add_argument("--release-notes", default="", help="Optional: service_id=url pairs comma-separated")
    ap.add_argument("--output", default="", help="Optional output path; default releases/<year>/<release_id>.md")
    args = ap.parse_args()

    wo_ids = [x.strip() for x in args.work_orders.split(",") if x.strip()]
    if not wo_ids:
        raise ValueError("No work orders provided.")

    versions = parse_pairs(args.versions)
    rn = parse_pairs(args.release_notes)

    work_orders: List[WorkOrder] = []
    for wo_id in wo_ids:
        work_orders.append(load_work_order(wo_id))

    year = guess_year_from_id(args.release_id)
    out_path = Path(args.output) if args.output else Path("releases") / year / f"{args.release_id}.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    content = generate_rel_markdown(
        release_id=args.release_id,
        env=args.env,
        window=args.window,
        work_orders=work_orders,
        versions=versions,
        release_notes=rn,
    )
    out_path.write_text(content, encoding="utf-8")
    print(f"Generated: {out_path.as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
