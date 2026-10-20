DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM integration_imports WHERE expires_at_ms IS NULL) THEN
        RAISE EXCEPTION 'Unbounded legacy imports prevent a lossless rollback';
    END IF;
END $$;
ALTER TABLE integration_imports ALTER COLUMN expires_at_ms SET NOT NULL;
