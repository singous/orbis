package postgres

import (
	"context"
	"encoding/json"
	"slices"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
)

type directoryEdit struct {
	scope           document.DirectoryScope
	expectedVersion int64
	requireActive   bool
}

func (r *Repository) withDirectory(
	ctx context.Context,
	edit directoryEdit,
	action func(*gorm.DB, *collectionRow) error,
) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := wsstore.RequireLocked(
			ctx,
			tx,
			edit.scope.WorkspaceID,
			edit.scope.ActorID,
			workspace.Edit,
		); err != nil {
			return err
		}
		if edit.scope.DocumentID != "" {
			var row documentRow
			if err := tx.Where("workspace_id = ? AND id = ?", edit.scope.WorkspaceID, edit.scope.DocumentID).Take(&row).Error; err != nil {
				return missing(err)
			}
			if edit.scope.CollectionID != "" && edit.scope.CollectionID != row.CollectionID {
				return fault.Missing()
			}
			edit.scope.CollectionID = row.CollectionID
		}
		collection, err := collectionFor(
			tx,
			edit.scope,
			"NO KEY UPDATE",
			edit.requireActive,
		)
		if err != nil {
			return err
		}
		if collection.DirectoryVersion != edit.expectedVersion {
			return &fault.Error{
				Kind: fault.Conflict, Code: "DIRECTORY_VERSION_CONFLICT", Message: "目录已变化，请刷新后重试",
				Details: map[string]int64{"expected_version": edit.expectedVersion, "current_version": collection.DirectoryVersion},
			}
		}
		return action(tx, &collection)
	})
}

func bumpDirectory(tx *gorm.DB, collection *collectionRow, timestamp int64) error {
	if collection.DirectoryVersion >= document.MaxVersion {
		return fault.New(fault.Conflict, "DIRECTORY_VERSION_EXHAUSTED", "目录版本号已达到上限")
	}
	collection.DirectoryVersion++
	collection.UpdatedAtMS = timestamp
	return tx.Model(&collectionRow{}).Where("id = ? AND workspace_id = ?", collection.ID, collection.WorkspaceID).
		Updates(map[string]any{"directory_version": collection.DirectoryVersion, "updated_at_ms": timestamp}).Error
}

func lockedDocument(tx *gorm.DB, scope document.DirectoryScope) (documentRow, error) {
	var row documentRow
	query := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
		"id = ? AND workspace_id = ?",
		scope.DocumentID,
		scope.WorkspaceID,
	)
	if scope.CollectionID != "" {
		query = query.Where("collection_id = ?", scope.CollectionID)
	}
	err := query.Take(&row).Error
	return row, missing(err)
}

func siblingIDs(tx *gorm.DB, scope document.DirectoryScope, parent *string) ([]string, error) {
	ids := []string{}
	err := siblings(tx, scope, parent).Order("position, id").Pluck("id", &ids).Error
	return ids, err
}

func withoutID(ids []string, removed string) []string {
	result := make([]string, 0, len(ids))
	for _, id := range ids {
		if id != removed {
			result = append(result, id)
		}
	}
	return result
}

func insertID(ids []string, id string, position int) []string {
	result := make([]string, 0, len(ids)+1)
	result = append(result, ids[:position]...)
	result = append(result, id)
	return append(result, ids[position:]...)
}

const updatePositionsSQL = `UPDATE documents d SET position = p.ordinality - 1, updated_at_ms = ?
FROM jsonb_array_elements_text(CAST(? AS JSONB)) WITH ORDINALITY AS p(id, ordinality)
WHERE d.workspace_id = ? AND d.collection_id = ? AND d.id = p.id::UUID
  AND d.position IS DISTINCT FROM p.ordinality - 1`

func setPositions(tx *gorm.DB, scope document.DirectoryScope, ids []string, timestamp int64) error {
	if len(ids) == 0 {
		return nil
	}
	encoded, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	return tx.Exec(
		updatePositionsSQL,
		timestamp,
		string(encoded),
		scope.WorkspaceID,
		scope.CollectionID,
	).Error
}

const subtreeHeightSQL = `WITH RECURSIVE subtree AS (
    SELECT id, 1 AS depth FROM documents WHERE workspace_id = ? AND collection_id = ? AND id = ?
    UNION ALL
    SELECT d.id, p.depth + 1 FROM documents d JOIN subtree p ON d.parent_id = p.id
    WHERE d.workspace_id = ? AND d.collection_id = ? AND p.depth < ?
) SELECT coalesce(max(depth), 0) FROM subtree`

// Move serializes structural changes at collection scope to reject even concurrent opposite moves.
func (r *Repository) Move(
	ctx context.Context,
	change document.LocationChange,
) (document.DirectoryMutation, error) {
	var result document.DirectoryMutation
	err := r.withDirectory(ctx, directoryEdit{scope: change.Scope, expectedVersion: change.ExpectedDirectoryVersion, requireActive: true},
		func(tx *gorm.DB, collection *collectionRow) error {
			scope := change.Scope
			scope.CollectionID = collection.ID
			row, err := lockedDocument(tx, scope)
			if err != nil {
				return err
			}
			if err := readableDocument(tx, row); err != nil {
				return err
			}
			parent := row.ParentID
			if change.ParentSet {
				parent = change.ParentID
			}
			state, err := ancestors(
				tx,
				scope,
				parent,
				&row.ID,
			)
			if err != nil {
				return err
			}
			if !state.Rooted || state.Archived != 0 {
				return fault.Missing()
			}
			if state.ContainsDocument {
				return fault.New(fault.Conflict, "DOCUMENT_PARENT_CYCLE", "不能移动到自身或后代文档中")
			}
			var height int
			if err := tx.Raw(
				subtreeHeightSQL,
				scope.WorkspaceID,
				collection.ID,
				row.ID,
				scope.WorkspaceID,
				collection.ID,
				document.MaxDirectoryDepth+1,
			).Scan(&height).Error; err != nil {
				return err
			}
			if state.Depth+height > document.MaxDirectoryDepth {
				return fault.Field("body.parent_id", "文档目录深度超出限制")
			}
			oldIDs, err := siblingIDs(tx, scope, row.ParentID)
			if err != nil {
				return err
			}
			destination, err := siblingIDs(tx, scope, parent)
			if err != nil {
				return err
			}
			destination = withoutID(destination, row.ID)
			position := len(destination)
			if equalParent(parent, row.ParentID) {
				position = min(row.Position, len(destination))
			}
			if change.Position != nil {
				position = *change.Position
			}
			if position > len(destination) {
				return fault.Field("body.position", "目录位置超出兄弟文档范围")
			}
			ordered := insertID(destination, row.ID, position)
			if equalParent(parent, row.ParentID) && slices.Equal(oldIDs, ordered) {
				result = document.DirectoryMutation{Document: row.domain(), DirectoryVersion: collection.DirectoryVersion}
				return nil
			}
			if err := tx.Model(&documentRow{}).Where("id = ?", row.ID).
				Updates(map[string]any{"parent_id": parent, "updated_at_ms": change.Timestamp}).Error; err != nil {
				return err
			}
			if !equalParent(parent, row.ParentID) {
				if err := setPositions(
					tx,
					scope,
					withoutID(oldIDs, row.ID),
					change.Timestamp,
				); err != nil {
					return err
				}
			}
			if err := setPositions(
				tx,
				scope,
				ordered,
				change.Timestamp,
			); err != nil {
				return err
			}
			if err := bumpDirectory(tx, collection, change.Timestamp); err != nil {
				return err
			}
			row.ParentID, row.Position, row.UpdatedAtMS = parent, position, change.Timestamp
			result = document.DirectoryMutation{Document: row.domain(), DirectoryVersion: collection.DirectoryVersion}
			return nil
		})
	return result, err
}

// Reorder atomically replaces a complete sibling order at the expected collection version.
func (r *Repository) Reorder(ctx context.Context, change document.ReorderChange) (document.Collection, error) {
	var result document.Collection
	err := r.withDirectory(ctx, directoryEdit{scope: change.Scope, expectedVersion: change.ExpectedDirectoryVersion, requireActive: true},
		func(tx *gorm.DB, collection *collectionRow) error {
			if _, err := activeParent(tx, change.Scope, change.ParentID); err != nil {
				return err
			}
			ids, err := siblingIDs(tx, change.Scope, change.ParentID)
			if err != nil {
				return err
			}
			current := map[string]bool{}
			for _, id := range ids {
				current[id] = true
			}
			if len(ids) != len(change.DocumentIDs) {
				return fault.New(fault.Conflict, "DIRECTORY_ORDER_CONFLICT", "需要提供完整的兄弟文档列表")
			}
			for _, id := range change.DocumentIDs {
				if !current[id] {
					return fault.New(fault.Conflict, "DIRECTORY_ORDER_CONFLICT", "文档不属于当前兄弟集合")
				}
			}
			if !slices.Equal(ids, change.DocumentIDs) {
				if err := setPositions(
					tx,
					change.Scope,
					change.DocumentIDs,
					change.Timestamp,
				); err != nil {
					return err
				}
				if err := bumpDirectory(tx, collection, change.Timestamp); err != nil {
					return err
				}
			}
			result = collection.domain()
			return nil
		})
	return result, err
}

// Archive preserves descendant markers and requires all ancestors to be active on restoration.
func (r *Repository) Archive(
	ctx context.Context,
	change document.ArchiveChange,
) (document.DirectoryMutation, error) {
	var result document.DirectoryMutation
	err := r.withDirectory(ctx, directoryEdit{scope: change.Scope, expectedVersion: change.ExpectedDirectoryVersion},
		func(tx *gorm.DB, collection *collectionRow) error {
			scope := change.Scope
			scope.CollectionID = collection.ID
			row, err := lockedDocument(tx, scope)
			if err != nil {
				return err
			}
			if !change.Archived {
				state, err := ancestors(
					tx,
					scope,
					row.ParentID,
					nil,
				)
				if err != nil {
					return err
				}
				group, err := groupFor(tx, collection.WorkspaceID, &collection.GroupID, "SHARE", false)
				if err != nil {
					return err
				}
				if group.IsArchived || collection.IsArchived || !state.Rooted || state.Archived != 0 {
					return fault.New(fault.Conflict, "ARCHIVE_PARENT_INACTIVE", "请先恢复所属分组、文集及全部上级文档")
				}
			}
			if row.IsArchived == change.Archived {
				result = document.DirectoryMutation{Document: row.domain(), DirectoryVersion: collection.DirectoryVersion}
				return nil
			}
			ids, err := siblingIDs(tx, scope, row.ParentID)
			if err != nil {
				return err
			}
			var archivedAt *int64
			if change.Archived {
				archivedAt = &change.Timestamp
				ids = withoutID(ids, row.ID)
			} else {
				row.Position = min(row.Position, len(ids))
				ids = insertID(ids, row.ID, row.Position)
			}
			if err := tx.Model(&documentRow{}).Where("id = ?", row.ID).
				Updates(map[string]any{"archived_at_ms": archivedAt, "is_archived": change.Archived, "updated_at_ms": change.Timestamp}).Error; err != nil {
				return err
			}
			if err := setPositions(
				tx,
				scope,
				ids,
				change.Timestamp,
			); err != nil {
				return err
			}
			if err := bumpDirectory(tx, collection, change.Timestamp); err != nil {
				return err
			}
			row.ArchivedAtMS, row.UpdatedAtMS = archivedAt, change.Timestamp
			row.IsArchived = change.Archived
			result = document.DirectoryMutation{Document: row.domain(), DirectoryVersion: collection.DirectoryVersion}
			return nil
		})
	return result, err
}

// ArchiveCollection changes visibility without touching any document archive markers.
func (r *Repository) ArchiveCollection(
	ctx context.Context,
	change document.ArchiveChange,
) (document.Collection, error) {
	var result document.Collection
	err := r.withDirectory(ctx, directoryEdit{scope: change.Scope, expectedVersion: change.ExpectedDirectoryVersion},
		func(tx *gorm.DB, collection *collectionRow) error {
			if !change.Archived {
				group, err := groupFor(tx, collection.WorkspaceID, &collection.GroupID, "SHARE", false)
				if err != nil {
					return err
				}
				if group.IsArchived {
					return fault.New(fault.Conflict, "ARCHIVE_PARENT_INACTIVE", "请先恢复所属分组")
				}
			}
			if collection.IsArchived != change.Archived {
				collection.IsArchived = change.Archived
				collection.ArchivedAtMS = nil
				if change.Archived {
					collection.ArchivedAtMS = &change.Timestamp
				}
				if err := tx.Model(&collectionRow{}).Where("id = ?", collection.ID).Updates(map[string]any{"archived_at_ms": collection.ArchivedAtMS, "is_archived": collection.IsArchived}).Error; err != nil {
					return err
				}
				if err := bumpDirectory(tx, collection, change.Timestamp); err != nil {
					return err
				}
			}
			result = collection.domain()
			return nil
		})
	return result, err
}
