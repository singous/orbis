ALTER TABLE documents ADD COLUMN sheet_id UUID;
ALTER TABLE sheets ADD COLUMN document_id UUID;

-- Existing independent tables become ordinary directory entries without changing their records.
UPDATE sheets SET document_id = gen_random_uuid();
INSERT INTO documents (id, workspace_id, collection_id, title, content_version, created_at_ms, updated_at_ms, position, sheet_id)
SELECT s.document_id, s.workspace_id, s.collection_id, s.title, 1, s.created_at_ms, s.updated_at_ms,
       (COALESCE((SELECT max(d.position) FROM documents d WHERE d.collection_id=s.collection_id AND d.parent_id IS NULL), -1)
        + row_number() OVER (PARTITION BY s.collection_id ORDER BY s.created_at_ms,s.id))::integer, s.id
FROM sheets s;
INSERT INTO document_revisions (document_id, version, title, author_id, created_at_ms)
SELECT document_id, 1, title, NULL, created_at_ms FROM sheets;
INSERT INTO document_block_versions (document_id, block_id, parent_id, position, payload, valid_from)
SELECT document_id, gen_random_uuid(), NULL, 0,
       jsonb_build_object('type','data_table','props',jsonb_build_object('sheet_id',id::text,'sheet_view_id',definition->'views'->0->>'id'),'content','[]'::jsonb), 1
FROM sheets;
UPDATE collections SET directory_version=directory_version+1 WHERE id IN (SELECT collection_id FROM sheets);

ALTER TABLE sheets ALTER COLUMN document_id SET NOT NULL;
ALTER TABLE sheets ADD CONSTRAINT sheets_document_scope FOREIGN KEY(workspace_id,document_id) REFERENCES documents(workspace_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE documents ADD CONSTRAINT documents_sheet_scope FOREIGN KEY(workspace_id,sheet_id) REFERENCES sheets(workspace_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX documents_primary_sheet ON documents(sheet_id) WHERE sheet_id IS NOT NULL;
CREATE INDEX sheets_document ON sheets(document_id,id);
