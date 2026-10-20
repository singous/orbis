// Package postgres executes search against one authorized PostgreSQL snapshot.
package postgres

import (
	"context"
	"database/sql"
	"strings"

	"gorm.io/gorm"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/search"
	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
)

type Repository struct{ db *gorm.DB }

func New(db *gorm.DB) *Repository { return &Repository{db: db} }

// Search never returns inherited archives as active, or archived content as a snippet.
func (r *Repository) Search(ctx context.Context, input search.Query) (search.Result, error) {
	result := search.Result{Items: []search.Item{}}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		role, err := wsstore.New(tx).Role(ctx, input.WorkspaceID, input.ActorID)
		if err != nil {
			return err
		}
		if !workspace.Allowed(role, workspace.Read) {
			return fault.Denied()
		}
		if input.Text == "" && input.ResourceID == nil {
			return nil
		}
		providers := []string{}
		for _, kind := range []string{"document", "collection", "group", "file", "site"} {
			if input.Type == "all" || input.Type == kind {
				providers = append(providers, providerSQL(kind))
			}
		}
		query := scopeSQL + ", candidates AS (" + strings.Join(providers, " UNION ALL ") + `), matches AS (
          SELECT *, CASE WHEN lower(title)=lower(@query) THEN 0
              WHEN strpos(lower(title),lower(@query))=1 THEN 1
              WHEN strpos(lower(title),lower(@query))>0 THEN 2
              WHEN match='comment' THEN 4 ELSE 3 END AS rank
          FROM candidates WHERE (CAST(@resource_id AS uuid) IS NULL OR id=CAST(@resource_id AS uuid))
        ) `
		args := []any{
			sql.Named("workspace", input.WorkspaceID),
			sql.Named("query", input.Text),
			sql.Named("status", input.Status),
			sql.Named("depth", document.MaxDirectoryDepth),
			sql.Named("block_depth", document.MaxDepth),
			sql.Named("resource_id", input.ResourceID),
		}
		if err := tx.Raw(query+"SELECT count(*) FROM matches", args...).Scan(&result.Total).Error; err != nil {
			return err
		}
		args = append(
			args,
			sql.Named("limit", input.Page.Size),
			sql.Named("offset", input.Page.Offset()),
			sql.Named("context", search.SnippetContext),
			sql.Named("snippet", search.MaxSnippetLength+2*search.SnippetContext),
		)
		var rows []search.Item
		err = tx.Raw(query+`SELECT id,type,workspace_id,title,location,match,matched_comment_id,status,updated_at_ms,collection_id,group_id,
            substring(snippet_source FROM greatest(1,strpos(lower(snippet_source),lower(@query))-@context) FOR @snippet) AS snippet
            FROM matches ORDER BY rank,updated_at_ms DESC,type,id LIMIT @limit OFFSET @offset`, args...).Scan(&rows).Error
		if err != nil {
			return err
		}
		for _, item := range rows {
			item.Snippet = search.Snippet(item.Snippet, input.Text)
			result.Items = append(result.Items, item)
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}

const scopeSQL = `WITH RECURSIVE active_documents AS (
    SELECT d.id,d.collection_id,1 AS depth FROM documents d
    JOIN collections c ON c.workspace_id=d.workspace_id AND c.id=d.collection_id
    JOIN collection_groups g ON g.workspace_id=c.workspace_id AND g.id=c.group_id
    WHERE d.workspace_id=@workspace AND d.parent_id IS NULL AND d.is_archived = FALSE
      AND c.is_archived = FALSE AND g.is_archived = FALSE
    UNION ALL
    SELECT d.id,d.collection_id,a.depth+1 FROM documents d JOIN active_documents a ON d.parent_id=a.id AND d.collection_id=a.collection_id
    WHERE d.workspace_id=@workspace AND d.is_archived = FALSE AND a.depth<@depth
)`

func statusSQL(archived, active string) string {
	return "((@status IN ('active','all') AND " + active + ") OR (@status IN ('archived','all') AND " + archived + " = TRUE))"
}
func providerSQL(kind string) string {
	switch kind {
	case "document":
		return documentSQL
	case "site":
		return `SELECT s.id,'site'::text AS type,s.workspace_id,s.name AS title,'站点 / ' || s.slug AS location,
          CASE WHEN strpos(lower(s.name),lower(@query))>0 THEN s.name ELSE s.slug || ' ' || coalesce(s.configuration->>'description','') END AS snippet_source,
          CASE WHEN strpos(lower(s.name),lower(@query))>0 THEN 'title' ELSE 'metadata' END AS match,
          NULL::uuid AS matched_comment_id,'active'::text AS status,s.updated_at_ms,NULL::uuid AS collection_id,NULL::uuid AS group_id
          FROM sites s WHERE s.workspace_id=@workspace AND @status <> 'archived'
            AND (strpos(lower(s.name),lower(@query))>0 OR strpos(lower(s.slug || ' ' || coalesce(s.configuration->>'description','')),lower(@query))>0)`
	case "collection":
		return `SELECT c.id,'collection'::text AS type,c.workspace_id,c.title,g.name AS location,c.title AS snippet_source,
        'title'::text AS match,NULL::uuid AS matched_comment_id,CASE WHEN c.is_archived = FALSE THEN 'active' ELSE 'archived' END AS status,
        c.updated_at_ms,c.id AS collection_id,c.group_id FROM collections c JOIN collection_groups g ON g.workspace_id=c.workspace_id AND g.id=c.group_id
        WHERE c.workspace_id=@workspace AND ` + statusSQL("c.is_archived", "c.is_archived = FALSE AND g.is_archived = FALSE") + ` AND strpos(lower(c.title),lower(@query))>0`
	case "group":
		return `SELECT g.id,'group'::text AS type,g.workspace_id,g.name AS title,'文档分组'::text AS location,g.name AS snippet_source,
        'title'::text AS match,NULL::uuid AS matched_comment_id,CASE WHEN g.is_archived = FALSE THEN 'active' ELSE 'archived' END AS status,
        g.updated_at_ms,NULL::uuid AS collection_id,g.id AS group_id FROM collection_groups g WHERE g.workspace_id=@workspace AND ` + statusSQL("g.is_archived", "g.is_archived = FALSE") + ` AND strpos(lower(g.name),lower(@query))>0`
	default:
		return `SELECT a.id,'file'::text AS type,a.workspace_id,a.filename AS title,'文件与附件'::text AS location,
        CASE WHEN strpos(lower(a.filename),lower(@query))>0 THEN a.filename ELSE a.media_type END AS snippet_source,
        CASE WHEN strpos(lower(a.filename),lower(@query))>0 THEN 'title' ELSE 'metadata' END AS match,
        NULL::uuid AS matched_comment_id,'active'::text AS status,a.updated_at_ms,NULL::uuid AS collection_id,NULL::uuid AS group_id
        FROM assets a WHERE a.workspace_id=@workspace AND a.kind='file' AND a.state='ready' AND @status <> 'archived'
          AND (strpos(lower(a.filename),lower(@query))>0 OR strpos(lower(a.media_type),lower(@query))>0)`
	}
}

const documentSQL = `SELECT d.id,'document'::text AS type,d.workspace_id,d.title,g.name || ' / ' || c.title AS location,
    CASE WHEN strpos(lower(d.title),lower(@query))>0 THEN d.title WHEN strpos(lower(body.text),lower(@query))>0 THEN body.text ELSE comment.body END AS snippet_source,
    CASE WHEN strpos(lower(d.title),lower(@query))>0 THEN 'title' WHEN strpos(lower(body.text),lower(@query))>0 THEN 'body' ELSE 'comment' END AS match,
    CASE WHEN strpos(lower(d.title),lower(@query))>0 OR strpos(lower(body.text),lower(@query))>0 THEN NULL ELSE comment.id END AS matched_comment_id,
    CASE WHEN d.is_archived = FALSE THEN 'active' ELSE 'archived' END AS status,d.updated_at_ms,d.collection_id,c.group_id
    FROM documents d JOIN collections c ON c.workspace_id=d.workspace_id AND c.id=d.collection_id
    JOIN collection_groups g ON g.workspace_id=c.workspace_id AND g.id=c.group_id
    LEFT JOIN active_documents visible ON visible.id=d.id
    LEFT JOIN LATERAL (
        WITH RECURSIVE walk AS (
            SELECT b.block_id,b.plain_text,ARRAY[b.position] AS path FROM document_block_versions b
            WHERE visible.id IS NOT NULL AND b.document_id=d.id AND b.valid_to IS NULL AND b.parent_id IS NULL
            UNION ALL
            SELECT b.block_id,b.plain_text,w.path || b.position FROM document_block_versions b JOIN walk w ON b.parent_id=w.block_id
            WHERE b.document_id=d.id AND b.valid_to IS NULL AND cardinality(w.path)<@block_depth
        ) SELECT string_agg(plain_text,E'\n' ORDER BY path,block_id) AS text FROM walk WHERE plain_text<>''
    ) body ON true
    LEFT JOIN LATERAL (
        SELECT id,body FROM document_comments WHERE visible.id IS NOT NULL AND workspace_id=@workspace AND document_id=d.id
          AND strpos(lower(body),lower(@query))>0 ORDER BY updated_at_ms DESC,id LIMIT 1
    ) comment ON true
    WHERE d.workspace_id=@workspace
      AND ((@status IN ('active','all') AND visible.id IS NOT NULL) OR (@status IN ('archived','all') AND d.is_archived = TRUE))
      AND (strpos(lower(d.title),lower(@query))>0 OR strpos(lower(body.text),lower(@query))>0 OR comment.id IS NOT NULL)`
