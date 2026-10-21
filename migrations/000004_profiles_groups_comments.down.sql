DROP TABLE document_comments;
DROP INDEX collections_group_order;
ALTER TABLE collections DROP COLUMN sort_order, DROP COLUMN metadata_version,
    DROP CONSTRAINT collections_group_scope, DROP COLUMN group_id;
DROP TABLE collection_groups;
ALTER TABLE users DROP COLUMN bio, DROP COLUMN profile_version;
UPDATE users SET display_name = '未命名用户' WHERE display_name IS NULL;
ALTER TABLE users ALTER COLUMN display_name SET NOT NULL;
