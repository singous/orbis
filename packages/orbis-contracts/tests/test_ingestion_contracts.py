from __future__ import annotations

from orbis_contracts.ingestion import (
    IngestionChunkV1,
    IngestionProcessedV1,
    IngestionRequestedV1,
)
from orbis_contracts.topics import INGESTION_PROCESSED_TOPIC, INGESTION_REQUESTED_TOPIC
from uuid6 import uuid7


def test_ingestion_requested_contract_round_trips_uuid_and_timestamp() -> None:
    payload = IngestionRequestedV1(
        event_id=uuid7(),
        occurred_at_ms=1_800_000_000_000,
        tenant_id=uuid7(),
        workspace_id=uuid7(),
        knowledge_base_id=uuid7(),
        source_type="file",
        source_id=uuid7(),
        source_version_id=uuid7(),
        source_hash="a" * 64,
        processing_job_id=uuid7(),
        storage_key="sources/a.md",
        filename="a.md",
        mime_type="text/markdown",
    )

    assert (
        IngestionRequestedV1.model_validate_json(payload.model_dump_json()) == payload
    )
    assert payload.schema_version == 1
    assert INGESTION_REQUESTED_TOPIC == "orbis.ingestion.requested.v1"


def test_ingestion_processed_contract_preserves_chunks_and_embedding_identity() -> None:
    requested = IngestionRequestedV1(
        event_id=uuid7(),
        occurred_at_ms=1_800_000_000_000,
        tenant_id=uuid7(),
        workspace_id=uuid7(),
        knowledge_base_id=uuid7(),
        source_type="note_snapshot",
        source_id=uuid7(),
        source_version_id=uuid7(),
        source_hash="b" * 64,
        processing_job_id=uuid7(),
        storage_key="snapshots/note.json",
        filename="note.json",
        mime_type="application/vnd.orbis.note+json",
    )
    payload = IngestionProcessedV1(
        event_id=uuid7(),
        occurred_at_ms=1_800_000_000_100,
        tenant_id=requested.tenant_id,
        workspace_id=requested.workspace_id,
        knowledge_base_id=requested.knowledge_base_id,
        source_type=requested.source_type,
        source_id=requested.source_id,
        source_version_id=requested.source_version_id,
        source_hash=requested.source_hash,
        processing_job_id=requested.processing_job_id,
        embedding_configuration_id="global-e5-small-v2",
        chunks=[
            IngestionChunkV1(
                chunk_id=uuid7(),
                ordinal=0,
                text="Orbis knowledge",
                metadata={"heading": "Overview"},
                vector=[0.1, 0.2, 0.3],
            )
        ],
    )

    restored = IngestionProcessedV1.model_validate_json(payload.model_dump_json())
    assert restored == payload
    assert restored.chunks[0].metadata == {"heading": "Overview"}
    assert INGESTION_PROCESSED_TOPIC == "orbis.ingestion.processed.v1"
