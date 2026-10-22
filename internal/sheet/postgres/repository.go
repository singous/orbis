// Package postgres stores independent tables using short, caller-scoped transactions.
package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	assetstore "orbis.local/orbis/internal/asset/postgres"
	"orbis.local/orbis/internal/document"
	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/internal/sheet"
)

type Repository struct {
	db     *gorm.DB
	secret []byte
	engine document.CollaborationEngine
}

func New(db *gorm.DB, secret string, engines ...document.CollaborationEngine) *Repository {
	r := &Repository{db: db, secret: []byte(secret)}
	if len(engines) > 0 {
		r.engine = engines[0]
	}
	return r
}

type sheetRow struct {
	DocumentID                           string
	CreationHash                         string
	SchemaVersion                        int64
	ID, WorkspaceID, CollectionID, Title string
	Definition                           json.RawMessage
	Version, CreatedAtMS, UpdatedAtMS    int64
}

func (sheetRow) TableName() string { return "sheets" }
func (row sheetRow) domain() (sheet.Sheet, error) {
	var d sheet.Definition
	err := json.Unmarshal(row.Definition, &d)
	return sheet.Sheet{DocumentID: row.DocumentID, SchemaVersion: row.SchemaVersion, ID: row.ID, WorkspaceID: row.WorkspaceID, CollectionID: row.CollectionID, Title: row.Title, Definition: d, Version: row.Version, CreatedAtMS: row.CreatedAtMS, UpdatedAtMS: row.UpdatedAtMS}, err
}
func missing(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return fault.Missing()
	}
	return err
}
func get(ctx context.Context, tx *gorm.DB, sc sheet.Scope, lock string) (sheet.Sheet, error) {
	var row sheetRow
	q := tx.WithContext(ctx).Where("id=? AND workspace_id=?", sc.SheetID, sc.WorkspaceID).Where("EXISTS (SELECT 1 FROM collections c JOIN collection_groups g ON g.id=c.group_id WHERE c.id=sheets.collection_id AND c.archived_at_ms IS NULL AND g.archived_at_ms IS NULL)")
	if err := q.Take(&row).Error; err != nil {
		return sheet.Sheet{}, missing(err)
	}
	if lock != "" {
		if err := docstore.LockDocumentDirectoryForRead(ctx, tx, document.DirectoryScope{ActorID: sc.ActorID, WorkspaceID: sc.WorkspaceID, CollectionID: row.CollectionID, DocumentID: row.DocumentID}); err != nil {
			return sheet.Sheet{}, err
		}
		if err := q.Clauses(clause.Locking{Strength: lock}).Take(&row).Error; err != nil {
			return sheet.Sheet{}, missing(err)
		}
	}
	doc, err := docstore.New(tx).Get(ctx, sc.WorkspaceID, row.DocumentID)
	if err != nil {
		return sheet.Sheet{}, err
	}
	if doc.SheetID != nil && *doc.SheetID == row.ID {
		row.Title = doc.Title
	}
	t, err := row.domain()
	if err != nil {
		return t, err
	}
	var activity struct{ Revision int64 }
	if err := tx.WithContext(ctx).Table("sheet_activity").Where("sheet_id=?", row.ID).Take(&activity).Error; err != nil {
		return t, err
	}
	t.DataRevision = activity.Revision
	return t, nil
}
func (r *Repository) Get(ctx context.Context, sc sheet.Scope) (sheet.Sheet, error) {
	return get(ctx, r.db, sc, "")
}

const activeOwnerAncestors = `NOT EXISTS (WITH RECURSIVE parents AS (
SELECT id,parent_id,is_archived,1 depth FROM documents WHERE id=d.parent_id
UNION ALL SELECT p.id,p.parent_id,p.is_archived,a.depth+1 FROM documents p JOIN parents a ON p.id=a.parent_id WHERE a.depth<64
) SELECT 1 FROM parents WHERE is_archived)`

// List projects navigation metadata only; definitions are loaded on demand.
func (r *Repository) List(ctx context.Context, sc sheet.Scope, collection, cursor string) (sheet.ListPage, error) {
	result := sheet.ListPage{Items: []sheet.Summary{}}
	q := r.db.WithContext(ctx).Table("sheets").Select("sheets.id,sheets.document_id,sheets.collection_id,CASE WHEN d.sheet_id=sheets.id THEN d.title ELSE sheets.title END AS title,sheets.created_at_ms,GREATEST(sheets.updated_at_ms,a.updated_at_ms,d.updated_at_ms) AS updated_at_ms").Joins("JOIN sheet_activity a ON a.sheet_id=sheets.id").Joins("JOIN documents d ON d.id=sheets.document_id AND d.workspace_id=sheets.workspace_id").Where("sheets.workspace_id=? AND d.is_archived=FALSE", sc.WorkspaceID).Where(activeOwnerAncestors).Where("EXISTS (SELECT 1 FROM collections c JOIN collection_groups g ON g.id=c.group_id WHERE c.id=sheets.collection_id AND c.archived_at_ms IS NULL AND g.archived_at_ms IS NULL)")
	if collection != "" {
		q = q.Where("sheets.collection_id=?", collection)
	}
	if cursor != "" {
		q = q.Where("sheets.id>?", cursor)
	}
	if err := q.Order("sheets.id").Limit(sheet.PageSize + 1).Scan(&result.Items).Error; err != nil {
		return result, err
	}
	if len(result.Items) > sheet.PageSize {
		result.Items = result.Items[:sheet.PageSize]
		result.NextCursor = result.Items[len(result.Items)-1].ID
	}
	return result, nil
}

func schemaHistory(tx *gorm.DB, t sheet.Sheet) error {
	d, _ := json.Marshal(t.Definition)
	return tx.Table("sheet_schema_history").Create(map[string]any{"sheet_id": t.ID, "version": t.Version, "title": t.Title, "definition": string(d), "created_at_ms": t.UpdatedAtMS}).Error
}
func (r *Repository) Create(ctx context.Context, sc sheet.Scope, in sheet.Create, now int64) (sheet.Sheet, error) {
	var result sheet.Sheet
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Table("collections").Where("id=? AND workspace_id=? AND archived_at_ms IS NULL", in.CollectionID, sc.WorkspaceID).Count(&count).Error; err != nil {
			return err
		}
		if count != 1 {
			return fault.Missing()
		}
		body, _ := json.Marshal(in)
		creationHash := security.Digest(string(body))
		d := sheet.DefaultDefinition(in.Template)
		raw, _ := json.Marshal(d)
		ownerID := in.DocumentID
		if ownerID == "" {
			ownerID = uuid.NewString()
		} else {
			owner, err := docstore.New(tx).Get(ctx, sc.WorkspaceID, ownerID)
			if err != nil {
				return err
			}
			if owner.CollectionID != in.CollectionID {
				return fault.Missing()
			}
		}
		row := sheetRow{DocumentID: ownerID, CreationHash: creationHash, SchemaVersion: 1, ID: in.ID, WorkspaceID: sc.WorkspaceID, CollectionID: in.CollectionID, Title: in.Title, Definition: raw, Version: 1, CreatedAtMS: now, UpdatedAtMS: now}
		res := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			var err error
			result, err = get(ctx, tx, sheet.Scope{WorkspaceID: sc.WorkspaceID, SheetID: in.ID}, "")
			if err != nil {
				return err
			}
			var original sheetRow
			if err := tx.Where("id=? AND workspace_id=?", in.ID, sc.WorkspaceID).Take(&original).Error; err != nil {
				return err
			}
			if original.CreationHash != creationHash {
				return sheet.Conflict()
			}
			return nil
		}
		if err := tx.Exec("INSERT INTO sheet_activity(sheet_id,updated_at_ms) VALUES(?,?)", row.ID, now).Error; err != nil {
			return err
		}
		if in.DocumentID == "" {
			blocks, err := document.Flatten([]document.Block{{ID: uuid.NewString(), Type: "data_table", Props: map[string]any{"sheet_id": in.ID, "sheet_view_id": d.Views[0].ID}, Content: []document.TextRun{}, Children: []document.Block{}}})
			if err != nil {
				return err
			}
			_, err = docstore.InsertDocument(ctx, tx, sc.ActorID, document.Document{ID: ownerID, WorkspaceID: sc.WorkspaceID, CollectionID: in.CollectionID, Title: in.Title, SheetID: &in.ID, ParentID: in.ParentID, ContentVersion: 1, CreatedAtMS: now, UpdatedAtMS: now}, blocks)
			if err != nil {
				return err
			}
		}
		result, _ = row.domain()
		return schemaHistory(tx, result)
	})
	return result, err
}
func (r *Repository) Update(ctx context.Context, sc sheet.Scope, in sheet.Update, now int64) (sheet.Sheet, error) {
	var result sheet.Sheet
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Document metadata writes acquire document locks before sheet schema locks.
		before, err := get(ctx, tx, sc, "")
		if err != nil {
			return err
		}
		owner, err := docstore.New(tx).Get(ctx, sc.WorkspaceID, before.DocumentID)
		if err != nil {
			return err
		}
		if owner.SheetID != nil && *owner.SheetID == sc.SheetID && in.Title != owner.Title {
			command := document.CommandsInput{OperationID: uuid.NewString(), ExpectedVersion: owner.ContentVersion, Operations: []document.Operation{{Type: "update_metadata", Title: in.Title}}}
			raw, _ := json.Marshal(command)
			_, err = docstore.ApplyCommandsInTransaction(ctx, tx, document.Command{Scope: document.DirectoryScope{ActorID: sc.ActorID, WorkspaceID: sc.WorkspaceID, CollectionID: owner.CollectionID, DocumentID: owner.ID}, Input: command, RequestHash: security.Digest(string(raw)), Timestamp: now}, r.engine)
			if err != nil {
				return err
			}
		}
		current, err := get(ctx, tx, sc, "UPDATE")
		if err != nil {
			return err
		}
		if current.Version != in.Version {
			return sheet.Conflict()
		}
		old := sheet.Fields(current.Definition)
		for _, field := range in.Definition.Fields {
			if _, exists := old[field.ID]; exists {
				continue
			}
			var used bool
			if err := tx.Raw("SELECT EXISTS(SELECT 1 FROM sheet_schema_history h, jsonb_array_elements(h.definition->'fields') f WHERE h.sheet_id=? AND f->>'id'=?)", sc.SheetID, field.ID).Scan(&used).Error; err != nil {
				return err
			}
			if used {
				return sheet.Invalid("字段标识已使用，请创建新字段")
			}
		}
		for _, f := range in.Definition.Fields {
			if prev, ok := old[f.ID]; ok && prev.Kind != f.Kind {
				var count int64
				if err := tx.Table("sheet_cells").Where("sheet_id=? AND field_id=?", sc.SheetID, f.ID).Count(&count).Error; err != nil {
					return err
				}
				if count > 0 {
					return sheet.Invalid("已有数据的字段请新建目标类型字段，再转换内容")
				}
			}
		}
		// Preserve option identities while records still refer to them.
		for _, f := range in.Definition.Fields {
			if f.Kind != "select" && f.Kind != "multi_select" {
				continue
			}
			ids := []string{}
			for _, o := range f.Options {
				ids = append(ids, o.ID)
			}
			q := tx.Table("sheet_cells").Where("sheet_id=? AND field_id=? AND text_value IS NOT NULL", sc.SheetID, f.ID)
			if len(ids) > 0 {
				q = q.Where("text_value NOT IN ?", ids)
			}
			var count int64
			if err := q.Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return sheet.Invalid("仍有记录使用待删除的选项，请先调整记录")
			}
		}
		// Copy field values and their typed indexes in the same schema transaction.
		for index := range in.Definition.Fields {
			field := &in.Definition.Fields[index]
			if field.CopyFrom == "" {
				continue
			}
			source, ok := old[field.CopyFrom]
			if _, exists := old[field.ID]; !ok || exists || source.Kind != field.Kind || sheet.Kinds[field.Kind].System {
				return sheet.Invalid("复制来源字段无效")
			}
			if err := tx.Exec("UPDATE sheet_records SET values=jsonb_set(values,ARRAY[?]::text[],values->?),version=version+1,updated_at_ms=?,updated_by=? WHERE sheet_id=? AND jsonb_exists(values, ?)", field.ID, source.ID, now, sc.ActorID, sc.SheetID, source.ID).Error; err != nil {
				return err
			}
			if err := tx.Exec("INSERT INTO sheet_cells(sheet_id,record_id,field_id,ordinal,text_value,number_value) SELECT sheet_id,record_id,?,ordinal,text_value,number_value FROM sheet_cells WHERE sheet_id=? AND field_id=?", field.ID, sc.SheetID, source.ID).Error; err != nil {
				return err
			}
			operation := uuid.NewString()
			if err := tx.Exec("INSERT INTO sheet_record_history(sheet_id,record_id,version,operation_id,values,actor_id,created_at_ms) SELECT sheet_id,id,version,?,values,?,? FROM sheet_records WHERE sheet_id=? AND jsonb_exists(values, ?) ON CONFLICT DO NOTHING", operation, sc.ActorID, now, sc.SheetID, source.ID).Error; err != nil {
				return err
			}
			field.CopyFrom = ""
		}
		result = current
		beforeFields, _ := json.Marshal(current.Definition.Fields)
		afterFields, _ := json.Marshal(in.Definition.Fields)
		if string(beforeFields) != string(afterFields) {
			result.SchemaVersion++
		}
		result.Title = in.Title
		result.Definition = in.Definition
		result.Version++
		result.UpdatedAtMS = now
		raw, _ := json.Marshal(in.Definition)
		if err := tx.Model(&sheetRow{}).Where("id=?", sc.SheetID).Updates(map[string]any{"title": in.Title, "definition": string(raw), "version": result.Version, "schema_version": result.SchemaVersion, "updated_at_ms": now}).Error; err != nil {
			return err
		}
		return schemaHistory(tx, result)
	})
	return result, err
}

type recordRow struct {
	SheetID, ID              string
	Position                 int64 `gorm:"default:(-)"`
	Version                  int64
	Values                   json.RawMessage
	CreatedBy, UpdatedBy     *string
	CreatedAtMS, UpdatedAtMS int64
}

func (recordRow) TableName() string { return "sheet_records" }
func (row recordRow) domain(d sheet.Definition) sheet.Record {
	values := map[string]any{}
	_ = json.Unmarshal(row.Values, &values)
	out := map[string]any{}
	for _, f := range d.Fields {
		switch f.Kind {
		case "created_by":
			out[f.ID] = row.CreatedBy
		case "updated_by":
			out[f.ID] = row.UpdatedBy
		case "created_at":
			out[f.ID] = row.CreatedAtMS
		case "updated_at":
			out[f.ID] = row.UpdatedAtMS
		default:
			out[f.ID] = values[f.ID]
		}
	}
	return sheet.Record{ID: row.ID, Version: row.Version, Position: row.Position, Values: out, CreatedBy: row.CreatedBy, UpdatedBy: row.UpdatedBy, CreatedAtMS: row.CreatedAtMS, UpdatedAtMS: row.UpdatedAtMS}
}

type cellRow struct {
	SheetID, RecordID, FieldID string
	Ordinal                    int
	TextValue                  *string
	NumberValue                *float64
}

func (cellRow) TableName() string { return "sheet_cells" }
func indexRecord(tx *gorm.DB, t sheet.Sheet, row recordRow, values, patch map[string]any) error {
	ids := []string{}
	for id := range patch {
		ids = append(ids, id)
	}
	if len(ids) > 0 {
		if err := tx.Where("sheet_id=? AND record_id=? AND field_id IN ?", t.ID, row.ID, ids).Delete(&cellRow{}).Error; err != nil {
			return err
		}
	}
	cells := []cellRow{}
	assets := map[string]bool{}
	images := map[string]bool{}
	people := map[string]bool{}
	for _, field := range t.Definition.Fields {
		value := values[field.ID]
		if value == nil || sheet.Kinds[field.Kind].System {
			continue
		}
		items := []any{value}
		if sheet.Kinds[field.Kind].Multiple {
			switch list := value.(type) {
			case []string:
				items = nil
				for _, v := range list {
					items = append(items, v)
				}
			case []any:
				items = list
			}
		}
		for index, item := range items {
			text := fmt.Sprint(item)
			if sheet.Kinds[field.Kind].Attachment {
				assets[text] = true
				if field.Kind == "image" {
					images[text] = true
				}
			}
			if _, changed := patch[field.ID]; !changed {
				continue
			}
			if field.Kind == "person" {
				people[text] = true
			}
			cell := cellRow{SheetID: t.ID, RecordID: row.ID, FieldID: field.ID, Ordinal: index}
			if sheet.Kinds[field.Kind].Numeric {
				number, ok := item.(float64)
				if !ok {
					return sheet.Invalid("数值字段内容无效")
				}
				cell.NumberValue = &number
			} else {
				cell.TextValue = &text
			}
			cells = append(cells, cell)
		}
	}
	if len(people) > 0 {
		ids := []string{}
		for id := range people {
			ids = append(ids, id)
		}
		var count int64
		if err := tx.Table("workspace_members").Where("workspace_id=? AND user_id IN ?", t.WorkspaceID, ids).Count(&count).Error; err != nil {
			return err
		}
		if count != int64(len(ids)) {
			return sheet.Invalid("所选人员不属于当前工作空间")
		}
	}
	assetIDs := []string{}
	for id := range assets {
		assetIDs = append(assetIDs, id)
	}
	media, err := assetstore.RequireFiles(tx.Statement.Context, tx, t.WorkspaceID, assetIDs)
	if err != nil {
		return err
	}
	for id := range images {
		if !strings.HasPrefix(media[id], "image/") {
			return sheet.Invalid("图片字段需要图片文件")
		}
	}
	if len(cells) > 0 {
		if err := tx.CreateInBatches(cells, 250).Error; err != nil {
			return err
		}
	}
	if err := tx.Exec("DELETE FROM sheet_asset_references WHERE sheet_id=? AND record_id=?", t.ID, row.ID).Error; err != nil {
		return err
	}
	refs := []map[string]any{}
	for _, id := range assetIDs {
		refs = append(refs, map[string]any{"sheet_id": t.ID, "record_id": row.ID, "asset_id": id})
	}
	if len(refs) > 0 {
		return tx.Table("sheet_asset_references").Create(refs).Error
	}
	return nil
}

func history(tx *gorm.DB, row recordRow, operation string, deleted bool, actor *string, now int64) error {
	return tx.Table("sheet_record_history").Create(map[string]any{"sheet_id": row.SheetID, "record_id": row.ID, "version": row.Version, "operation_id": operation, "values": string(row.Values), "deleted": deleted, "actor_id": actor, "created_at_ms": now}).Error
}
func change(ctx context.Context, tx *gorm.DB, sc sheet.Scope, in sheet.Changes, now int64, actorKey string) (sheet.ChangeResult, error) {
	result := sheet.ChangeResult{Records: []sheet.Record{}, Deleted: []string{}}
	countDelta := int64(0)
	// A shared schema lock permits independent record writers and excludes schema edits.
	t, err := get(ctx, tx, sc, "SHARE")
	if err != nil {
		return result, err
	}
	body, _ := json.Marshal(in)
	if strings.HasPrefix(actorKey, "form:") {
		body, _ = json.Marshal(in.Records)
	}
	hash := security.Digest(string(body))
	if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", sc.SheetID+":"+in.OperationID).Error; err != nil {
		return result, err
	}
	var receipt struct {
		ActorKey, RequestHash string
		Result                json.RawMessage
	}
	e := tx.Table("sheet_operations").Where("sheet_id=? AND operation_id=?", sc.SheetID, in.OperationID).Take(&receipt).Error
	if e == nil {
		if receipt.ActorKey != actorKey || receipt.RequestHash != hash {
			return result, sheet.Conflict()
		}
		err = json.Unmarshal(receipt.Result, &result)
		return result, err
	}
	if !errors.Is(e, gorm.ErrRecordNotFound) {
		return result, e
	}
	if in.SchemaVersion != t.SchemaVersion {
		return result, sheet.Conflict()
	}
	patches := append([]sheet.Patch{}, in.Records...)
	sort.Slice(patches, func(i, j int) bool { return patches[i].ID < patches[j].ID })
	var actor *string
	if sc.ActorID != "" {
		actor = &sc.ActorID
	}
	for _, p := range patches {
		var row recordRow
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("sheet_id=? AND id=?", t.ID, p.ID).Take(&row).Error
		fresh := errors.Is(err, gorm.ErrRecordNotFound)
		if err != nil && !fresh {
			return result, err
		}
		if fresh && p.Version != 0 || !fresh && p.Version != row.Version {
			return result, sheet.Conflict()
		}
		if fresh {
			var used int64
			if err := tx.Table("sheet_record_history").Where("sheet_id=? AND record_id=?", t.ID, p.ID).Count(&used).Error; err != nil {
				return result, err
			}
			if used > 0 || p.Delete {
				return result, sheet.Conflict()
			}
			row = recordRow{SheetID: t.ID, ID: p.ID, Version: 0, CreatedBy: actor, CreatedAtMS: now}
		}
		row.Version++
		row.UpdatedAtMS = now
		row.UpdatedBy = actor
		if p.Delete {
			if err := history(tx, row, in.OperationID, true, actor, now); err != nil {
				return result, err
			}
			if err := tx.Delete(&row, "sheet_id=? AND id=?", t.ID, p.ID).Error; err != nil {
				return result, err
			}
			countDelta--
			result.Deleted = append(result.Deleted, p.ID)
			continue
		}
		patch, err := sheet.NormalizeValues(t.Definition, p.Values, fresh)
		if err != nil {
			return result, err
		}
		values := map[string]any{}
		if !fresh {
			if err := json.Unmarshal(row.Values, &values); err != nil {
				return result, err
			}
		}
		for k, v := range patch {
			values[k] = v
		}
		raw, _ := json.Marshal(values)
		if len(raw) > sheet.MaxRecordBytes {
			return result, sheet.Invalid("记录超出大小限制")
		}
		row.Values = raw
		if fresh {
			if err := tx.Create(&row).Error; err != nil {
				return result, err
			}
			countDelta++
		} else {
			if err := tx.Model(&recordRow{}).Where("sheet_id=? AND id=?", t.ID, row.ID).Updates(map[string]any{"values": string(raw), "version": row.Version, "updated_by": actor, "updated_at_ms": now}).Error; err != nil {
				return result, err
			}
		}
		if err := indexRecord(tx, t, row, values, patch); err != nil {
			return result, err
		}
		if err := history(tx, row, in.OperationID, false, actor, now); err != nil {
			return result, err
		}
		result.Records = append(result.Records, row.domain(t.Definition))
	}
	if err := tx.Exec("UPDATE sheet_activity SET revision=revision+1,record_count=record_count+?,updated_at_ms=? WHERE sheet_id=?", countDelta, now, t.ID).Error; err != nil {
		return result, err
	}
	raw, _ := json.Marshal(result)
	err = tx.Table("sheet_operations").Create(map[string]any{"sheet_id": t.ID, "operation_id": in.OperationID, "actor_key": actorKey, "request_hash": hash, "result": string(raw), "created_at_ms": now}).Error
	return result, err
}
func (r *Repository) Change(ctx context.Context, sc sheet.Scope, in sheet.Changes, now int64) (sheet.ChangeResult, error) {
	var result sheet.ChangeResult
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		result, err = change(ctx, tx, sc, in, now, sc.ActorID)
		return err
	})
	return result, err
}

var _ sheet.Repository = (*Repository)(nil)
