from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class HostResolution:
    kind: str  # tenant | product | default
    tenant_slug: str | None = None
    product_key: str | None = None
    base_domain: str | None = None
    reason: str | None = None


def _strip_port(host: str) -> str:
    return host.split(":", 1)[0].lower()


def _match_base_domain(host: str, base_domains: list[str]) -> str | None:
    for base in base_domains:
        base = base.lower()
        if host == base:
            return base
        if host.endswith(f".{base}"):
            return base
    return None


def _valid_slug(slug: str) -> bool:
    if not slug:
        return False
    if len(slug) < 2 or len(slug) > 63:
        return False
    if slug[0] == "-" or slug[-1] == "-":
        return False
    for ch in slug:
        if not (ch.isalnum() or ch == "-"):
            return False
    return True


def resolve_host(host: str, *, base_domains: list[str], reserved: set[str], product_map: dict[str, str]) -> HostResolution:
    normalized = _strip_port(host)
    base_domain = _match_base_domain(normalized, base_domains)
    if not base_domain:
        return HostResolution(kind="default", reason="base_domain_not_allowed")

    if normalized == base_domain:
        return HostResolution(kind="default", base_domain=base_domain)

    subdomain = normalized[: -(len(base_domain) + 1)]
    labels = subdomain.split(".")
    if len(labels) != 1:
        return HostResolution(kind="default", base_domain=base_domain, reason="multi_label_subdomain")

    slug = labels[0].lower()
    if slug in reserved:
        return HostResolution(kind="product", base_domain=base_domain, product_key=product_map.get(slug, slug))

    if not _valid_slug(slug):
        return HostResolution(kind="default", base_domain=base_domain, reason="invalid_slug")

    return HostResolution(kind="tenant", base_domain=base_domain, tenant_slug=slug)
