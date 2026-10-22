package postgres

import (
	"context"
	"database/sql"
	"encoding/json"

	"gorm.io/gorm"

	"orbis.local/orbis/internal/board"
	"orbis.local/orbis/internal/platform/fault"
)

func pageSnapshot(ctx context.Context, tx *gorm.DB, sc board.Scope, pageID string, revision int64) (board.Snapshot, error) {
	meta, err := metadata(ctx, tx, sc, revision)
	if err != nil {
		return board.Snapshot{}, err
	}
	found := false
	for _, page := range meta.Pages {
		if page.ID == pageID {
			found = true
		}
	}
	if !found {
		return board.Snapshot{}, fault.Missing()
	}
	var size int64
	if err := atVersion(tx, sc.BoardID, meta.Revision).Where("page_id=?", pageID).Select("COALESCE(sum(octet_length(payload::text)),0)").Scan(&size).Error; err != nil {
		return board.Snapshot{}, err
	}
	if size > board.MaxSnapshotBytes {
		return board.Snapshot{}, board.Limit()
	}
	var rows []elementVersion
	if err := atVersion(tx, sc.BoardID, meta.Revision).Where("page_id=?", pageID).Order("id").Limit(board.MaxPageElements + 1).Find(&rows).Error; err != nil {
		return board.Snapshot{}, err
	}
	if len(rows) > board.MaxPageElements {
		return board.Snapshot{}, board.Limit()
	}
	result := board.Snapshot{Board: meta, Elements: []board.Element{}}
	for _, row := range rows {
		var e board.Element
		if err := json.Unmarshal(row.Payload, &e); err != nil {
			return result, err
		}
		result.Elements = append(result.Elements, e)
	}
	return result, nil
}
func (r *Repository) PageSnapshot(ctx context.Context, sc board.Scope, pageID string, revision int64) (board.Snapshot, error) {
	var result board.Snapshot
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		result, err = pageSnapshot(ctx, tx, sc, pageID, revision)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
