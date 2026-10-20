DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM document_revisions WHERE author_id IS NULL) THEN
        RAISE EXCEPTION 'Anonymous historical authors prevent a lossless rollback';
    END IF;
END $$;
ALTER TABLE document_revisions ALTER COLUMN author_id SET NOT NULL;
ALTER TABLE document_revisions DROP COLUMN author_name;
ALTER TABLE document_revisions DROP COLUMN title_recorded;
