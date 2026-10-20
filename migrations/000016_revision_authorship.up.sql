ALTER TABLE document_revisions ADD COLUMN author_name TEXT NOT NULL DEFAULT '';
UPDATE document_revisions r SET author_name=coalesce(nullif(u.display_name,''),'未命名用户') FROM users u WHERE u.id=r.author_id;
ALTER TABLE document_revisions ALTER COLUMN author_id DROP NOT NULL;
ALTER TABLE document_revisions ADD COLUMN title_recorded BOOLEAN NOT NULL DEFAULT TRUE;
