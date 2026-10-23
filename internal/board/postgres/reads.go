package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"gorm.io/gorm"

	"orbis.local/orbis/internal/board"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
)

func (r *Repository) List(ctx context.Context, sc board.Scope, collection string, page pagination.Page) ([]board.Summary, int64, error) {
	items := []board.Summary{}
	var total int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		query := tx.Table("boards b").Joins("JOIN documents d ON d.id=b.document_id AND d.workspace_id=b.workspace_id").Joins("JOIN collections c ON c.id=d.collection_id").Joins("JOIN collection_groups g ON g.id=c.group_id").Where("b.workspace_id=? AND d.is_archived=FALSE AND c.archived_at_ms IS NULL AND g.archived_at_ms IS NULL", sc.WorkspaceID).Where(`NOT EXISTS (WITH RECURSIVE ancestors AS (SELECT id,parent_id,is_archived,1 depth FROM documents WHERE id=d.parent_id UNION ALL SELECT p.id,p.parent_id,p.is_archived,a.depth+1 FROM documents p JOIN ancestors a ON p.id=a.parent_id WHERE a.depth<64) SELECT 1 FROM ancestors WHERE is_archived)`)
		if collection != "" {
			query = query.Where("d.collection_id=?", collection)
		}
		if sc.OwnerDocumentID != "" {
			query = query.Where("b.document_id=?", sc.OwnerDocumentID)
		}
		if err := query.Count(&total).Error; err != nil {
			return err
		}
		return query.Select("b.id,b.document_id,d.collection_id,d.title,GREATEST(b.updated_at_ms,d.updated_at_ms) AS updated_at_ms").Order("GREATEST(b.updated_at_ms,d.updated_at_ms) DESC,b.id").Offset(page.Offset()).Limit(page.Size).Scan(&items).Error
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return items, total, err
}

type elementCursor struct {
	Workspace, Board, Page, After string
	Revision                      int64
}

func atVersion(tx *gorm.DB, id string, revision int64) *gorm.DB {
	return tx.Model(&elementVersion{}).Where("board_id=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>?)", id, revision, revision)
}
func (r *Repository) Elements(ctx context.Context, sc board.Scope, q board.ElementQuery) (board.ElementPage, error) {
	result := board.ElementPage{Items: []board.Element{}, Revision: q.Revision}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		metadata, err := metadata(ctx, tx, sc, q.Revision)
		if err != nil {
			return err
		}
		found := false
		for _, page := range metadata.Pages {
			if page.ID == q.PageID {
				found = true
			}
		}
		if !found {
			return fault.Missing()
		}
		query := atVersion(tx, sc.BoardID, q.Revision).Where("page_id=?", q.PageID)
		if q.Cursor != "" {
			var cursor elementCursor
			if err := r.cursor.Decode(q.Cursor, &cursor); err != nil || cursor.Workspace != sc.WorkspaceID || cursor.Board != sc.BoardID || cursor.Page != q.PageID || cursor.Revision != q.Revision || !board.ValidID(cursor.After) {
				return fault.Field("query.cursor", "游标与画板、页面或版本不匹配")
			}
			query = query.Where("id>?", cursor.After)
		}
		var candidates []struct {
			ID    string
			Bytes int
		}
		if err := query.Select("id,octet_length(payload::text) AS bytes").Order("id").Limit(board.ElementPageSize + 1).Scan(&candidates).Error; err != nil {
			return err
		}
		ids, size := []string{}, 0
		for _, candidate := range candidates {
			if len(ids) >= board.ElementPageSize || (len(ids) > 0 && size+candidate.Bytes > board.MaxElementPageBytes) {
				break
			}
			ids = append(ids, candidate.ID)
			size += candidate.Bytes
		}
		var rows []elementVersion
		if len(ids) > 0 {
			if err := query.Select("id,payload").Where("id IN ?", ids).Order("id").Find(&rows).Error; err != nil {
				return err
			}
		}
		result.HasMore = len(ids) < len(candidates)
		if result.HasMore {
			cursor, err := r.cursor.Encode(elementCursor{Workspace: sc.WorkspaceID, Board: sc.BoardID, Page: q.PageID, Revision: q.Revision, After: rows[len(rows)-1].ID})
			if err != nil {
				return err
			}
			result.NextCursor = &cursor
		}
		for _, row := range rows {
			var element board.Element
			if err := json.Unmarshal(row.Payload, &element); err != nil {
				return err
			}
			result.Items = append(result.Items, element)
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func (r *Repository) Changes(ctx context.Context, sc board.Scope, after int64) (board.ChangePage, error) {
	result := board.ChangePage{Items: []board.Change{}}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		header, _, err := loadHeader(ctx, tx, sc, false)
		if err != nil {
			return err
		}
		result.Revision = header.Revision
		if after > header.Revision {
			return fault.New(fault.Conflict, "BOARD_RESYNC_REQUIRED", "同步版本已失效，请重新读取画板")
		}
		var rows []operationRow
		if err := tx.Raw(`WITH candidates AS (
 SELECT revision,result FROM board_operations WHERE board_id=? AND revision>? ORDER BY revision LIMIT ?
), budgeted AS (
 SELECT revision,result,row_number() OVER (ORDER BY revision) AS ordinal,
 sum(octet_length(result::text)) OVER (ORDER BY revision) AS bytes FROM candidates
) SELECT revision,result FROM budgeted WHERE ordinal=1 OR bytes<=? ORDER BY revision`, sc.BoardID, after, board.ChangePageSize, board.MaxChangeBytes).Scan(&rows).Error; err != nil {
			return err
		}
		last := after
		for _, row := range rows {
			var change board.Change
			if err := json.Unmarshal(row.Result, &change); err != nil {
				return err
			}
			result.Items = append(result.Items, change)
			last = change.Revision
		}
		result.HasMore = last < header.Revision
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func (r *Repository) Receipt(ctx context.Context, sc board.Scope, operation string) (board.Change, error) {
	var result board.Change
	_, _, err := loadHeader(ctx, r.db, sc, false)
	if err != nil {
		return result, err
	}
	var row operationRow
	if err := r.db.WithContext(ctx).Where("board_id=? AND operation_id=? AND actor_id=?", sc.BoardID, operation, sc.ActorID).Take(&row).Error; err != nil {
		return result, missing(err)
	}
	err = json.Unmarshal(row.Result, &result)
	return result, err
}
func replay(ctx context.Context, tx *gorm.DB, sc board.Scope, operation, hash string) (board.Change, bool, error) {
	var row operationRow
	err := tx.WithContext(ctx).Where("board_id=? AND operation_id=?", sc.BoardID, operation).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return board.Change{}, false, nil
	}
	if err != nil {
		return board.Change{}, false, err
	}
	if row.ActorID != sc.ActorID || row.RequestHash != hash {
		return board.Change{}, false, fault.New(fault.Conflict, "IDEMPOTENCY_CONFLICT", "操作标识已用于其他请求")
	}
	var result board.Change
	err = json.Unmarshal(row.Result, &result)
	return result, true, err
}
func snapshot(ctx context.Context, tx *gorm.DB, sc board.Scope, revision int64) (board.Snapshot, error) {
	meta, err := metadata(ctx, tx, sc, revision)
	if err != nil {
		return board.Snapshot{}, err
	}
	result := board.Snapshot{Board: meta, Elements: []board.Element{}}
	var bytes int64
	if err := atVersion(tx, sc.BoardID, meta.Revision).Select("COALESCE(sum(octet_length(payload::text)),0)").Scan(&bytes).Error; err != nil {
		return result, err
	}
	if bytes > board.MaxSnapshotBytes {
		return result, board.Limit()
	}
	var rows []elementVersion
	if err := atVersion(tx, sc.BoardID, meta.Revision).Order("page_id,id").Limit(board.MaxBoardElements + 1).Find(&rows).Error; err != nil {
		return result, err
	}
	if len(rows) > board.MaxBoardElements {
		return result, board.Limit()
	}
	for _, row := range rows {
		var element board.Element
		if err := json.Unmarshal(row.Payload, &element); err != nil {
			return result, err
		}
		result.Elements = append(result.Elements, element)
	}
	return result, nil
}
func (r *Repository) Snapshot(ctx context.Context, sc board.Scope, revision int64) (board.Snapshot, error) {
	var result board.Snapshot
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error { var err error; result, err = snapshot(ctx, tx, sc, revision); return err }, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func (r *Repository) History(ctx context.Context, sc board.Scope, before int64) ([]board.HistoryItem, error) {
	if _, _, err := loadHeader(ctx, r.db, sc, false); err != nil {
		return nil, err
	}
	query := r.db.WithContext(ctx).Model(&revisionRow{}).Select("revision,actor_id,created_at_ms").Where("board_id=?", sc.BoardID)
	if before > 0 {
		query = query.Where("revision<?", before)
	}
	result := []board.HistoryItem{}
	err := query.Order("revision DESC").Limit(board.ChangePageSize).Scan(&result).Error
	return result, err
}
