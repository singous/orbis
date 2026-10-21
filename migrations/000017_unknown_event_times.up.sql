ALTER TABLE collection_groups ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE collections ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE documents ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE collection_groups SET is_archived=(archived_at_ms IS NOT NULL);
UPDATE collections SET is_archived=(archived_at_ms IS NOT NULL);
UPDATE documents SET is_archived=(archived_at_ms IS NOT NULL);
ALTER TABLE collection_groups ADD CONSTRAINT groups_archive_time CHECK(is_archived OR archived_at_ms IS NULL);
ALTER TABLE collections ADD CONSTRAINT collections_archive_time CHECK(is_archived OR archived_at_ms IS NULL);
ALTER TABLE documents ADD CONSTRAINT documents_archive_time CHECK(is_archived OR archived_at_ms IS NULL);
ALTER TABLE collection_groups ADD CONSTRAINT groups_default_active CHECK(NOT is_default OR NOT is_archived);
DO $$ DECLARE existing_name TEXT; BEGIN
    SELECT conname INTO STRICT existing_name FROM pg_constraint
    WHERE conrelid='document_comments'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%is_resolved%'
      AND pg_get_constraintdef(oid) LIKE '%resolved_at_ms%';
    EXECUTE format('ALTER TABLE document_comments DROP CONSTRAINT %I',existing_name);
END $$;
ALTER TABLE document_comments ADD CONSTRAINT comments_resolution_time CHECK(is_resolved OR resolved_at_ms IS NULL);
