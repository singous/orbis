DROP VIEW document_block_contents;
DROP TRIGGER document_block_payload_owner_immutable ON document_block_versions;
DROP FUNCTION validate_document_block_payload_owner();

-- Restore full payloads before making them mandatory for the older schema.
UPDATE document_block_versions AS block
SET payload = owner.payload, payload_revision = NULL
FROM document_block_versions AS owner
WHERE owner.document_id = block.document_id AND owner.block_id = block.block_id
    AND owner.valid_from = block.payload_revision;

ALTER TABLE document_block_versions
    DROP CONSTRAINT document_block_payload_reference,
    DROP CONSTRAINT document_block_payload_owner,
    DROP COLUMN payload_revision,
    ALTER COLUMN payload SET NOT NULL;
