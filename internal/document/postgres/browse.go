package postgres

import (
	"context"
	"database/sql"

	"gorm.io/gorm"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
)

const workspaceVisibleSQL = `WITH RECURSIVE visible AS (
    SELECT d.*, 1 AS depth FROM documents d
    JOIN collections c ON c.id=d.collection_id AND c.workspace_id=d.workspace_id
    JOIN collection_groups g ON g.id=c.group_id AND g.workspace_id=c.workspace_id
    WHERE d.workspace_id=? AND d.parent_id IS NULL AND NOT d.is_archived
      AND NOT c.is_archived AND NOT g.is_archived
    UNION ALL
    SELECT d.*, p.depth+1 FROM documents d JOIN visible p ON d.parent_id=p.id
    WHERE d.workspace_id=? AND d.collection_id=p.collection_id AND NOT d.is_archived AND p.depth<?
) `

// Browse keeps authorization, visibility, count and metadata in the same read snapshot.
func (r *Repository) Browse(ctx context.Context, scope document.DirectoryScope, page pagination.Page, archived bool) ([]document.DocumentOverview, int64, error) {
	items := []document.DocumentOverview{}
	var total int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		role, err := wsstore.New(tx).Role(ctx, scope.WorkspaceID, scope.ActorID)
		if err != nil {
			return err
		}
		if !workspace.Allowed(role, workspace.Read) {
			return fault.Denied()
		}
		rows := []struct {
			Document documentRow `gorm:"embedded"`
			Summary  string
		}{}
		if archived {
			query := tx.Model(&documentRow{}).Where("workspace_id=? AND is_archived", scope.WorkspaceID)
			if err := query.Count(&total).Error; err != nil {
				return err
			}
			if err := query.Select("documents.*").Order("archived_at_ms DESC NULLS LAST, updated_at_ms DESC, id DESC").Offset(page.Offset()).Limit(page.Size).Find(&rows).Error; err != nil {
				return err
			}
		} else {
			args := []any{scope.WorkspaceID, scope.WorkspaceID, document.MaxDirectoryDepth}
			if err := tx.Raw(workspaceVisibleSQL+"SELECT count(*) FROM visible", args...).Scan(&total).Error; err != nil {
				return err
			}
			args = append(args, page.Size, page.Offset())
			if err := tx.Raw(workspaceVisibleSQL+`SELECT page.*, coalesce(summary.text,'') AS summary
              FROM (SELECT * FROM visible ORDER BY updated_at_ms DESC,id DESC LIMIT ? OFFSET ?) page
              LEFT JOIN LATERAL (
                SELECT left(btrim(b.plain_text,E' \n\r\t'),?) AS text FROM document_block_versions b
                WHERE b.document_id=page.id AND b.valid_from<=page.content_version
                  AND (b.valid_to IS NULL OR b.valid_to>page.content_version)
                  AND btrim(b.plain_text,E' \n\r\t')<>''
                ORDER BY b.parent_id NULLS FIRST,b.position,b.block_id LIMIT 1
              ) summary ON TRUE ORDER BY page.updated_at_ms DESC,page.id DESC`, append(args, document.MaxOverviewSummaryRunes)...).Scan(&rows).Error; err != nil {
				return err
			}
		}
		for _, row := range rows {
			items = append(items, document.DocumentOverview{Document: row.Document.domain(), Summary: row.Summary})
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return items, total, err
}
