-- A destructive downgrade is allowed only for an empty feature installation.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM boards) OR EXISTS (SELECT 1 FROM integration_operations WHERE kind IN ('board.create','board.commands')) THEN
        RAISE EXCEPTION 'Native boards contain data; preserve them and use a compatible application rollback';
    END IF;
END $$;
ALTER TABLE documents DROP CONSTRAINT documents_single_primary_resource;
ALTER TABLE documents DROP CONSTRAINT documents_board_scope;
DROP INDEX documents_primary_board;
ALTER TABLE documents DROP COLUMN board_id;
DROP TABLE board_operations;
DROP TABLE board_element_versions;
DROP TABLE board_elements;
DROP TABLE board_revisions;
DROP TABLE board_pages;
DROP TABLE boards;

ALTER TABLE integration_operations DROP CONSTRAINT integration_operations_kind_check;
ALTER TABLE integration_operations ADD CONSTRAINT integration_operations_kind_check CHECK (kind IN ('create','commands','upload','import'));
