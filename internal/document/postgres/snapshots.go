package postgres

import (
	"context"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
)

// LockSnapshotCollection freezes directory membership while allowing independent document editors.
func LockSnapshotCollection(ctx context.Context, tx *gorm.DB, scope document.DirectoryScope) (document.Collection, error) {
	row, err := collectionFor(tx.WithContext(ctx), scope, "SHARE", true)
	return row.domain(), err
}

// ReadSnapshotBatch requires caller-verified visibility in the same transaction.
// Structural locks or a repeatable-read snapshot must keep the selected document set stable.
func ReadSnapshotBatch(ctx context.Context, tx *gorm.DB, wid string, ids []string, maxBytes int, lock bool) (map[string]document.Content, error) {
	result := map[string]document.Content{}
	if len(ids) == 0 {
		return result, nil
	}
	q := tx.WithContext(ctx).Where("workspace_id=? AND id IN ?", wid, ids).Order("id")
	if lock {
		q = q.Clauses(clause.Locking{Strength: "SHARE"})
	}
	var docs []documentRow
	if err := q.Find(&docs).Error; err != nil {
		return nil, err
	}
	if len(docs) != len(ids) {
		return nil, fault.Missing()
	}
	pairs := make([][]any, 0, len(docs))
	for _, doc := range docs {
		pairs = append(pairs, []any{doc.ID, doc.ContentVersion})
	}
	var revisions []revisionRow
	if err := tx.WithContext(ctx).Where("(document_id,version) IN ?", pairs).Find(&revisions).Error; err != nil {
		return nil, err
	}
	if len(revisions) != len(ids) {
		return nil, fault.Missing()
	}
	var bytes int64
	if err := tx.WithContext(ctx).Table("document_block_versions b").Joins("JOIN documents d ON d.id=b.document_id").Where("d.workspace_id=? AND d.id IN ? AND b.valid_from<=d.content_version AND (b.valid_to IS NULL OR b.valid_to>d.content_version)", wid, ids).Select("coalesce(sum(octet_length(b.payload::text)),0)").Scan(&bytes).Error; err != nil {
		return nil, err
	}
	if bytes > int64(maxBytes) {
		return nil, fault.New(fault.TooLarge, "SNAPSHOT_TOO_LARGE", "所选内容超过快照大小限制，请缩小范围")
	}
	var rows []blockRow
	if err := tx.WithContext(ctx).Table("document_block_versions b").Select("b.*").Joins("JOIN documents d ON d.id=b.document_id").Where("d.workspace_id=? AND d.id IN ? AND b.valid_from<=d.content_version AND (b.valid_to IS NULL OR b.valid_to>d.content_version)", wid, ids).Scan(&rows).Error; err != nil {
		return nil, err
	}
	records := map[string][]document.BlockRecord{}
	for _, row := range rows {
		records[row.DocumentID] = append(records[row.DocumentID], row.domain())
	}
	for _, revision := range revisions {
		blocks, err := document.Expand(records[revision.DocumentID])
		if err != nil {
			return nil, err
		}
		result[revision.DocumentID] = document.Content{Revision: revision.domain(), Blocks: blocks}
	}
	return result, nil
}

// ReadSnapshotCollection checks active collection and group visibility without acquiring write locks.
func ReadSnapshotCollection(ctx context.Context, tx *gorm.DB, scope document.DirectoryScope) (document.Collection, error) {
	row, err := collectionFor(tx.WithContext(ctx), scope, "", true)
	return row.domain(), err
}
