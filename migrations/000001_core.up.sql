CREATE TABLE installation (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    initialized_at_ms BIGINT
);
INSERT INTO installation (singleton) VALUES (TRUE);

CREATE TABLE users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL
);

CREATE TABLE sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE,
    expires_at_ms BIGINT NOT NULL,
    revoked_at_ms BIGINT,
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL,
    CHECK (expires_at_ms > created_at_ms)
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE workspaces (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL
);

CREATE TABLE workspace_members (
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    user_id UUID NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
);
CREATE UNIQUE INDEX workspace_single_owner ON workspace_members(workspace_id) WHERE role = 'owner';
CREATE INDEX workspace_members_user ON workspace_members(user_id, workspace_id);

CREATE TABLE collections (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL,
    UNIQUE (workspace_id, id)
);
CREATE INDEX collections_workspace ON collections(workspace_id, created_at_ms DESC, id DESC);

CREATE TABLE documents (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    collection_id UUID NOT NULL,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
    content_version BIGINT NOT NULL CHECK (content_version >= 1),
    archived_at_ms BIGINT,
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL,
    FOREIGN KEY (workspace_id, collection_id) REFERENCES collections(workspace_id, id),
    UNIQUE (workspace_id, id)
);
CREATE INDEX documents_collection ON documents(workspace_id, collection_id, updated_at_ms DESC, id DESC);

CREATE TABLE document_revisions (
    document_id UUID NOT NULL REFERENCES documents(id),
    version BIGINT NOT NULL CHECK (version >= 1),
    title TEXT NOT NULL,
    author_id UUID NOT NULL REFERENCES users(id),
    restored_from_version BIGINT,
    created_at_ms BIGINT NOT NULL,
    PRIMARY KEY (document_id, version)
);

CREATE TABLE document_block_versions (
    document_id UUID NOT NULL REFERENCES documents(id),
    block_id UUID NOT NULL,
    parent_id UUID,
    position INTEGER NOT NULL CHECK (position >= 0),
    payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    valid_from BIGINT NOT NULL,
    valid_to BIGINT,
    PRIMARY KEY (document_id, block_id, valid_from),
    FOREIGN KEY (document_id, valid_from) REFERENCES document_revisions(document_id, version),
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE UNIQUE INDEX document_block_active ON document_block_versions(document_id, block_id) WHERE valid_to IS NULL;
CREATE INDEX document_block_revision ON document_block_versions(document_id, valid_from, valid_to, block_id);

CREATE TABLE document_operations (
    document_id UUID NOT NULL REFERENCES documents(id),
    operation_id UUID NOT NULL,
    actor_id UUID NOT NULL REFERENCES users(id),
    request_hash TEXT NOT NULL,
    result_version BIGINT NOT NULL,
    created_at_ms BIGINT NOT NULL,
    PRIMARY KEY (document_id, operation_id),
    FOREIGN KEY (document_id, result_version) REFERENCES document_revisions(document_id, version)
);
