from __future__ import annotations

from typing import Protocol
from uuid import UUID

import httpx

from orbis_user_api.core.settings import Settings


class IndexCleanupGateway(Protocol):
    async def remove_knowledge_base(
        self, *, tenant_id: UUID, workspace_id: UUID, knowledge_base_id: UUID
    ) -> None: ...

    async def remove_source(
        self,
        *,
        tenant_id: UUID,
        workspace_id: UUID,
        knowledge_base_id: UUID,
        source_id: UUID,
    ) -> None: ...


class NoOpIndexCleanupGateway:
    async def remove_knowledge_base(self, **scope: UUID) -> None:
        del scope

    async def remove_source(self, **scope: UUID) -> None:
        del scope


class HttpIndexCleanupGateway:
    def __init__(self, base_url: str) -> None:
        self._base_url = base_url.rstrip("/")

    async def remove_knowledge_base(
        self, *, tenant_id: UUID, workspace_id: UUID, knowledge_base_id: UUID
    ) -> None:
        async with httpx.AsyncClient(base_url=self._base_url) as client:
            response = await client.delete(
                f"/internal/indexes/knowledge-bases/{knowledge_base_id}",
                params={"tenant_id": str(tenant_id), "workspace_id": str(workspace_id)},
            )
            response.raise_for_status()

    async def remove_source(
        self,
        *,
        tenant_id: UUID,
        workspace_id: UUID,
        knowledge_base_id: UUID,
        source_id: UUID,
    ) -> None:
        async with httpx.AsyncClient(base_url=self._base_url) as client:
            response = await client.delete(
                f"/internal/indexes/knowledge-bases/{knowledge_base_id}/sources/{source_id}",
                params={"tenant_id": str(tenant_id), "workspace_id": str(workspace_id)},
            )
            response.raise_for_status()


def create_index_cleanup_gateway(settings: Settings) -> IndexCleanupGateway:
    if settings.index_cleanup_mode == "http":
        return HttpIndexCleanupGateway(settings.indexer_base_url)
    return NoOpIndexCleanupGateway()
