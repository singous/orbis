CREATE TABLE integration_imports (
    id UUID PRIMARY KEY,
    token_id UUID NOT NULL,
    operation_id UUID NOT NULL,
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    collection_id UUID NOT NULL,
    parent_id UUID,
    title TEXT NOT NULL,
    expected_sha256 TEXT NOT NULL CHECK(length(expected_sha256)=64),
    size_bytes BIGINT NOT NULL CHECK(size_bytes BETWEEN 0 AND 33554432),
    received_bytes BIGINT NOT NULL DEFAULT 0 CHECK(received_bytes BETWEEN 0 AND size_bytes),
    state TEXT NOT NULL CHECK(state IN ('uploading','queued','processing','completed','failed')),
    processing_id UUID,
    error_code TEXT,
    purged_at_ms BIGINT,
    result JSONB,
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL,
    expires_at_ms BIGINT NOT NULL,
    UNIQUE(token_id,operation_id),
    FOREIGN KEY(workspace_id,collection_id) REFERENCES collections(workspace_id,id),
    FOREIGN KEY(token_id,operation_id) REFERENCES integration_operations(token_id,operation_id),
    CHECK((state='completed')=(result IS NOT NULL)),
    CHECK((state='failed')=(error_code IS NOT NULL))
);
CREATE TABLE integration_import_chunks (
    import_id UUID NOT NULL REFERENCES integration_imports(id),
    offset_bytes BIGINT NOT NULL CHECK(offset_bytes>=0),
    size_bytes BIGINT NOT NULL CHECK(size_bytes BETWEEN 1 AND 262144),
    sha256 TEXT NOT NULL CHECK(length(sha256)=64),
    storage_key TEXT NOT NULL UNIQUE,
    PRIMARY KEY(import_id,offset_bytes)
);
CREATE TABLE integration_import_outbox (
    import_id UUID PRIMARY KEY REFERENCES integration_imports(id),
    dispatched_at_ms BIGINT,
    checked_at_ms BIGINT NOT NULL DEFAULT 0,
    created_at_ms BIGINT NOT NULL
);
CREATE INDEX integration_import_pending ON integration_imports(token_id,state);
