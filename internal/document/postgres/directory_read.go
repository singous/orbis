package postgres

import (
	"context"
	"database/sql"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
)

type ancestorState struct {
	Depth            int
	Archived         int64
	Rooted           bool
	ContainsDocument bool
}

const ancestorsSQL = `WITH RECURSIVE ancestors AS (
    SELECT id, parent_id, is_archived, 1 AS depth FROM documents
    WHERE workspace_id = ? AND collection_id = ? AND id = ?
    UNION ALL
    SELECT p.id, p.parent_id, p.is_archived, a.depth + 1
    FROM documents p JOIN ancestors a ON p.id = a.parent_id
    WHERE p.workspace_id = ? AND p.collection_id = ? AND a.depth < ?
)
SELECT coalesce(max(depth), 0) AS depth,
       count(*) FILTER (WHERE is_archived = TRUE) AS archived,
       coalesce(bool_or(parent_id IS NULL), false) AS rooted,
       coalesce(bool_or(id = CAST(? AS UUID)), false) AS contains_document
FROM ancestors`

func ancestors(
	tx *gorm.DB,
	scope document.DirectoryScope,
	id *string,
	forbidden *string,
) (ancestorState, error) {
	if id == nil {
		return ancestorState{Rooted: true}, nil
	}
	var state ancestorState
	err := tx.Raw(
		ancestorsSQL,
		scope.WorkspaceID,
		scope.CollectionID,
		*id,
		scope.WorkspaceID,
		scope.CollectionID,
		document.MaxDirectoryDepth,
		forbidden,
	).Scan(&state).Error
	return state, err
}

func activeParent(tx *gorm.DB, scope document.DirectoryScope, parent *string) (ancestorState, error) {
	state, err := ancestors(
		tx,
		scope,
		parent,
		nil,
	)
	if err != nil {
		return state, err
	}
	if !state.Rooted || state.Archived != 0 {
		return state, fault.Missing()
	}
	return state, nil
}

func collectionFor(
	tx *gorm.DB,
	scope document.DirectoryScope,
	strength string,
	active bool,
) (collectionRow, error) {
	query := tx.Where("workspace_id = ? AND id = ? AND EXISTS(SELECT 1 FROM workspaces w WHERE w.id=collections.workspace_id AND w.is_active)", scope.WorkspaceID, scope.CollectionID)
	if strength != "" {
		query = query.Clauses(clause.Locking{Strength: strength})
	}
	var row collectionRow
	if err := query.Take(&row).Error; err != nil {
		return row, missing(err)
	}
	// Group locks follow collection locks, so archive and movement cannot invalidate an in-flight write.
	groupStrength := ""
	if strength != "" {
		groupStrength = "SHARE"
	}
	if _, err := groupFor(tx, scope.WorkspaceID, &row.GroupID, groupStrength, active); err != nil {
		return row, err
	}
	if active && row.IsArchived {
		return row, fault.Missing()
	}
	return row, nil
}

func readableDocument(tx *gorm.DB, row documentRow) error {
	scope := document.DirectoryScope{WorkspaceID: row.WorkspaceID, CollectionID: row.CollectionID}
	if _, err := collectionFor(
		tx,
		scope,
		"",
		true,
	); err != nil {
		return err
	}
	_, err := activeParent(tx, scope, &row.ID)
	return err
}

// Collection includes archived state so authorized clients can prepare a conditional restoration.
func (r *Repository) Collection(
	ctx context.Context,
	scope document.DirectoryScope,
) (document.Collection, error) {
	row, err := collectionFor(
		r.db.WithContext(ctx),
		scope,
		"",
		false,
	)
	return row.domain(), err
}

func siblings(tx *gorm.DB, scope document.DirectoryScope, parent *string) *gorm.DB {
	return tx.Model(&documentRow{}).Where(
		"workspace_id = ? AND collection_id = ? AND parent_id IS NOT DISTINCT FROM CAST(? AS UUID) AND is_archived = FALSE",
		scope.WorkspaceID,
		scope.CollectionID,
		parent,
	)
}

// Children uses a repeatable snapshot for parent visibility, version, count, and rows.
func (r *Repository) Children(
	ctx context.Context,
	query document.ChildrenQuery,
) (document.DirectoryPage, error) {
	result := document.DirectoryPage{Items: []document.Document{}}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		collection, err := collectionFor(
			tx,
			query.Scope,
			"",
			true,
		)
		if err != nil {
			return err
		}
		if _, err := activeParent(tx, query.Scope, query.ParentID); err != nil {
			return err
		}
		result.DirectoryVersion = collection.DirectoryVersion
		rows := []documentRow{}
		if err := siblings(tx, query.Scope, query.ParentID).Count(&result.Total).Error; err != nil {
			return err
		}
		if err := siblings(tx, query.Scope, query.ParentID).Order("position, id").
			Offset(query.Page.Offset()).Limit(query.Page.Size).Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			result.Items = append(result.Items, row.domain())
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}

const visibleSQL = `WITH RECURSIVE visible AS (
    SELECT d.*, 1 AS depth FROM documents d
    WHERE d.workspace_id = ? AND d.collection_id = ? AND d.parent_id IS NULL AND d.is_archived = FALSE
    UNION ALL
    SELECT d.*, p.depth + 1 FROM documents d JOIN visible p ON d.parent_id = p.id
    WHERE d.workspace_id = ? AND d.collection_id = ? AND d.is_archived = FALSE AND p.depth < ?
) `

func visibleArguments(wid, cid string) []any {
	return []any{wid, cid, wid, cid, document.MaxDirectoryDepth}
}

func (r *Repository) listVisible(
	ctx context.Context,
	wid, cid string,
	page pagination.Page,
) ([]document.Document, int64, error) {
	items := []document.Document{}
	var total int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := collectionFor(
			tx,
			document.DirectoryScope{WorkspaceID: wid, CollectionID: cid},
			"",
			true,
		); err != nil {
			return err
		}
		if err := tx.Raw(visibleSQL+"SELECT count(*) FROM visible", visibleArguments(wid, cid)...).Scan(&total).Error; err != nil {
			return err
		}
		args := append(visibleArguments(wid, cid), page.Size, page.Offset())
		rows := []documentRow{}
		if err := tx.Raw(visibleSQL+"SELECT * FROM visible ORDER BY updated_at_ms DESC, id DESC LIMIT ? OFFSET ?", args...).Scan(
			&rows,
		).Error; err != nil {
			return err
		}
		for _, row := range rows {
			items = append(items, row.domain())
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return items, total, err
}
