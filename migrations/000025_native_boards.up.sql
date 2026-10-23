CREATE TABLE boards (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    document_id UUID NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    revision BIGINT NOT NULL CHECK (revision > 0),
    creation_actor UUID NOT NULL,
    creation_operation UUID NOT NULL,
    creation_hash TEXT NOT NULL,
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL,
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, creation_actor, creation_operation),
    FOREIGN KEY (workspace_id, document_id) REFERENCES documents(workspace_id, id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE documents ADD COLUMN board_id UUID;
ALTER TABLE documents ADD CONSTRAINT documents_board_scope
    FOREIGN KEY (workspace_id, board_id) REFERENCES boards(workspace_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE documents ADD CONSTRAINT documents_single_primary_resource CHECK (sheet_id IS NULL OR board_id IS NULL);
CREATE UNIQUE INDEX documents_primary_board ON documents(board_id) WHERE board_id IS NOT NULL;
CREATE INDEX boards_owner ON boards(workspace_id, document_id);

CREATE TABLE board_pages (
    board_id UUID NOT NULL REFERENCES boards(id),
    id UUID NOT NULL,
    payload JSONB NOT NULL,
    element_count INTEGER NOT NULL DEFAULT 0 CHECK (element_count >= 0 AND element_count <= 10000),
    element_bytes BIGINT NOT NULL DEFAULT 0 CHECK (element_bytes >= 0 AND element_bytes <= 20971520),
    PRIMARY KEY (board_id, id)
);
CREATE TABLE board_revisions (
    board_id UUID NOT NULL REFERENCES boards(id),
    revision BIGINT NOT NULL,
    title TEXT NOT NULL,
    pages JSONB NOT NULL,
    actor_id UUID,
    created_at_ms BIGINT NOT NULL,
    PRIMARY KEY (board_id, revision)
);
CREATE TABLE board_elements (
    board_id UUID NOT NULL,
    id UUID NOT NULL,
    page_id UUID NOT NULL,
    parent_id UUID,
    start_id UUID,
    end_id UUID,
    asset_id UUID REFERENCES assets(id),
    payload JSONB NOT NULL,
    payload_bytes INTEGER NOT NULL CHECK (payload_bytes > 0),
    PRIMARY KEY (board_id, id),
    FOREIGN KEY (board_id, page_id) REFERENCES board_pages(board_id, id)
);
CREATE INDEX board_elements_page ON board_elements(board_id, page_id, id);
CREATE INDEX board_elements_parent ON board_elements(board_id, parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX board_elements_start ON board_elements(board_id, start_id) WHERE start_id IS NOT NULL;
CREATE INDEX board_elements_end ON board_elements(board_id, end_id) WHERE end_id IS NOT NULL;
CREATE TABLE board_element_versions (
    board_id UUID NOT NULL,
    id UUID NOT NULL,
    page_id UUID NOT NULL,
    valid_from BIGINT NOT NULL,
    valid_to BIGINT,
    asset_id UUID REFERENCES assets(id),
    payload JSONB NOT NULL,
    PRIMARY KEY (board_id, id, valid_from),
    FOREIGN KEY (board_id, valid_from) REFERENCES board_revisions(board_id, revision) DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (board_id, valid_to) REFERENCES board_revisions(board_id, revision) DEFERRABLE INITIALLY DEFERRED,
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE UNIQUE INDEX board_elements_open_version ON board_element_versions(board_id, id) WHERE valid_to IS NULL;
CREATE INDEX board_elements_snapshot ON board_element_versions(board_id, page_id, id, valid_from);
CREATE TABLE board_operations (
    board_id UUID NOT NULL REFERENCES boards(id),
    operation_id UUID NOT NULL,
    actor_id UUID NOT NULL,
    request_hash TEXT NOT NULL,
    revision BIGINT NOT NULL,
    result JSONB NOT NULL,
    created_at_ms BIGINT NOT NULL,
    PRIMARY KEY (board_id, operation_id),
    UNIQUE (board_id, revision),
    FOREIGN KEY (board_id, revision) REFERENCES board_revisions(board_id, revision) DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE integration_operations DROP CONSTRAINT integration_operations_kind_check;
ALTER TABLE integration_operations ADD CONSTRAINT integration_operations_kind_check CHECK (kind IN ('create','commands','upload','import','board.create','board.commands'));
