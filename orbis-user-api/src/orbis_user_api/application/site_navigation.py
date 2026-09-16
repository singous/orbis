from __future__ import annotations

import re
from copy import deepcopy
from dataclasses import dataclass

from orbis_user_api.application.site_errors import SiteError
from orbis_user_api.domain.site import MAX_PAGE_SLUG_LENGTH


@dataclass
class PagePaths:
    """Allocate paths without mutating persisted configuration during preview."""

    registry: dict

    def __post_init__(self) -> None:
        self.registry = deepcopy(self.registry)
        self.owners: dict[str, str] = {}
        for identity, entry in self.registry.items():
            for path in [entry["slug"], *entry.get("aliases", [])]:
                self.reserve(path, identity)

    def reserve(self, path: str, identity: str) -> None:
        owner = self.owners.get(path)
        if owner is not None and owner != identity:
            raise SiteError("SITE_PAGE_PATH_CONFLICT", f"页面路径已被使用：{path}", 422)
        self.owners[path] = identity

    def assign(self, identity: str, title: str, explicit: str | None = None) -> str:
        previous = self.registry.get(identity)
        path = explicit or (previous["slug"] if previous else None)
        if path is None:
            stem = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
            stem = stem[:MAX_PAGE_SLUG_LENGTH].rstrip("-") or "page"
            path, counter = stem, 1
            while path in self.owners and self.owners[path] != identity:
                counter += 1
                suffix = f"-{counter}"
                path = stem[: MAX_PAGE_SLUG_LENGTH - len(suffix)].rstrip("-") + suffix
        self.reserve(path, identity)
        aliases = set(previous.get("aliases", [])) if previous else set()
        if previous and previous["slug"] != path:
            aliases.add(previous["slug"])
        aliases.discard(path)
        self.registry[identity] = {"slug": path, "aliases": sorted(aliases)}
        return path

    def redirects(self, selected: set[str]) -> dict[str, str]:
        return {
            alias: entry["slug"]
            for identity, entry in self.registry.items()
            if identity in selected
            for alias in entry.get("aliases", [])
        }
