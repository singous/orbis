CREATE TABLE integration_uploads (
    token_id UUID NOT NULL,
    operation_id UUID NOT NULL,
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    document_id UUID NOT NULL,
    asset_id UUID NOT NULL REFERENCES assets(id),
    expected_sha256 TEXT NOT NULL CHECK(length(expected_sha256)=64),
    expected_size BIGINT NOT NULL CHECK(expected_size BETWEEN 0 AND 20971520),
    filename TEXT NOT NULL,
    media_hint TEXT NOT NULL,
    PRIMARY KEY(token_id,operation_id),
    FOREIGN KEY(token_id,operation_id) REFERENCES integration_operations(token_id,operation_id),
    FOREIGN KEY(workspace_id,document_id) REFERENCES documents(workspace_id,id)
);
