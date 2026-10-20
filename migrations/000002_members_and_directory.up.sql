ALTER TABLE workspace_members ADD COLUMN version BIGINT NOT NULL DEFAULT 1
    CHECK (version BETWEEN 1 AND 9007199254740991);

ALTER TABLE collections ADD COLUMN directory_version BIGINT NOT NULL DEFAULT 1
    CHECK (directory_version BETWEEN 1 AND 9007199254740991);
ALTER TABLE collections ADD COLUMN archived_at_ms BIGINT;

ALTER TABLE documents ADD COLUMN parent_id UUID;
ALTER TABLE documents ADD COLUMN position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0);
WITH positions AS (
    SELECT id, (row_number() OVER (PARTITION BY collection_id ORDER BY created_at_ms, id) - 1)::INTEGER AS position
    FROM documents
)
UPDATE documents SET position = positions.position FROM positions WHERE documents.id = positions.id;

ALTER TABLE documents ADD CONSTRAINT documents_collection_identity UNIQUE (workspace_id, collection_id, id);
ALTER TABLE documents ADD CONSTRAINT documents_parent_scope
    FOREIGN KEY (workspace_id, collection_id, parent_id) REFERENCES documents(workspace_id, collection_id, id);
ALTER TABLE documents ADD CONSTRAINT documents_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id);
CREATE INDEX documents_siblings ON documents(workspace_id, collection_id, parent_id, position, id)
    WHERE archived_at_ms IS NULL;
