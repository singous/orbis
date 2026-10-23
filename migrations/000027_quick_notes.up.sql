CREATE TABLE quick_notes (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    owner_id UUID NOT NULL REFERENCES users(id),
    version BIGINT NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
    blocks JSONB NOT NULL,
    crdt_state BYTEA NOT NULL,
    search_text TEXT NOT NULL,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL,
    deleted_at_ms BIGINT,
    UNIQUE (workspace_id, owner_id, id)
);
CREATE INDEX quick_notes_browse ON quick_notes(workspace_id, owner_id, is_pinned DESC, updated_at_ms DESC, id DESC);

CREATE TABLE quick_note_tags (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    owner_id UUID NOT NULL REFERENCES users(id),
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
    version BIGINT NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL,
    UNIQUE (workspace_id, owner_id, id)
);
CREATE UNIQUE INDEX quick_note_tag_names ON quick_note_tags(workspace_id, owner_id, lower(name));
CREATE TABLE quick_note_tag_links (
    workspace_id UUID NOT NULL,
    owner_id UUID NOT NULL,
    note_id UUID NOT NULL,
    tag_id UUID NOT NULL,
    PRIMARY KEY (note_id, tag_id),
    FOREIGN KEY (workspace_id, owner_id, note_id) REFERENCES quick_notes(workspace_id, owner_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, owner_id, tag_id) REFERENCES quick_note_tags(workspace_id, owner_id, id) ON DELETE CASCADE
);
CREATE INDEX quick_note_tags_lookup ON quick_note_tag_links(tag_id, note_id);
CREATE TABLE quick_note_operations (
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    owner_id UUID NOT NULL REFERENCES users(id),
    operation_id UUID NOT NULL,
    request_hash TEXT NOT NULL,
    result JSONB NOT NULL,
    created_at_ms BIGINT NOT NULL,
    PRIMARY KEY (workspace_id, owner_id, operation_id)
);

-- Private uploads never match the existing workspace file delivery paths.
ALTER TABLE assets DROP CONSTRAINT assets_kind_check;
ALTER TABLE assets ADD CONSTRAINT assets_kind_check CHECK (kind IN ('file', 'avatar', 'private_file'));
ALTER TABLE assets DROP CONSTRAINT assets_check;
ALTER TABLE assets ADD CONSTRAINT assets_check CHECK ((kind IN ('file', 'private_file')) = (workspace_id IS NOT NULL));
