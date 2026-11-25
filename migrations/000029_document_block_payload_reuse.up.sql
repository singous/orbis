ALTER TABLE document_block_versions
    ADD COLUMN payload_revision BIGINT,
    ALTER COLUMN payload DROP NOT NULL,
    ADD CONSTRAINT document_block_payload_owner
        CHECK ((payload_revision IS NULL AND payload IS NOT NULL)
            OR (payload_revision < valid_from AND payload_revision IS NOT NULL AND payload IS NULL)),
    ADD CONSTRAINT document_block_payload_reference
        FOREIGN KEY (document_id, block_id, payload_revision)
        REFERENCES document_block_versions (document_id, block_id, valid_from);

-- A structural revision always points directly to an immutable payload owner.
CREATE FUNCTION validate_document_block_payload_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.payload IS DISTINCT FROM NEW.payload OR OLD.payload_revision IS DISTINCT FROM NEW.payload_revision THEN
            RAISE EXCEPTION 'document block payload ownership is immutable' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.payload_revision IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM document_block_versions owner
        WHERE owner.document_id = NEW.document_id AND owner.block_id = NEW.block_id
            AND owner.valid_from = NEW.payload_revision AND owner.payload IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'document block revision does not reference a payload owner' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER document_block_payload_owner_immutable
    BEFORE INSERT OR UPDATE OF payload, payload_revision ON document_block_versions
    FOR EACH ROW EXECUTE FUNCTION validate_document_block_payload_owner();

CREATE VIEW document_block_contents AS
SELECT block.document_id, block.block_id, block.parent_id, block.position,
    COALESCE(block.payload, owner.payload) AS payload, block.valid_from, block.valid_to,
    CASE WHEN block.payload_revision IS NULL THEN block.plain_text ELSE owner.plain_text END AS plain_text,
    block.payload_bytes, block.payload_digest, block.payload_revision
FROM document_block_versions block
LEFT JOIN document_block_versions owner ON owner.document_id = block.document_id
    AND owner.block_id = block.block_id AND owner.valid_from = block.payload_revision;
