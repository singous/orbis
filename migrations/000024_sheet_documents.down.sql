ALTER TABLE documents DROP CONSTRAINT documents_sheet_scope;
ALTER TABLE sheets DROP CONSTRAINT sheets_document_scope;
DROP INDEX documents_primary_sheet;
DROP INDEX sheets_document;
ALTER TABLE documents DROP COLUMN sheet_id;
ALTER TABLE sheets DROP COLUMN document_id;
