CREATE TABLE sheets (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    collection_id UUID NOT NULL,
    title TEXT NOT NULL,
    creation_hash TEXT NOT NULL,
    definition JSONB NOT NULL,
    schema_version BIGINT NOT NULL DEFAULT 1 CHECK(schema_version>0),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL,
    FOREIGN KEY (workspace_id, collection_id) REFERENCES collections(workspace_id,id),
    UNIQUE(workspace_id,id)
);
CREATE INDEX sheets_collection ON sheets(workspace_id,collection_id,id);
CREATE INDEX sheets_workspace ON sheets(workspace_id,id);
CREATE TABLE sheet_records (
    sheet_id UUID NOT NULL REFERENCES sheets(id),
    id UUID NOT NULL,
    position BIGINT GENERATED ALWAYS AS IDENTITY,
    version BIGINT NOT NULL CHECK (version > 0),
    values JSONB NOT NULL,
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL,
    PRIMARY KEY(sheet_id,id)
);
CREATE INDEX sheet_records_order ON sheet_records(sheet_id,position,id);
CREATE TABLE sheet_cells (
    sheet_id UUID NOT NULL,
    record_id UUID NOT NULL,
    field_id UUID NOT NULL,
    ordinal INTEGER NOT NULL DEFAULT 0,
    text_value TEXT,
    number_value NUMERIC,
    PRIMARY KEY(sheet_id,record_id,field_id,ordinal),
    FOREIGN KEY(sheet_id,record_id) REFERENCES sheet_records(sheet_id,id) ON DELETE CASCADE
);
CREATE INDEX sheet_cells_text ON sheet_cells(sheet_id,field_id,md5(text_value),record_id) WHERE text_value IS NOT NULL;
CREATE INDEX sheet_cells_number ON sheet_cells(sheet_id,field_id,number_value,record_id) WHERE number_value IS NOT NULL;
CREATE TABLE sheet_operations (
    sheet_id UUID NOT NULL REFERENCES sheets(id),
    operation_id UUID NOT NULL,
    actor_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    result JSONB NOT NULL,
    created_at_ms BIGINT NOT NULL,
    PRIMARY KEY(sheet_id,operation_id)
);
CREATE TABLE sheet_record_history (
    sheet_id UUID NOT NULL REFERENCES sheets(id),
    record_id UUID NOT NULL,
    version BIGINT NOT NULL,
    operation_id UUID NOT NULL,
    values JSONB NOT NULL,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    actor_id UUID REFERENCES users(id),
    created_at_ms BIGINT NOT NULL,
    PRIMARY KEY(sheet_id,record_id,version)
);
CREATE TABLE sheet_schema_history (
    sheet_id UUID NOT NULL REFERENCES sheets(id),
    version BIGINT NOT NULL,
    definition JSONB NOT NULL,
    title TEXT NOT NULL,
    created_at_ms BIGINT NOT NULL,
    PRIMARY KEY(sheet_id,version)
);
CREATE TABLE sheet_forms (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users(id),
    sheet_id UUID NOT NULL REFERENCES sheets(id),
    config JSONB NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    nonce TEXT NOT NULL,
    version BIGINT NOT NULL DEFAULT 1,
    updated_at_ms BIGINT NOT NULL
);
CREATE INDEX sheet_forms_sheet ON sheet_forms(sheet_id);
CREATE TABLE sheet_asset_references (
    sheet_id UUID NOT NULL,
    record_id UUID NOT NULL,
    asset_id UUID NOT NULL REFERENCES assets(id),
    PRIMARY KEY(sheet_id,record_id,asset_id),
    FOREIGN KEY(sheet_id,record_id) REFERENCES sheet_records(sheet_id,id) ON DELETE CASCADE
);

CREATE TABLE sheet_activity (
 sheet_id UUID PRIMARY KEY REFERENCES sheets(id),
 revision BIGINT NOT NULL DEFAULT 0,
 record_count BIGINT NOT NULL DEFAULT 0 CHECK(record_count>=0),
 updated_at_ms BIGINT NOT NULL
);

CREATE TABLE sheet_form_uploads (
 form_id UUID NOT NULL REFERENCES sheet_forms(id),
 asset_id UUID NOT NULL REFERENCES assets(id),
 field_id UUID NOT NULL,
 nonce TEXT NOT NULL,
 created_at_ms BIGINT NOT NULL,
 PRIMARY KEY(form_id,asset_id)
);
CREATE INDEX sheet_form_uploads_budget ON sheet_form_uploads(form_id,created_at_ms);
