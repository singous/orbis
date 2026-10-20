package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"gorm.io/gorm"
	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/internal/search"
)

func (r *Library) Search(ctx context.Context, q integration.LibraryQuery) ([]integration.SearchHit, int64, error) {
	result := []integration.SearchHit{}
	var total int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		p, err := r.tokens.RequirePrincipal(ctx, tx, q.Principal, []integration.Permission{integration.DocumentsRead}, false)
		if err != nil {
			return err
		}
		docs, count, err := r.listDocuments(ctx, tx, q, p)
		if err != nil {
			return err
		}
		total = count
		if len(docs) == 0 {
			return nil
		}
		type snapshot struct {
			ID      string `json:"id"`
			Version int64  `json:"version"`
		}
		snapshots := make([]snapshot, 0, len(docs))
		indices := map[string]int{}
		for _, doc := range docs {
			indices[doc.ID] = len(result)
			result = append(result, integration.SearchHit{Document: doc, Anchors: []integration.SearchAnchor{}})
			snapshots = append(snapshots, snapshot{doc.ID, doc.ContentVersion})
		}
		encoded, err := json.Marshal(snapshots)
		if err != nil {
			return err
		}
		var rows []struct {
			DocumentID, BlockID, Snippet string
			BlockRevision                int64
		}
		err = tx.Raw(`SELECT s.id AS document_id,b.block_id,b.valid_from AS block_revision,b.snippet FROM jsonb_to_recordset(CAST(? AS JSONB)) AS s(id UUID,version BIGINT)
   CROSS JOIN LATERAL(SELECT b.block_id,b.valid_from,substring(b.plain_text FROM greatest(1,strpos(lower(b.plain_text),lower(?))-60) FOR 300) AS snippet
   FROM document_block_versions b WHERE b.document_id=s.id AND b.valid_from<=s.version AND (b.valid_to IS NULL OR b.valid_to>s.version) AND strpos(lower(b.plain_text),lower(?))>0 ORDER BY b.block_id LIMIT ?)b`, string(encoded), q.Text, q.Text, integration.MaxSearchAnchors).Scan(&rows).Error
		if err != nil {
			return err
		}
		for _, row := range rows {
			index := indices[row.DocumentID]
			result[index].Anchors = append(result[index].Anchors, integration.SearchAnchor{BlockID: row.BlockID, BlockRevision: row.BlockRevision, Snippet: search.Snippet(row.Snippet, q.Text)})
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, total, err
}
