-- Refuse rollback while it would discard personal records or private uploads.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM quick_notes) OR EXISTS (SELECT 1 FROM quick_note_tags)
       OR EXISTS (SELECT 1 FROM assets WHERE kind = 'private_file') THEN
        RAISE EXCEPTION 'Export and explicitly remove quick note data before rolling back migration 27';
    END IF;
END $$;
DROP TABLE quick_note_operations;
DROP TABLE quick_note_tag_links;
DROP TABLE quick_note_tags;
DROP TABLE quick_notes;
ALTER TABLE assets DROP CONSTRAINT assets_kind_check;
ALTER TABLE assets ADD CONSTRAINT assets_kind_check CHECK (kind IN ('file', 'avatar'));
ALTER TABLE assets DROP CONSTRAINT assets_check;
ALTER TABLE assets ADD CONSTRAINT assets_check CHECK ((kind = 'file') = (workspace_id IS NOT NULL));
