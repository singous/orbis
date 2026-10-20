DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM collection_groups WHERE is_archived AND archived_at_ms IS NULL)
       OR EXISTS(SELECT 1 FROM collections WHERE is_archived AND archived_at_ms IS NULL)
       OR EXISTS(SELECT 1 FROM documents WHERE is_archived AND archived_at_ms IS NULL)
       OR EXISTS(SELECT 1 FROM document_comments WHERE is_resolved AND resolved_at_ms IS NULL) THEN
        RAISE EXCEPTION 'Unknown historical event times prevent a lossless rollback';
    END IF;
END $$;
ALTER TABLE document_comments DROP CONSTRAINT comments_resolution_time;
ALTER TABLE document_comments ADD CONSTRAINT comments_resolution_time CHECK(is_resolved=(resolved_at_ms IS NOT NULL));
ALTER TABLE collection_groups DROP CONSTRAINT groups_default_active;
ALTER TABLE collection_groups DROP CONSTRAINT groups_archive_time;
ALTER TABLE collections DROP CONSTRAINT collections_archive_time;
ALTER TABLE documents DROP CONSTRAINT documents_archive_time;
ALTER TABLE collection_groups DROP COLUMN is_archived;
ALTER TABLE collections DROP COLUMN is_archived;
ALTER TABLE documents DROP COLUMN is_archived;
