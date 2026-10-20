CREATE TABLE data_tables (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    document_id UUID NOT NULL,
    block_id UUID NOT NULL,
    head_version BIGINT NOT NULL CHECK (head_version BETWEEN 1 AND 9007199254740991),
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL,
    FOREIGN KEY (workspace_id, document_id) REFERENCES documents(workspace_id, id)
);
CREATE INDEX data_tables_document ON data_tables(workspace_id, document_id, block_id);

CREATE TABLE data_table_revisions (
    table_id UUID NOT NULL REFERENCES data_tables(id),
    version BIGINT NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
    base_version BIGINT,
    definition JSONB NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
    created_at_ms BIGINT NOT NULL,
    PRIMARY KEY (table_id, version),
    FOREIGN KEY (table_id, base_version) REFERENCES data_table_revisions(table_id, version)
);

CREATE TABLE data_table_field_kinds (
    table_id UUID NOT NULL REFERENCES data_tables(id),
    field_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('text','number','select','multi_select','datetime','checkbox','url')),
    PRIMARY KEY (table_id, field_id)
);

CREATE TABLE data_table_record_ids (
    table_id UUID NOT NULL REFERENCES data_tables(id),
    record_id UUID NOT NULL,
    position BIGINT GENERATED ALWAYS AS IDENTITY,
    created_at_ms BIGINT NOT NULL,
    PRIMARY KEY (table_id, record_id)
);
CREATE INDEX data_table_record_order ON data_table_record_ids(table_id, position, record_id);
CREATE TABLE data_table_record_versions (
    table_id UUID NOT NULL,
    record_id UUID NOT NULL,
    valid_from BIGINT NOT NULL,
    valid_to BIGINT,
    values JSONB NOT NULL CHECK (jsonb_typeof(values) = 'object'),
    updated_at_ms BIGINT NOT NULL,
    PRIMARY KEY (table_id, record_id, valid_from),
    FOREIGN KEY (table_id, record_id) REFERENCES data_table_record_ids(table_id, record_id),
    FOREIGN KEY (table_id, valid_from) REFERENCES data_table_revisions(table_id, version),
    FOREIGN KEY (table_id, valid_to) REFERENCES data_table_revisions(table_id, version),
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE UNIQUE INDEX data_table_record_current ON data_table_record_versions(table_id, record_id) WHERE valid_to IS NULL;
CREATE INDEX data_table_record_snapshot ON data_table_record_versions(table_id, valid_from, valid_to, record_id);

CREATE TABLE data_table_operations (
    document_id UUID NOT NULL,
    operation_id UUID NOT NULL,
    result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
    created_at_ms BIGINT NOT NULL,
    PRIMARY KEY (document_id, operation_id),
    FOREIGN KEY (document_id, operation_id) REFERENCES document_operations(document_id, operation_id)
);
