-- content_version still identifies the binary checkpoint. The document head
-- is content_version + pending_update_count and its updates live in the
-- existing durable journal. Existing snapshots start with no pending updates.
ALTER TABLE document_collaboration_states
    ADD COLUMN pending_update_count BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN pending_update_bytes BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN pending_since_ms BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN snapshot_lease_until_ms BIGINT NOT NULL DEFAULT 0,
    ADD CONSTRAINT document_collaboration_checkpoint_pending CHECK (
        pending_update_count >= 0 AND pending_update_bytes >= 0 AND pending_since_ms >= 0
        AND snapshot_lease_until_ms >= 0
        AND (
            (pending_update_count = 0 AND pending_update_bytes = 0 AND pending_since_ms = 0 AND snapshot_lease_until_ms = 0)
            OR (pending_update_count > 0 AND pending_update_bytes > 0)
        )
    );

CREATE INDEX document_collaboration_checkpoints_pending
    ON document_collaboration_states (pending_since_ms, document_id)
    WHERE pending_update_count > 0;
