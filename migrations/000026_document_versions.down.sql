DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM document_versions)
        OR EXISTS (SELECT 1 FROM document_version_operations)
        OR EXISTS (SELECT 1 FROM integration_operations WHERE kind IN ('version-create','version-edit','version-restore')) THEN
        RAISE EXCEPTION 'Version history and receipts must be retained; downgrade requires a reviewed preservation plan';
    END IF;
END $$;
DROP TRIGGER document_version_activity_changed ON documents;
DROP FUNCTION track_document_version_activity();
DROP TABLE document_version_activity;
DROP TABLE document_version_operations;
DROP TABLE document_version_blocks;
DROP TABLE document_version_tables;
DROP TABLE document_version_assets;
DROP TABLE document_versions;
DROP INDEX document_block_version_closed;
ALTER TABLE integration_operations DROP CONSTRAINT integration_operations_kind_check;
ALTER TABLE integration_operations ADD CONSTRAINT integration_operations_kind_check
    CHECK(kind IN ('create','commands','upload','import','board.create','board.commands'));
