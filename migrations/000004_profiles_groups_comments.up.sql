ALTER TABLE users ALTER COLUMN display_name DROP NOT NULL;
ALTER TABLE users ADD COLUMN bio TEXT CHECK (char_length(bio) <= 500);
ALTER TABLE users ADD COLUMN profile_version BIGINT NOT NULL DEFAULT 1
    CHECK (profile_version BETWEEN 1 AND 9007199254740991);

CREATE TABLE collection_groups (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740991),
    archived_at_ms BIGINT,
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL,
    UNIQUE (workspace_id, id),
    CHECK (NOT is_default OR archived_at_ms IS NULL)
);
CREATE UNIQUE INDEX collection_groups_default ON collection_groups(workspace_id) WHERE is_default;
CREATE INDEX collection_groups_order ON collection_groups(workspace_id, sort_order, id);
INSERT INTO collection_groups (id, workspace_id, name, is_default, created_at_ms, updated_at_ms)
SELECT gen_random_uuid(), id, '默认分组', TRUE, created_at_ms, updated_at_ms FROM workspaces;

ALTER TABLE collections ADD COLUMN group_id UUID;
UPDATE collections c SET group_id = g.id FROM collection_groups g
    WHERE g.workspace_id = c.workspace_id AND g.is_default;
ALTER TABLE collections ALTER COLUMN group_id SET NOT NULL;
ALTER TABLE collections ADD CONSTRAINT collections_group_scope
    FOREIGN KEY (workspace_id, group_id) REFERENCES collection_groups(workspace_id, id);
ALTER TABLE collections ADD COLUMN metadata_version BIGINT NOT NULL DEFAULT 1
    CHECK (metadata_version BETWEEN 1 AND 9007199254740991);
ALTER TABLE collections ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0);
CREATE INDEX collections_group_order ON collections(workspace_id, group_id, sort_order, id);

CREATE TABLE document_comments (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    document_id UUID NOT NULL,
    author_id UUID NOT NULL REFERENCES users(id),
    parent_id UUID,
    body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000),
    is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at_ms BIGINT,
    version BIGINT NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740991),
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL,
    FOREIGN KEY (workspace_id, document_id) REFERENCES documents(workspace_id, id),
    UNIQUE (workspace_id, document_id, id),
    FOREIGN KEY (workspace_id, document_id, parent_id) REFERENCES document_comments(workspace_id, document_id, id),
    CHECK (parent_id IS NULL OR parent_id <> id),
    CHECK (is_resolved = (resolved_at_ms IS NOT NULL))
);
CREATE INDEX document_comments_order ON document_comments(workspace_id, document_id, created_at_ms, id);
