-- Nullable caches allow existing immutable payloads to be upgraded lazily under the document write lock.
ALTER TABLE document_block_versions ADD COLUMN payload_bytes INTEGER CHECK(payload_bytes >= 0);
ALTER TABLE document_block_versions ADD COLUMN payload_digest TEXT CHECK(payload_digest IS NULL OR length(payload_digest)=64);
ALTER TABLE document_block_versions ADD CONSTRAINT document_block_payload_cache
    CHECK ((payload_bytes IS NULL) = (payload_digest IS NULL));
ALTER TABLE document_operations ADD COLUMN result JSONB;
