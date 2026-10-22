-- Product versions reference immutable revisions without copying document bodies.
ALTER TABLE integration_operations DROP CONSTRAINT integration_operations_kind_check;
ALTER TABLE integration_operations ADD CONSTRAINT integration_operations_kind_check
    CHECK(kind IN ('create','commands','upload','import','version-create','version-edit','version-restore'));

CREATE TABLE document_versions (
    id UUID PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(id),
    source_revision BIGINT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('automatic','named','before_restore','restored')),
    name TEXT CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 120),
    description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
    title TEXT NOT NULL,
    title_recorded BOOLEAN NOT NULL,
    content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
    content_schema TEXT NOT NULL,
    dependencies JSONB NOT NULL CHECK (jsonb_typeof(dependencies) = 'array'),
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    author_name TEXT NOT NULL,
    metadata_version BIGINT NOT NULL DEFAULT 1 CHECK (metadata_version > 0),
    sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    captured_at_ms BIGINT NOT NULL,
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL,
    FOREIGN KEY(document_id, source_revision) REFERENCES document_revisions(document_id, version),
    UNIQUE(document_id, id)
);
CREATE INDEX document_versions_timeline ON document_versions(document_id, sequence DESC);
CREATE INDEX document_versions_content_head ON document_versions(document_id, source_revision DESC, sequence DESC);
CREATE UNIQUE INDEX document_versions_automatic ON document_versions(document_id, source_revision, kind) WHERE kind <> 'named';

-- A manifest bounds reads by this version's block count, independently of history size.
-- The FK also prevents cleanup from removing a retained version's content.
CREATE TABLE document_version_blocks (
    version_id UUID NOT NULL,
    document_id UUID NOT NULL,
    block_id UUID NOT NULL,
    block_revision BIGINT NOT NULL,
    PRIMARY KEY(version_id, block_id),
    FOREIGN KEY(document_id,version_id) REFERENCES document_versions(document_id,id),
    FOREIGN KEY(document_id, block_id, block_revision)
        REFERENCES document_block_versions(document_id, block_id, valid_from)
);
CREATE INDEX document_version_blocks_reference ON document_version_blocks(document_id,block_id,block_revision);

CREATE TABLE document_version_assets (
    version_id UUID NOT NULL REFERENCES document_versions(id),
    asset_id UUID NOT NULL REFERENCES assets(id),
    PRIMARY KEY(version_id, asset_id)
);
CREATE INDEX document_version_assets_reference ON document_version_assets(asset_id);
CREATE TABLE document_version_tables (
    version_id UUID NOT NULL REFERENCES document_versions(id),
    table_id UUID NOT NULL,
    table_revision BIGINT NOT NULL,
    PRIMARY KEY(version_id, table_id, table_revision),
    FOREIGN KEY(table_id, table_revision) REFERENCES data_table_revisions(table_id, version)
);
CREATE INDEX document_version_tables_reference ON document_version_tables(table_id,table_revision);

CREATE TABLE document_version_operations (
    document_id UUID NOT NULL REFERENCES documents(id),
    operation_id UUID NOT NULL,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    request_hash TEXT NOT NULL,
    result JSONB NOT NULL,
    created_at_ms BIGINT NOT NULL,
    PRIMARY KEY(document_id, operation_id)
);

-- This durable, coalescing outbox records activity in the same transaction as content.
CREATE TABLE document_version_activity (
    document_id UUID PRIMARY KEY REFERENCES documents(id),
    source_revision BIGINT NOT NULL,
    started_at_ms BIGINT NOT NULL,
    touched_at_ms BIGINT NOT NULL,
    checked_at_ms BIGINT NOT NULL DEFAULT 0,
    FOREIGN KEY(document_id,source_revision) REFERENCES document_revisions(document_id,version)
        DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX document_version_activity_idle ON document_version_activity(touched_at_ms, checked_at_ms, document_id);
CREATE INDEX document_version_activity_maximum ON document_version_activity(started_at_ms, checked_at_ms, document_id);
CREATE INDEX document_block_version_closed ON document_block_versions(document_id, valid_to) WHERE valid_to IS NOT NULL;

CREATE FUNCTION track_document_version_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.content_version = OLD.content_version THEN RETURN NEW; END IF;
        IF NEW.title = OLD.title AND NOT EXISTS (
            SELECT 1 FROM document_block_versions
            WHERE document_id = NEW.id AND (valid_from = NEW.content_version OR valid_to = NEW.content_version)
        ) THEN RETURN NEW; END IF;
    END IF;
    INSERT INTO document_version_activity(document_id, source_revision, started_at_ms, touched_at_ms)
    VALUES (NEW.id, NEW.content_version, NEW.updated_at_ms, NEW.updated_at_ms)
    ON CONFLICT(document_id) DO UPDATE
    SET source_revision = EXCLUDED.source_revision,
        touched_at_ms = GREATEST(document_version_activity.touched_at_ms,EXCLUDED.touched_at_ms);
    RETURN NEW;
END $$;
CREATE TRIGGER document_version_activity_changed AFTER INSERT OR UPDATE OF content_version ON documents
    FOR EACH ROW EXECUTE FUNCTION track_document_version_activity();

-- Existing history remains readable; baseline capture is bounded background work.
INSERT INTO document_version_activity(document_id, source_revision, started_at_ms, touched_at_ms)
SELECT id, content_version, updated_at_ms, updated_at_ms FROM documents;
