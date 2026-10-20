DROP INDEX documents_siblings;
ALTER TABLE documents DROP CONSTRAINT documents_parent_not_self;
ALTER TABLE documents DROP CONSTRAINT documents_parent_scope;
ALTER TABLE documents DROP CONSTRAINT documents_collection_identity;
ALTER TABLE documents DROP COLUMN position;
ALTER TABLE documents DROP COLUMN parent_id;
ALTER TABLE collections DROP COLUMN archived_at_ms;
ALTER TABLE collections DROP COLUMN directory_version;
ALTER TABLE workspace_members DROP COLUMN version;
