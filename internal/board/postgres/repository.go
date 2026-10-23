package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sort"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"orbis.local/orbis/internal/board"
	"orbis.local/orbis/internal/document"
	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
)

type Repository struct {
	db      *gorm.DB
	catalog board.Catalog
	cursor  *security.CursorSigner
}

func New(db *gorm.DB, catalog board.Catalog, cursor *security.CursorSigner) *Repository {
	return &Repository{db: db, catalog: catalog, cursor: cursor}
}

type header struct {
	ID, WorkspaceID, DocumentID                    string
	SchemaVersion                                  int
	Revision                                       int64
	CreationActor, CreationOperation, CreationHash string
	CreatedAtMS                                    int64 `gorm:"column:created_at_ms"`
	UpdatedAtMS                                    int64 `gorm:"column:updated_at_ms"`
}

func (header) TableName() string { return "boards" }

type pageRow struct {
	BoardID, ID  string
	Payload      json.RawMessage
	ElementCount int
	ElementBytes int64
}

func (pageRow) TableName() string { return "board_pages" }

type elementRow struct {
	BoardID, ID, PageID               string
	ParentID, StartID, EndID, AssetID *string
	Payload                           json.RawMessage
	PayloadBytes                      int
}

func (elementRow) TableName() string { return "board_elements" }

type elementVersion struct {
	BoardID, ID, PageID string
	ValidFrom           int64
	ValidTo             *int64
	AssetID             *string
	Payload             json.RawMessage
}

func (elementVersion) TableName() string { return "board_element_versions" }

type revisionRow struct {
	BoardID     string
	Revision    int64
	Title       string
	Pages       json.RawMessage
	ActorID     *string
	CreatedAtMS int64 `gorm:"column:created_at_ms"`
}

func (revisionRow) TableName() string { return "board_revisions" }

type operationRow struct {
	BoardID, OperationID, ActorID, RequestHash string
	Revision                                   int64
	Result                                     json.RawMessage
	CreatedAtMS                                int64 `gorm:"column:created_at_ms"`
}

func (operationRow) TableName() string { return "board_operations" }
func missing(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return fault.Missing()
	}
	return err
}
func loadHeader(ctx context.Context, tx *gorm.DB, sc board.Scope, lock bool) (header, document.Document, error) {
	var row header
	if err := tx.WithContext(ctx).Where("workspace_id=? AND id=?", sc.WorkspaceID, sc.BoardID).Take(&row).Error; err != nil {
		return row, document.Document{}, missing(err)
	}
	if lock {
		owner, err := docstore.New(tx).Get(ctx, sc.WorkspaceID, row.DocumentID)
		if err != nil {
			return row, document.Document{}, err
		}
		if err := docstore.LockDocumentDirectoryForRead(ctx, tx, document.DirectoryScope{ActorID: sc.ActorID, WorkspaceID: sc.WorkspaceID, CollectionID: owner.CollectionID, DocumentID: row.DocumentID}); err != nil {
			return row, document.Document{}, err
		}
		if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).Where("workspace_id=? AND id=?", sc.WorkspaceID, sc.BoardID).Take(&row).Error; err != nil {
			return row, document.Document{}, missing(err)
		}
	}
	doc, err := docstore.New(tx).Get(ctx, sc.WorkspaceID, row.DocumentID)
	return row, doc, err
}
func metadata(ctx context.Context, tx *gorm.DB, sc board.Scope, version int64) (board.Board, error) {
	current := version == 0
	h, doc, err := loadHeader(ctx, tx, sc, false)
	if err != nil {
		return board.Board{}, err
	}
	if version == 0 {
		version = h.Revision
	}
	var revision revisionRow
	if err := tx.WithContext(ctx).Where("board_id=? AND revision=?", h.ID, version).Take(&revision).Error; err != nil {
		return board.Board{}, missing(err)
	}
	pages := []board.Page{}
	if err := json.Unmarshal(revision.Pages, &pages); err != nil {
		return board.Board{}, err
	}
	title := revision.Title
	if current {
		title = doc.Title
	}
	return board.Board{ID: h.ID, WorkspaceID: h.WorkspaceID, DocumentID: h.DocumentID, CollectionID: doc.CollectionID, Title: title, SchemaVersion: h.SchemaVersion, Revision: version, Pages: pages, CreatedAtMS: h.CreatedAtMS, UpdatedAtMS: revision.CreatedAtMS}, nil
}
func (r *Repository) Get(ctx context.Context, sc board.Scope, version int64) (board.Board, error) {
	var result board.Board
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error { var err error; result, err = metadata(ctx, tx, sc, version); return err }, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func rowFor(id string, e board.Element) (elementRow, error) {
	raw, err := json.Marshal(e)
	row := elementRow{BoardID: id, ID: e.ID, PageID: e.PageID, ParentID: e.Structure.ParentID, AssetID: e.Structure.AssetID, Payload: raw, PayloadBytes: len(raw)}
	if e.Structure.Start != nil {
		row.StartID = e.Structure.Start.ElementID
	}
	if e.Structure.End != nil {
		row.EndID = e.Structure.End.ElementID
	}
	return row, err
}
func writeElement(ctx context.Context, tx *gorm.DB, id string, e board.Element, revision int64) error {
	row, err := rowFor(id, e)
	if err != nil {
		return err
	}
	if err := tx.WithContext(ctx).Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "board_id"}, {Name: "id"}}, UpdateAll: true}).Create(&row).Error; err != nil {
		return err
	}
	if err := tx.WithContext(ctx).Model(&elementVersion{}).Where("board_id=? AND id=? AND valid_to IS NULL", id, e.ID).Update("valid_to", revision).Error; err != nil {
		return err
	}
	return tx.WithContext(ctx).Create(&elementVersion{BoardID: id, ID: e.ID, PageID: e.PageID, ValidFrom: revision, AssetID: e.Structure.AssetID, Payload: row.Payload}).Error
}
func pages(ctx context.Context, tx *gorm.DB, id string) ([]board.Page, error) {
	var rows []pageRow
	if err := tx.WithContext(ctx).Where("board_id=?", id).Limit(board.MaxPages + 1).Find(&rows).Error; err != nil {
		return nil, err
	}
	result := []board.Page{}
	for _, row := range rows {
		var page board.Page
		if err := json.Unmarshal(row.Payload, &page); err != nil {
			return nil, err
		}
		result = append(result, page)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Position == result[j].Position {
			return result[i].ID < result[j].ID
		}
		return result[i].Position < result[j].Position
	})
	return result, nil
}
func commitRevision(ctx context.Context, tx *gorm.DB, sc board.Scope, title string, change board.Change, hash string) error {
	current, err := pages(ctx, tx, sc.BoardID)
	if err != nil {
		return err
	}
	pageData, err := json.Marshal(current)
	if err != nil {
		return err
	}
	if err := tx.WithContext(ctx).Create(&revisionRow{BoardID: sc.BoardID, Revision: change.Revision, Title: title, Pages: pageData, ActorID: &sc.ActorID, CreatedAtMS: change.UpdatedAtMS}).Error; err != nil {
		return err
	}
	data, err := json.Marshal(change)
	if err != nil {
		return err
	}
	if len(data) > board.MaxChangeBytes {
		return board.Limit()
	}
	return tx.WithContext(ctx).Create(&operationRow{BoardID: sc.BoardID, OperationID: change.OperationID, ActorID: sc.ActorID, RequestHash: hash, Revision: change.Revision, Result: data, CreatedAtMS: change.UpdatedAtMS}).Error
}
func (r *Repository) Create(ctx context.Context, sc board.Scope, in board.Create, hash string, now int64) (board.Board, error) {
	var result board.Board
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := wsstore.RequireLocked(ctx, tx, sc.WorkspaceID, sc.ActorID, workspace.Edit); err != nil {
			return err
		}
		if err := docstore.LockDirectory(ctx, tx, document.DirectoryScope{WorkspaceID: sc.WorkspaceID, CollectionID: in.CollectionID}); err != nil {
			return err
		}
		sc.BoardID = in.ID
		owner := uuid.NewString()
		row := header{ID: in.ID, WorkspaceID: sc.WorkspaceID, DocumentID: owner, SchemaVersion: board.SchemaVersion, Revision: 1, CreationActor: sc.ActorID, CreationOperation: in.OperationID, CreationHash: hash, CreatedAtMS: now, UpdatedAtMS: now}
		inserted := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row)
		if inserted.Error != nil {
			return inserted.Error
		}
		if inserted.RowsAffected == 0 {
			var existing header
			if err := tx.Where("workspace_id=? AND id=?", sc.WorkspaceID, in.ID).Take(&existing).Error; err != nil {
				return fault.New(fault.Conflict, "IDEMPOTENCY_CONFLICT", "创建标识已用于其他请求")
			}
			if existing.CreationActor != sc.ActorID || existing.CreationOperation != in.OperationID || existing.CreationHash != hash {
				return fault.New(fault.Conflict, "IDEMPOTENCY_CONFLICT", "创建标识已用于其他请求")
			}
			var err error
			result, err = metadata(ctx, tx, sc, 1)
			return err
		}
		blocks, err := document.Flatten([]document.Block{{ID: uuid.NewString(), Type: "board", Props: map[string]any{"board_id": in.ID, "page_id": in.PageID, "mode": "live", "revision": nil, "frame_id": nil}, Content: []document.TextRun{}, Children: []document.Block{}}})
		if err != nil {
			return err
		}
		_, err = docstore.InsertDocument(ctx, tx, sc.ActorID, document.Document{ID: owner, WorkspaceID: sc.WorkspaceID, CollectionID: in.CollectionID, Title: in.Title, BoardID: &in.ID, ParentID: in.ParentID, ContentVersion: 1, CreatedAtMS: now, UpdatedAtMS: now}, blocks)
		if err != nil {
			return err
		}
		page := board.Page{ID: in.PageID, Name: "页面 1", Background: "#f2f4f7", Position: 0, Version: 1}
		data, err := json.Marshal(page)
		if err != nil {
			return err
		}
		if err := tx.Create(&pageRow{BoardID: in.ID, ID: page.ID, Payload: data}).Error; err != nil {
			return err
		}
		elements := make(map[string]board.Element, len(in.Elements))
		for _, e := range in.Elements {
			if _, exists := elements[e.ID]; exists {
				return board.Invalid("图元标识重复")
			}
			e.Version = 1
			e.Versions = board.Versions{Geometry: 1, Style: 1, Text: 1, Structure: 1}
			elements[e.ID] = e
		}
		for _, e := range elements {
			if err := r.catalog.ValidateRelations(e, func(id string) (board.Element, bool) { v, ok := elements[id]; return v, ok }); err != nil {
				return err
			}
			if e.Structure.AssetID != nil {
				if err := requireAsset(ctx, tx, sc.WorkspaceID, *e.Structure.AssetID); err != nil {
					return err
				}
			}
		}
		change := board.Change{OperationID: in.OperationID, Revision: 1, Elements: []board.Element{}, Deleted: []string{}, Pages: []board.Page{page}, DeletedPages: []string{}, UpdatedAtMS: now}
		var size int64
		for _, e := range elements {
			row, err := rowFor(in.ID, e)
			if err != nil {
				return err
			}
			size += int64(row.PayloadBytes)
			if err := writeElement(ctx, tx, in.ID, e, 1); err != nil {
				return err
			}
			change.Elements = append(change.Elements, e)
		}
		if size > board.MaxPageBytes {
			return board.Limit()
		}
		if err := tx.Model(&pageRow{}).Where("board_id=? AND id=?", in.ID, page.ID).Updates(map[string]any{"element_count": len(elements), "element_bytes": size}).Error; err != nil {
			return err
		}
		if err := commitRevision(ctx, tx, sc, in.Title, change, hash); err != nil {
			return err
		}
		result, err = metadata(ctx, tx, sc, 1)
		return err
	})
	return result, err
}
func requireAsset(ctx context.Context, tx *gorm.DB, wid, id string) error {
	var found struct{ MediaType string }
	if err := tx.WithContext(ctx).Table("assets").Select("media_type").Clauses(clause.Locking{Strength: "SHARE"}).Where("workspace_id=? AND id=? AND state='ready' AND kind='file'", wid, id).Take(&found).Error; err != nil {
		return missing(err)
	}
	switch found.MediaType {
	case "image/png", "image/jpeg", "image/webp", "image/gif":
		return nil
	}
	return board.Invalid("画板图片须为受管的 PNG、JPEG、WebP 或 GIF")
}
