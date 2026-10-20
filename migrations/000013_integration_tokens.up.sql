CREATE TABLE integration_tokens (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users(id),
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    name TEXT NOT NULL CHECK(char_length(name) BETWEEN 1 AND 120),
    permissions JSONB NOT NULL,
    collection_id UUID,
    document_id UUID,
    secret_hash TEXT NOT NULL UNIQUE CHECK(length(secret_hash)=64),
    secret_prefix TEXT NOT NULL,
    version BIGINT NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991),
    expires_at_ms BIGINT,
    revoked_at_ms BIGINT,
    last_used_at_ms BIGINT,
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL,
    FOREIGN KEY(workspace_id,collection_id) REFERENCES collections(workspace_id,id),
    FOREIGN KEY(workspace_id,document_id) REFERENCES documents(workspace_id,id),
    CHECK(document_id IS NULL OR collection_id IS NOT NULL),
    CHECK(expires_at_ms IS NULL OR expires_at_ms>created_at_ms)
);
CREATE INDEX integration_tokens_owner_page ON integration_tokens(owner_id,workspace_id,created_at_ms DESC,id);
CREATE TABLE integration_operations (
    token_id UUID NOT NULL REFERENCES integration_tokens(id),
    operation_id UUID NOT NULL,
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    document_id UUID,
    kind TEXT NOT NULL CHECK(kind IN ('create','commands','upload','import')),
    request_hash TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('pending','completed')),
    result JSONB,
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL,
    PRIMARY KEY(token_id,operation_id),
    FOREIGN KEY(workspace_id,document_id) REFERENCES documents(workspace_id,id),
    CHECK((state='completed')=(result IS NOT NULL))
);
CREATE TABLE integration_attachments (
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    document_id UUID NOT NULL,
    asset_id UUID NOT NULL REFERENCES assets(id),
    created_at_ms BIGINT NOT NULL,
    PRIMARY KEY(document_id,asset_id),
    FOREIGN KEY(workspace_id,document_id) REFERENCES documents(workspace_id,id)
);
