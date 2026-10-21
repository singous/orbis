CREATE TABLE assets (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users(id),
    workspace_id UUID REFERENCES workspaces(id),
    kind TEXT NOT NULL CHECK (kind IN ('file', 'avatar')),
    state TEXT NOT NULL CHECK (state IN ('staging', 'ready', 'obsolete', 'abandoned', 'purged')),
    storage_key TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    media_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes BETWEEN 0 AND 9007199254740991),
    sha256 TEXT NOT NULL DEFAULT '',
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL,
    retired_at_ms BIGINT,
    UNIQUE (owner_id, id),
    CHECK ((kind = 'file') = (workspace_id IS NOT NULL)),
    CHECK (state <> 'ready' OR length(sha256) = 64),
    CHECK ((state IN ('obsolete', 'abandoned', 'purged')) = (retired_at_ms IS NOT NULL))
);
CREATE INDEX assets_owner_page ON assets(workspace_id, owner_id, created_at_ms DESC, id DESC)
    WHERE kind = 'file' AND state = 'ready';
CREATE INDEX assets_cleanup ON assets(state, updated_at_ms, id) WHERE state IN ('staging', 'obsolete', 'abandoned');
ALTER TABLE users ADD COLUMN avatar_asset_id UUID;
ALTER TABLE users ADD CONSTRAINT users_avatar_owner
    FOREIGN KEY (id, avatar_asset_id) REFERENCES assets(owner_id, id);
