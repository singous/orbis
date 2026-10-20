DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM document_operations WHERE actor_id IS NULL) THEN
        RAISE EXCEPTION 'Unknown historical receipt actors prevent a lossless rollback';
    END IF;
END $$;
ALTER TABLE document_operations ALTER COLUMN actor_id SET NOT NULL;
