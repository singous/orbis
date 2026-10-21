-- Store renderer text beside each immutable block revision, never private editor metadata.
CREATE FUNCTION orbis_block_text(payload JSONB) RETURNS TEXT
LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
    SELECT concat_ws(E'\n',
        (SELECT string_agg(run->>'text', '' ORDER BY ordinal)
         FROM jsonb_array_elements(coalesce(payload->'content', '[]'::jsonb)) WITH ORDINALITY AS runs(run, ordinal)),
        nullif(payload->'props'->>'title', ''),
        nullif(payload->'props'->>'caption', ''),
        nullif(payload->'props'->>'name', ''),
        nullif(payload->'props'->>'alt', ''),
        (SELECT string_agg(cell_text, E'\n' ORDER BY row_number, cell_number)
         FROM jsonb_array_elements(coalesce(payload->'table'->'rows', '[]'::jsonb)) WITH ORDINALITY AS rows(row, row_number)
         CROSS JOIN LATERAL jsonb_array_elements(row) WITH ORDINALITY AS cells(cell, cell_number)
         CROSS JOIN LATERAL (
             SELECT string_agg(run->>'text', '' ORDER BY ordinal) AS cell_text
             FROM jsonb_array_elements(cell->'content') WITH ORDINALITY AS runs(run, ordinal)
         ) AS text)
    )
$$;
ALTER TABLE document_block_versions ADD COLUMN plain_text TEXT
    GENERATED ALWAYS AS (orbis_block_text(payload)) STORED;
CREATE INDEX document_block_tree_current ON document_block_versions(document_id, parent_id, position, block_id)
    WHERE valid_to IS NULL;
CREATE INDEX assets_search_scope ON assets(workspace_id, updated_at_ms DESC, id)
    WHERE kind = 'file' AND state = 'ready';

CREATE TABLE document_imports (
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    collection_id UUID NOT NULL,
    operation_id UUID NOT NULL,
    actor_id UUID NOT NULL REFERENCES users(id),
    request_hash TEXT NOT NULL,
    document_id UUID NOT NULL,
    result JSONB NOT NULL,
    created_at_ms BIGINT NOT NULL,
    PRIMARY KEY (workspace_id, collection_id, operation_id),
    FOREIGN KEY (workspace_id, collection_id) REFERENCES collections(workspace_id, id),
    FOREIGN KEY (workspace_id, document_id) REFERENCES documents(workspace_id, id)
);
