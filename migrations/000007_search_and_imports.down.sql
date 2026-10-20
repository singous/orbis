-- Imported documents remain; removing receipts loses safe retry history.
DROP TABLE document_imports;
DROP INDEX assets_search_scope;
DROP INDEX document_block_tree_current;
ALTER TABLE document_block_versions DROP COLUMN plain_text;
DROP FUNCTION orbis_block_text(JSONB);
