-- Stop writers and let the checkpoint worker drain before running this migration.
-- The previous schema requires every checkpoint to cover the latest commit.
LOCK TABLE document_collaboration_states IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM document_collaboration_states s
        JOIN documents d ON d.id = s.document_id
        WHERE s.pending_update_count > 0 OR s.content_version <> d.content_version
    ) THEN
        RAISE EXCEPTION 'collaboration checkpoints have pending updates; drain them before downgrading';
    END IF;
END $$;

DROP INDEX document_collaboration_checkpoints_pending;
ALTER TABLE document_collaboration_states
    DROP CONSTRAINT document_collaboration_checkpoint_pending,
    DROP COLUMN snapshot_lease_until_ms,
    DROP COLUMN pending_since_ms,
    DROP COLUMN pending_update_bytes,
    DROP COLUMN pending_update_count;
