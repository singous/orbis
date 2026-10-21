-- Binary CRDT identity and native block projections commit under the document row lock.
CREATE TABLE document_collaboration_states (
    document_id UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    epoch UUID NOT NULL,
    content_version BIGINT NOT NULL CHECK (content_version > 0),
    state BYTEA NOT NULL CHECK (octet_length(state) BETWEEN 1 AND 33554432),
    state_vector BYTEA NOT NULL,
    updated_at_ms BIGINT NOT NULL
);
CREATE TABLE document_collaboration_updates (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    operation_id UUID NOT NULL,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    content_version BIGINT NOT NULL CHECK (content_version > 0),
    epoch UUID NOT NULL,
    update_data BYTEA NOT NULL,
    created_at_ms BIGINT NOT NULL,
    PRIMARY KEY (document_id, operation_id)
);
CREATE INDEX document_collaboration_updates_version ON document_collaboration_updates(document_id, content_version);
