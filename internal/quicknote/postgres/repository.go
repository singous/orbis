package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"orbis.local/orbis/internal/asset"
	assetstore "orbis.local/orbis/internal/asset/postgres"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/quicknote"
	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
)

type Repository struct {
	db     *gorm.DB
	engine document.CollaborationEngine
}

func New(db *gorm.DB, engine document.CollaborationEngine) *Repository {
	return &Repository{db: db, engine: engine}
}

type noteRow struct {
	ID          string          `gorm:"column:id;primaryKey"`
	WorkspaceID string          `gorm:"column:workspace_id"`
	OwnerID     string          `gorm:"column:owner_id"`
	Version     int64           `gorm:"column:version"`
	Blocks      json.RawMessage `gorm:"column:blocks;type:jsonb"`
	CRDTState   []byte          `gorm:"column:crdt_state"`
	SearchText  string          `gorm:"column:search_text"`
	IsPinned    bool            `gorm:"column:is_pinned"`
	CreatedAtMS int64           `gorm:"column:created_at_ms"`
	UpdatedAtMS int64           `gorm:"column:updated_at_ms"`
	DeletedAtMS *int64          `gorm:"column:deleted_at_ms"`
}

func (noteRow) TableName() string { return "quick_notes" }

type tagRow struct {
	ID          string `gorm:"column:id;primaryKey"`
	WorkspaceID string `gorm:"column:workspace_id"`
	OwnerID     string `gorm:"column:owner_id"`
	Name        string `gorm:"column:name"`
	Version     int64  `gorm:"column:version"`
	CreatedAtMS int64  `gorm:"column:created_at_ms"`
	UpdatedAtMS int64  `gorm:"column:updated_at_ms"`
	Count       int64  `gorm:"column:count;->"`
}

func (tagRow) TableName() string { return "quick_note_tags" }
func (t tagRow) domain() quicknote.Tag {
	return quicknote.Tag{ID: t.ID, Name: t.Name, Version: t.Version, Count: t.Count, CreatedAtMS: t.CreatedAtMS, UpdatedAtMS: t.UpdatedAtMS}
}

type linkRow struct {
	WorkspaceID string `gorm:"column:workspace_id"`
	OwnerID     string `gorm:"column:owner_id"`
	NoteID      string `gorm:"column:note_id"`
	TagID       string `gorm:"column:tag_id"`
}

func (linkRow) TableName() string { return "quick_note_tag_links" }

type operationRow struct {
	WorkspaceID string          `gorm:"column:workspace_id"`
	OwnerID     string          `gorm:"column:owner_id"`
	OperationID string          `gorm:"column:operation_id"`
	RequestHash string          `gorm:"column:request_hash"`
	Result      json.RawMessage `gorm:"column:result;type:jsonb"`
	CreatedAtMS int64           `gorm:"column:created_at_ms"`
}

func (operationRow) TableName() string { return "quick_note_operations" }
func scoped(db *gorm.DB, scope quicknote.Scope) *gorm.DB {
	return db.Where("workspace_id=? AND owner_id=?", scope.WorkspaceID, scope.ActorID)
}
func missing(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return fault.Missing()
	}
	return err
}
func conflict() error {
	return fault.New(fault.Conflict, "QUICK_NOTE_VERSION_CONFLICT", "内容已在其他窗口修改，请重新加载后再保存")
}

// All personal mutations take membership locks before the scope lock, then note/tag
// rows and sorted assets. This also serializes retries of a first create operation.
func lockScope(ctx context.Context, tx *gorm.DB, scope quicknote.Scope) error {
	if err := wsstore.RequireLocked(ctx, tx, scope.WorkspaceID, scope.ActorID, workspace.Edit); err != nil {
		return err
	}
	return tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", "quicknote:"+scope.WorkspaceID+":"+scope.ActorID).Error
}
func receipt(tx *gorm.DB, scope quicknote.Scope, operation, hash string, out any) (bool, error) {
	var row operationRow
	err := scoped(tx, scope).Where("operation_id=?", operation).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if row.RequestHash != hash {
		return false, fault.New(fault.Conflict, "IDEMPOTENCY_CONFLICT", "操作 ID 已用于其他请求")
	}
	return true, json.Unmarshal(row.Result, out)
}
func recordReceipt(tx *gorm.DB, scope quicknote.Scope, operation, hash string, now int64, result any) error {
	encoded, err := json.Marshal(result)
	if err != nil {
		return err
	}
	return tx.Create(&operationRow{WorkspaceID: scope.WorkspaceID, OwnerID: scope.ActorID, OperationID: operation, RequestHash: hash, Result: encoded, CreatedAtMS: now}).Error
}
func project(tx *gorm.DB, rows []noteRow) ([]quicknote.Note, error) {
	result := make([]quicknote.Note, 0, len(rows))
	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	links := []linkRow{}
	if len(ids) > 0 {
		if err := tx.Where("note_id IN ?", ids).Order("tag_id").Find(&links).Error; err != nil {
			return nil, err
		}
	}
	tags := map[string][]string{}
	for _, l := range links {
		tags[l.NoteID] = append(tags[l.NoteID], l.TagID)
	}
	for _, row := range rows {
		n := quicknote.Note{ID: row.ID, WorkspaceID: row.WorkspaceID, OwnerID: row.OwnerID, Version: row.Version, IsPinned: row.IsPinned, CreatedAtMS: row.CreatedAtMS, UpdatedAtMS: row.UpdatedAtMS, DeletedAtMS: row.DeletedAtMS, TagIDs: []string{}}
		if err := json.Unmarshal(row.Blocks, &n.Blocks); err != nil {
			return nil, err
		}
		if v := tags[row.ID]; v != nil {
			n.TagIDs = v
		}
		result = append(result, n)
	}
	return result, nil
}
func (r *Repository) List(ctx context.Context, input quicknote.Query) ([]quicknote.Note, int64, error) {
	result := []quicknote.Note{}
	var total int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		q := scoped(tx.Model(&noteRow{}), input.Scope)
		if input.Deleted {
			q = q.Where("deleted_at_ms IS NOT NULL")
		} else {
			q = q.Where("deleted_at_ms IS NULL")
		}
		if input.Search != "" {
			escaped := strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(input.Search)
			q = q.Where("search_text ILIKE ?", "%"+escaped+"%")
		}
		if input.TagID != "" {
			q = q.Where("id IN (SELECT note_id FROM quick_note_tag_links WHERE tag_id=?)", input.TagID)
		}
		if input.Untagged {
			q = q.Where("NOT EXISTS (SELECT 1 FROM quick_note_tag_links l WHERE l.note_id=quick_notes.id)")
		}
		if err := q.Count(&total).Error; err != nil {
			return err
		}
		order := "is_pinned DESC, updated_at_ms DESC, id DESC"
		if input.Sort == "created" {
			order = "is_pinned DESC, created_at_ms DESC, id DESC"
		}
		var rows []noteRow
		if err := q.Omit("crdt_state", "search_text").Order(order).Offset(input.Page.Offset()).Limit(input.Page.Size).Find(&rows).Error; err != nil {
			return err
		}
		var err error
		result, err = project(tx, rows)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, total, err
}
func (r *Repository) Get(ctx context.Context, scope quicknote.Scope, id string) (quicknote.Note, error) {
	var result quicknote.Note
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row noteRow
		if err := scoped(tx, scope).Omit("crdt_state", "search_text").Where("id=?", id).Take(&row).Error; err != nil {
			return missing(err)
		}
		notes, err := project(tx, []noteRow{row})
		if err != nil {
			return err
		}
		result = notes[0]
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func (r *Repository) Summary(ctx context.Context, scope quicknote.Scope) (quicknote.Summary, error) {
	var result quicknote.Summary
	err := scoped(r.db.WithContext(ctx).Model(&noteRow{}), scope).Select(`COUNT(*) FILTER (WHERE deleted_at_ms IS NULL) AS total,
 COUNT(*) FILTER (WHERE deleted_at_ms IS NOT NULL) AS deleted,
 COUNT(*) FILTER (WHERE deleted_at_ms IS NULL AND NOT EXISTS (SELECT 1 FROM quick_note_tag_links l WHERE l.note_id=quick_notes.id)) AS untagged`).Scan(&result).Error
	return result, err
}
func (r *Repository) Tags(ctx context.Context, scope quicknote.Scope, page pagination.Page) ([]quicknote.Tag, int64, error) {
	result := []quicknote.Tag{}
	var total int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		q := scoped(tx.Model(&tagRow{}), scope)
		if err := q.Count(&total).Error; err != nil {
			return err
		}
		var rows []tagRow
		if err := q.Select(`quick_note_tags.*, (SELECT COUNT(*) FROM quick_note_tag_links l JOIN quick_notes n ON n.id=l.note_id WHERE l.tag_id=quick_note_tags.id AND n.deleted_at_ms IS NULL) AS count`).Order("created_at_ms,id").Offset(page.Offset()).Limit(page.Size).Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			result = append(result, row.domain())
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, total, err
}
func (r *Repository) Save(ctx context.Context, input quicknote.Commit) (quicknote.Note, error) {
	var result quicknote.Note
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockScope(ctx, tx, input.Scope); err != nil {
			return err
		}
		found, err := receipt(tx, input.Scope, input.Change.OperationID, input.Hash, &result)
		if err != nil || found {
			return err
		}
		row := noteRow{ID: uuid.NewString(), WorkspaceID: input.Scope.WorkspaceID, OwnerID: input.Scope.ActorID, Version: 1, CreatedAtMS: input.Timestamp, UpdatedAtMS: input.Timestamp}
		if input.ID != "" {
			row = noteRow{}
			if err := scoped(tx, input.Scope).Where("id=?", input.ID).Take(&row).Error; err != nil {
				return missing(err)
			}
			if row.Version != input.Change.ExpectedVersion {
				return conflict()
			}
			row.Version++
			row.UpdatedAtMS = input.Timestamp
			if row.DeletedAtMS != nil && (input.Change.IsDeleted == nil || *input.Change.IsDeleted || input.Change.Blocks != nil || input.Change.TagIDs != nil || input.Change.IsPinned != nil) {
				return fault.New(fault.Conflict, "QUICK_NOTE_DELETED", "请先恢复这条随手记")
			}
		}
		if input.Change.Blocks != nil {
			if r.engine == nil {
				return document.CollaborationUnavailable()
			}
			transformed, err := r.engine.Transform(ctx, document.CollaborationTransform{State: row.CRDTState, Blocks: input.Change.Blocks})
			if err != nil {
				return err
			}
			blocks, err := quicknote.Normalize(transformed.Blocks)
			if err != nil {
				return err
			}
			if len(transformed.State) == 0 || len(transformed.State) > document.MaxCollaborationStateBytes {
				return document.CollaborationUnavailable()
			}
			if err := requireAssets(tx, input.Scope, blocks); err != nil {
				return err
			}
			row.Blocks, err = json.Marshal(blocks)
			if err != nil {
				return err
			}
			row.CRDTState = transformed.State
			row.SearchText = quicknote.SearchText(blocks)
		}
		if input.Change.IsPinned != nil {
			row.IsPinned = *input.Change.IsPinned
		}
		if input.Change.IsDeleted != nil {
			if *input.Change.IsDeleted {
				row.DeletedAtMS = &input.Timestamp
			} else {
				row.DeletedAtMS = nil
			}
		}
		if input.ID == "" {
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
		} else {
			if err := tx.Model(&noteRow{}).Where("id=?", row.ID).Select("version", "blocks", "crdt_state", "search_text", "is_pinned", "updated_at_ms", "deleted_at_ms").Updates(&row).Error; err != nil {
				return err
			}
		}
		if input.Change.TagIDs != nil {
			ids := *input.Change.TagIDs
			var count int64
			if len(ids) > 0 {
				if err := scoped(tx.Model(&tagRow{}), input.Scope).Where("id IN ?", ids).Count(&count).Error; err != nil {
					return err
				}
			}
			if count != int64(len(ids)) {
				return fault.New(fault.NotFound, "QUICK_NOTE_TAG_NOT_FOUND", "标签不存在或不属于当前账号")
			}
			if err := tx.Where("note_id=?", row.ID).Delete(&linkRow{}).Error; err != nil {
				return err
			}
			if len(ids) > 0 {
				links := make([]linkRow, 0, len(ids))
				for _, id := range ids {
					links = append(links, linkRow{WorkspaceID: input.Scope.WorkspaceID, OwnerID: input.Scope.ActorID, NoteID: row.ID, TagID: id})
				}
				if err := tx.Create(&links).Error; err != nil {
					return err
				}
			}
		}
		notes, err := project(tx, []noteRow{row})
		if err != nil {
			return err
		}
		result = notes[0]
		return recordReceipt(tx, input.Scope, input.Change.OperationID, input.Hash, input.Timestamp, result)
	})
	return result, err
}
func requireAssets(tx *gorm.DB, scope quicknote.Scope, blocks []document.Block) error {
	refs := document.MediaReferences(blocks)
	ids := []string{}
	seen := map[string]bool{}
	for _, ref := range refs {
		if !seen[ref.ID] {
			ids = append(ids, ref.ID)
			seen[ref.ID] = true
		}
	}
	sort.Strings(ids)
	if len(ids) == 0 {
		return nil
	}
	var rows []assetstore.Record
	if err := scoped(tx, scope).Clauses(clause.Locking{Strength: "SHARE"}).Where("id IN ? AND kind='private_file' AND state='ready'", ids).Order("id").Find(&rows).Error; err != nil {
		return err
	}
	if len(rows) != len(ids) {
		return fault.New(fault.NotFound, "ASSET_REFERENCE_NOT_FOUND", "附件不存在或不属于当前账号")
	}
	media := map[string]string{}
	for _, row := range rows {
		media[row.ID] = row.MediaType
	}
	for _, ref := range refs {
		if ref.Kind != "file" && (!asset.InlineType(media[ref.ID]) || !strings.HasPrefix(media[ref.ID], ref.Kind+"/")) {
			return fault.Field("body.blocks", "附件类型与内容不匹配")
		}
	}
	return nil
}
func (r *Repository) SaveTag(ctx context.Context, input quicknote.TagCommit) (quicknote.Tag, error) {
	var result quicknote.Tag
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockScope(ctx, tx, input.Scope); err != nil {
			return err
		}
		found, err := receipt(tx, input.Scope, input.Change.OperationID, input.Hash, &result)
		if err != nil || found {
			return err
		}
		row := tagRow{ID: uuid.NewString(), WorkspaceID: input.Scope.WorkspaceID, OwnerID: input.Scope.ActorID, Version: 1, Name: input.Change.Name, CreatedAtMS: input.Timestamp, UpdatedAtMS: input.Timestamp}
		if input.ID != "" {
			row = tagRow{}
			if err := scoped(tx, input.Scope).Where("id=?", input.ID).Take(&row).Error; err != nil {
				return missing(err)
			}
			if row.Version != input.Change.ExpectedVersion {
				return conflict()
			}
			row.Name = input.Change.Name
			row.Version++
			row.UpdatedAtMS = input.Timestamp
		}
		if input.Change.Delete {
			var exhausted int64
			affected := scoped(tx.Model(&noteRow{}), input.Scope).Where("id IN (SELECT note_id FROM quick_note_tag_links WHERE tag_id=?)", row.ID)
			if err := affected.Session(&gorm.Session{}).Where("version>=?", document.MaxVersion).Count(&exhausted).Error; err != nil {
				return err
			}
			if exhausted > 0 {
				return conflict()
			}
			if err := affected.Updates(map[string]any{"version": gorm.Expr("version+1"), "updated_at_ms": input.Timestamp}).Error; err != nil {
				return err
			}
			if err := tx.Delete(&row).Error; err != nil {
				return err
			}
		} else {
			var duplicate int64
			if err := scoped(tx.Model(&tagRow{}), input.Scope).Where("lower(name)=lower(?) AND id<>?", row.Name, row.ID).Count(&duplicate).Error; err != nil {
				return err
			}
			if duplicate > 0 {
				return fault.New(fault.Conflict, "QUICK_NOTE_TAG_EXISTS", "同名标签已存在")
			}
			if input.ID == "" {
				var count int64
				if err := scoped(tx.Model(&tagRow{}), input.Scope).Count(&count).Error; err != nil {
					return err
				}
				if count >= quicknote.MaxTags {
					return fault.New(fault.Conflict, "QUICK_NOTE_TAG_LIMIT", "最多可创建 100 个标签")
				}
				if err := tx.Create(&row).Error; err != nil {
					return err
				}
			} else {
				if err := tx.Model(&row).Select("name", "version", "updated_at_ms").Updates(&row).Error; err != nil {
					return err
				}
			}
		}
		result = row.domain()
		return recordReceipt(tx, input.Scope, input.Change.OperationID, input.Hash, input.Timestamp, result)
	})
	return result, err
}
