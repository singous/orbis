-- Preserves content/history, but removes command receipt details and size caches.
ALTER TABLE document_operations DROP COLUMN result;
ALTER TABLE document_block_versions DROP CONSTRAINT document_block_payload_cache;
ALTER TABLE document_block_versions DROP COLUMN payload_digest;
ALTER TABLE document_block_versions DROP COLUMN payload_bytes;
