CREATE TABLE document_shares (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    collection_id UUID NOT NULL,
    root_document_id UUID,
    created_by UUID NOT NULL REFERENCES users(id),
    token_digest TEXT NOT NULL UNIQUE CHECK (length(token_digest)=64),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740991),
    expires_at_ms BIGINT,
    revoked_at_ms BIGINT,
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL,
    FOREIGN KEY(workspace_id,collection_id) REFERENCES collections(workspace_id,id),
    FOREIGN KEY(workspace_id,collection_id,root_document_id) REFERENCES documents(workspace_id,collection_id,id),
    CHECK (expires_at_ms IS NULL OR expires_at_ms>created_at_ms)
);
CREATE INDEX document_shares_scope ON document_shares(workspace_id,collection_id,root_document_id,created_at_ms DESC,id);
