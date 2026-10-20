-- Removes credentials, operation retry history and explicit attachment grants; documents/files remain.
DROP TABLE integration_attachments;
DROP TABLE integration_operations;
DROP TABLE integration_tokens;
