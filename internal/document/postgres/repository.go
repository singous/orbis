package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"gorm.io/gorm"

	"orbis.local/orbis/internal/asset"
	assetstore "orbis.local/orbis/internal/asset/postgres"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	tablestore "orbis.local/orbis/internal/table/postgres"
	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
)

type Repository struct {
	db            *gorm.DB
	collaboration document.CollaborationEngine
}

// New uses a caller-owned PostgreSQL pool for document storage.
func New(db *gorm.DB) *Repository { return &Repository{db: db} }

// NewWithCollaboration explicitly shares the CRDT runtime with every content writer.
func NewWithCollaboration(db *gorm.DB, engine document.CollaborationEngine) *Repository {
	return &Repository{db: db, collaboration: engine}
}
func missing(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return fault.Missing()
	}
	return err
}

// CreateCollection holds the membership lock until the collection commits.
func (r *Repository) CreateCollection(ctx context.Context, actor string, c document.Collection) (document.Collection, error) {
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := wsstore.RequireLocked(ctx, tx, c.WorkspaceID, actor, workspace.Edit); err != nil {
			return err
		}
		var groupID *string
		if c.GroupID != "" {
			groupID = &c.GroupID
		}
		group, err := groupFor(tx, c.WorkspaceID, groupID, "SHARE", true)
		if err != nil {
			return err
		}
		c.GroupID = group.ID
		if err := requireIcon(ctx, tx, c.WorkspaceID, c.Icon); err != nil {
			return err
		}
		return tx.Create(&collectionRow{Icon: c.Icon, ID: c.ID, WorkspaceID: c.WorkspaceID, Title: c.Title, GroupID: c.GroupID,
			SortOrder: c.SortOrder, MetadataVersion: 1, CreatedAtMS: c.CreatedAtMS, UpdatedAtMS: c.UpdatedAtMS}).Error
	})
	return c, err
}

// ListCollections keeps the total and page in one snapshot and filters inactive parent groups.
func (r *Repository) ListCollections(ctx context.Context, input document.CollectionQuery) ([]document.Collection, int64, error) {
	items := []document.Collection{}
	var total int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		q := tx.Table("collections c").Joins("JOIN collection_groups g ON g.workspace_id = c.workspace_id AND g.id = c.group_id").Where("c.workspace_id = ? AND (c.is_archived = TRUE) = ?", input.Scope.WorkspaceID, input.Archived)
		if !input.Archived {
			q = q.Where("g.is_archived = FALSE")
		}
		if input.GroupID != nil {
			q = q.Where("c.group_id = ?", *input.GroupID)
		}
		if err := q.Count(&total).Error; err != nil {
			return err
		}
		var rows []collectionRow
		if err := q.Select("c.*").Order("c.sort_order, c.id").Offset(input.Page.Offset()).Limit(input.Page.Size).Scan(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			items = append(items, row.domain())
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return items, total, err
}

// Create holds the collection structural lock while appending a document and its first revision.
func (r *Repository) Create(ctx context.Context, actor string, d document.Document) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		_, err := InsertDocument(ctx, tx, actor, d, nil)
		return err
	})
}

// InsertDocument shares the caller transaction for directory, initial revision and content.
func InsertDocument(ctx context.Context, tx *gorm.DB, actor string, d document.Document, blocks []document.BlockRecord) (document.Document, error) {
	tx = tx.WithContext(ctx)
	err := func() error {
		if err := wsstore.RequireLocked(
			ctx,
			tx,
			d.WorkspaceID,
			actor,
			workspace.Edit,
		); err != nil {
			return err
		}
		scope := document.DirectoryScope{WorkspaceID: d.WorkspaceID, CollectionID: d.CollectionID}
		collection, err := collectionFor(
			tx,
			scope,
			"NO KEY UPDATE",
			true,
		)
		if err != nil {
			return err
		}
		state, err := activeParent(tx, scope, d.ParentID)
		if err != nil {
			return err
		}
		if state.Depth >= document.MaxDirectoryDepth {
			return fault.Field("body.parent_id", "文档目录深度超出限制")
		}
		var position int
		if err := siblings(tx, scope, d.ParentID).Select("coalesce(max(position), -1) + 1").Scan(&position).Error; err != nil {
			return err
		}
		if position > document.MaxPosition {
			return fault.Field("body.parent_id", "目录位置超出范围")
		}
		d.Position = position
		row := documentRow{
			ID: d.ID, WorkspaceID: d.WorkspaceID, CollectionID: d.CollectionID, Title: d.Title,
			ContentVersion: 1, ParentID: d.ParentID, Position: position, CreatedAtMS: d.CreatedAtMS, UpdatedAtMS: d.UpdatedAtMS,
		}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		if err := insertRevision(ctx, tx, revisionRow{DocumentID: d.ID, Title: d.Title, AuthorID: &actor, Version: 1, CreatedAtMS: d.CreatedAtMS}); err != nil {
			return err
		}
		rows := make([]blockRow, 0, len(blocks))
		for _, b := range blocks {
			rows = append(rows, blockRow{DocumentID: d.ID, BlockID: b.ID, ParentID: b.ParentID, Position: b.Position, Payload: b.Payload, ValidFrom: 1})
		}
		if len(rows) > 0 {
			if err := cacheBlocks(rows); err != nil {
				return err
			}
			if err := tx.CreateInBatches(rows, 250).Error; err != nil {
				return err
			}
		}
		return bumpDirectory(tx, &collection, d.CreatedAtMS)
	}()
	return d, err
}

// LockDirectory serializes imports and structural edits after the caller holds membership SHARE.
func LockDirectory(ctx context.Context, tx *gorm.DB, scope document.DirectoryScope) error {
	_, err := collectionFor(tx.WithContext(ctx), scope, "NO KEY UPDATE", true)
	return err
}

// List excludes any document hidden by its own or an ancestor's archive marker.
func (r *Repository) List(
	ctx context.Context,
	wid, cid string,
	page pagination.Page,
) ([]document.Document, int64, error) {
	return r.listVisible(
		ctx,
		wid,
		cid,
		page,
	)
}

// Get applies collection and full ancestor visibility to direct document lookup.
func (r *Repository) Get(ctx context.Context, wid, did string) (document.Document, error) {
	var row documentRow
	tx := r.db.WithContext(ctx)
	if err := tx.Where("workspace_id = ? AND id = ?", wid, did).Take(&row).Error; err != nil {
		return document.Document{}, missing(err)
	}
	if err := readableDocument(tx, row); err != nil {
		return document.Document{}, err
	}
	return row.domain(), nil
}

// Read retains historical visibility even when a newer revision commits concurrently.
func (r *Repository) Read(
	ctx context.Context,
	wid, did string,
	version int64,
) (document.Revision, []document.BlockRecord, error) {
	d, err := r.Get(ctx, wid, did)
	if err != nil {
		return document.Revision{}, nil, err
	}
	if version == 0 {
		version = d.ContentVersion
	}
	var rev revisionRow
	if err := r.db.WithContext(ctx).Where("document_id = ? AND version = ?", did, version).Take(&rev).Error; err != nil {
		return document.Revision{}, nil, missing(err)
	}
	var rows []blockRow
	err = r.db.WithContext(ctx).Where(
		"document_id = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)",
		did,
		version,
		version,
	).Find(&rows).Error
	items := make([]document.BlockRecord, 0, len(rows))
	for _, row := range rows {
		items = append(items, row.domain())
	}
	return rev.domain(), items, err
}
func equalPayload(a, b json.RawMessage) bool {
	var x, y document.Payload
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return false
	}
	left, _ := json.Marshal(x)
	right, _ := json.Marshal(y)
	return string(left) == string(right)
}
func equalParent(a, b *string) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

// Commit serializes document changes and stores content, history, and the receipt atomically.
func (r *Repository) Commit(ctx context.Context, c document.Commit) (int64, error) {
	var version int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		doc, err := LockContent(ctx, tx, document.DirectoryScope{ActorID: c.ActorID, WorkspaceID: c.WorkspaceID, DocumentID: c.DocumentID})
		if err != nil {
			return err
		}
		previous, replayed, err := CheckOperation(ctx, tx, c.DocumentID, c.ActorID, c.OperationID, c.RequestHash)
		if err != nil {
			return err
		}
		if replayed {
			version = previous
			return nil
		}
		if err := CheckVersion(doc.ContentVersion, c.ExpectedVersion); err != nil {
			return err
		}
		ids := make([]string, 0, len(c.AssetReferences))
		for _, reference := range c.AssetReferences {
			ids = append(ids, reference.ID)
		}
		media, err := assetstore.RequireFiles(ctx, tx, c.WorkspaceID, ids)
		if err != nil {
			return err
		}
		for _, reference := range c.AssetReferences {
			if reference.Kind != "file" && (!asset.InlineType(media[reference.ID]) || !strings.HasPrefix(media[reference.ID], reference.Kind+"/")) {
				return fault.Field("body.blocks", "引用文件的媒体类型与文档块不匹配")
			}
		}
		if err := tablestore.RequireReferences(ctx, tx, c.WorkspaceID, c.DocumentID, c.TableReferences); err != nil {
			return err
		}
		version = doc.ContentVersion + 1
		if err := insertRevision(ctx, tx, revisionRow{
			DocumentID:          c.DocumentID,
			Title:               c.Title,
			AuthorID:            &c.ActorID,
			Version:             version,
			RestoredFromVersion: c.RestoreVersion,
			CreatedAtMS:         c.Timestamp,
		}); err != nil {
			return err
		}
		var old []blockRow
		if err := tx.Where("document_id = ? AND valid_to IS NULL", c.DocumentID).Find(&old).Error; err != nil {
			return err
		}
		before := map[string]blockRow{}
		for _, row := range old {
			before[row.BlockID] = row
		}
		changed := []string{}
		insert := []blockRow{}
		for _, b := range c.Blocks {
			prior, exists := before[b.ID]
			delete(before, b.ID)
			if exists && equalParent(prior.ParentID, b.ParentID) && prior.Position == b.Position && equalPayload(prior.Payload, b.Payload) {
				continue
			}
			if exists {
				changed = append(changed, b.ID)
			}
			insert = append(insert, blockRow{
				DocumentID: c.DocumentID,
				BlockID:    b.ID,
				ParentID:   b.ParentID,
				Position:   b.Position,
				Payload:    b.Payload,
				ValidFrom:  version,
			})
		}
		for id := range before {
			changed = append(changed, id)
		}
		if len(changed) > 0 {
			if err := tx.Model(&blockRow{}).Where("document_id = ? AND valid_to IS NULL AND block_id IN ?", c.DocumentID, changed).Update(
				"valid_to",
				version,
			).Error; err != nil {
				return err
			}
		}
		if len(insert) > 0 {
			if err := cacheBlocks(insert); err != nil {
				return err
			}
			if err := tx.CreateInBatches(insert, 250).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&documentRow{}).Where("id = ? AND workspace_id = ?", c.DocumentID, c.WorkspaceID).Updates(
			map[string]any{"content_version": version, "title": c.Title, "updated_at_ms": c.Timestamp},
		).Error; err != nil {
			return err
		}
		if err := SyncCollaboration(ctx, tx, doc.ID, version, c.OperationID, c.ActorID, c.Timestamp, c.RestoreVersion != nil, r.collaboration); err != nil {
			return err
		}
		return tx.Create(&operationRow{
			DocumentID:    c.DocumentID,
			OperationID:   c.OperationID,
			ActorID:       &c.ActorID,
			RequestHash:   c.RequestHash,
			ResultVersion: version,
			CreatedAtMS:   c.Timestamp,
		}).Error
	})
	return version, err
}

// Revisions checks workspace ownership of the document before reading history.
func (r *Repository) Revisions(
	ctx context.Context,
	wid, did string,
	p pagination.Page,
) ([]document.Revision, int64, error) {
	if _, err := r.Get(ctx, wid, did); err != nil {
		return nil, 0, err
	}
	q := r.db.WithContext(ctx).Model(&revisionRow{}).Where("document_id = ?", did)
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []revisionRow
	err := q.Order("version DESC").Offset(p.Offset()).Limit(p.Size).Find(&rows).Error
	items := make([]document.Revision, 0, len(rows))
	for _, row := range rows {
		items = append(items, row.domain())
	}
	return items, total, err
}

// BlockPage uses keyset pagination over records visible at the requested revision.
func (r *Repository) BlockPage(
	ctx context.Context,
	wid, did string,
	version int64,
	after string,
	limit int,
) ([]document.BlockRecord, error) {
	var result []document.BlockRecord
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		result, err = blockPage(ctx, tx, wid, did, version, after, limit)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func blockPage(ctx context.Context, tx *gorm.DB, wid, did string, version int64, after string, limit int) ([]document.BlockRecord, error) {
	if _, err := New(tx).Get(ctx, wid, did); err != nil {
		return nil, err
	}
	var count int64
	if err := tx.Model(&revisionRow{}).Where("document_id=? AND version=?", did, version).Count(&count).Error; err != nil {
		return nil, err
	}
	if count != 1 {
		return nil, fault.Missing()
	}
	q := tx.WithContext(ctx).Where(
		"document_id = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)",
		did,
		version,
		version,
	)
	if after != "" {
		q = q.Where("block_id > ?", after)
	}
	var rows []blockRow
	err := q.Order("block_id ASC").Limit(limit).Find(&rows).Error
	items := make([]document.BlockRecord, 0, len(rows))
	for _, row := range rows {
		items = append(items, row.domain())
	}
	if err != nil {
		return nil, err
	}
	return childCounts(ctx, tx, did, version, items)
}
