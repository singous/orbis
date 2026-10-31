package postgres

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/internal/sheet"
)

const MaxFormUploads = 1000

type formRow struct {
	ID, SheetID          string
	OwnerID              string
	Config               json.RawMessage
	Enabled              bool
	Nonce                string
	Version, UpdatedAtMS int64
}

func (formRow) TableName() string { return "sheet_forms" }
func (r *Repository) token(row formRow) string {
	mac := hmac.New(sha256.New, r.secret)
	mac.Write([]byte("orbis.sheet.form:" + row.ID + ":" + row.Nonce))
	return row.ID + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func (r *Repository) form(row formRow) sheet.Form {
	var config sheet.FormConfig
	_ = json.Unmarshal(row.Config, &config)
	return sheet.Form{ID: row.ID, SheetID: row.SheetID, Config: config, Enabled: row.Enabled, Version: row.Version, Token: r.token(row), Nonce: row.Nonce}
}
func (r *Repository) Forms(ctx context.Context, sc sheet.Scope) ([]sheet.Form, error) {
	if _, err := get(ctx, r.db, sc, ""); err != nil {
		return nil, err
	}
	var rows []formRow
	if err := r.db.WithContext(ctx).Where("sheet_id=?", sc.SheetID).Order("id").Find(&rows).Error; err != nil {
		return nil, err
	}
	items := []sheet.Form{}
	for _, row := range rows {
		items = append(items, r.form(row))
	}
	return items, nil
}
func validateForm(t sheet.Sheet, config sheet.FormConfig) error {
	fields := sheet.Fields(t.Definition)
	seen := map[string]bool{}
	for _, ff := range config.Fields {
		f, ok := fields[ff.FieldID]
		if !ok || sheet.Kinds[f.Kind].System || seen[ff.FieldID] || len(ff.Description) > sheet.MaxText {
			return sheet.Invalid("表单字段不可用")
		}
		seen[ff.FieldID] = true
	}
	return nil
}
func (r *Repository) SaveForm(ctx context.Context, sc sheet.Scope, in sheet.Form, now int64) (sheet.Form, error) {
	var result sheet.Form
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		t, err := get(ctx, tx, sc, "SHARE")
		if err != nil {
			return err
		}
		if err := validateForm(t, in.Config); err != nil {
			return err
		}
		var row formRow
		err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=? AND sheet_id=?", in.ID, t.ID).Take(&row).Error
		raw, _ := json.Marshal(in.Config)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if in.Version != 0 {
				return sheet.Conflict()
			}
			var count int64
			if err := tx.Model(&formRow{}).Where("sheet_id=?", t.ID).Count(&count).Error; err != nil {
				return err
			}
			if count >= 24 {
				return sheet.Invalid("表单数量超出限制")
			}
			row = formRow{ID: in.ID, SheetID: t.ID, OwnerID: sc.ActorID, Config: raw, Enabled: in.Enabled, Nonce: uuid.NewString(), Version: 1, UpdatedAtMS: now}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
		} else {
			if err != nil {
				return err
			}
			if row.Version != in.Version {
				return sheet.Conflict()
			}
			if !row.Enabled && in.Enabled {
				row.Nonce = uuid.NewString()
			}
			row.Version++
			row.Enabled = in.Enabled
			row.Config = raw
			row.UpdatedAtMS = now
			if err := tx.Save(&row).Error; err != nil {
				return err
			}
		}
		result = r.form(row)
		return nil
	})
	return result, err
}
func (r *Repository) loadPublic(ctx context.Context, tx *gorm.DB, token string, lock bool) (formRow, sheet.Sheet, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 || !sheet.ValidID(parts[0]) || len(token) > 120 {
		return formRow{}, sheet.Sheet{}, fault.Missing()
	}
	var row formRow
	q := tx.WithContext(ctx).Where("id=?", parts[0])
	if err := q.Take(&row).Error; err != nil {
		return row, sheet.Sheet{}, missing(err)
	}
	if !row.Enabled || !hmac.Equal([]byte(token), []byte(r.token(row))) {
		return row, sheet.Sheet{}, fault.Missing()
	}
	var raw sheetRow
	if err := tx.WithContext(ctx).Where("id=?", row.SheetID).Take(&raw).Error; err != nil {
		return row, sheet.Sheet{}, missing(err)
	}
	// Schema precedes form locks in every write path, matching SaveForm and Change.
	strength := ""
	if lock {
		strength = "SHARE"
	}
	t, err := get(ctx, tx, sheet.Scope{WorkspaceID: raw.WorkspaceID, SheetID: raw.ID, ActorID: row.OwnerID}, strength)
	if err != nil {
		return row, t, err
	}
	if lock {
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).Where("id=?", row.ID).Take(&row).Error; err != nil {
			return row, t, missing(err)
		}
		if !row.Enabled || !hmac.Equal([]byte(token), []byte(r.token(row))) {
			return row, t, fault.Missing()
		}
	}
	return row, t, nil
}
func (r *Repository) PublicForm(ctx context.Context, token string) (sheet.Form, sheet.Sheet, error) {
	row, t, err := r.loadPublic(ctx, r.db, token, false)
	if err != nil {
		return sheet.Form{}, t, err
	}
	form := r.form(row)
	if err := validateForm(t, form.Config); err != nil {
		return sheet.Form{}, t, sheet.Invalid("表单字段已调整，请联系创建者更新表单")
	}
	for i, field := range t.Definition.Fields {
		if field.Kind != "person" {
			continue
		}
		var people []struct{ ID, DisplayName string }
		if err := r.db.WithContext(ctx).Table("users u").Select("u.id,u.display_name").Joins("JOIN workspace_members m ON m.user_id=u.id").Where("m.workspace_id=?", t.WorkspaceID).Limit(500).Scan(&people).Error; err != nil {
			return form, t, err
		}
		t.Definition.Fields[i].Options = []sheet.Option{}
		for _, person := range people {
			t.Definition.Fields[i].Options = append(t.Definition.Fields[i].Options, sheet.Option{ID: person.ID, Label: person.DisplayName, Color: "gray"})
		}
	}
	return form, t, nil
}
func (r *Repository) Submit(ctx context.Context, token string, in sheet.Submission, now int64) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		row, t, err := r.loadPublic(ctx, tx, token, true)
		if err != nil {
			return err
		}
		actorKey := "form:" + row.ID + ":" + row.Nonce
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", t.ID+":"+in.OperationID).Error; err != nil {
			return err
		}
		var receipt struct{ ActorKey, RequestHash string }
		err = tx.Table("sheet_operations").Where("sheet_id=? AND operation_id=?", t.ID, in.OperationID).Take(&receipt).Error
		if err == nil {
			body, _ := json.Marshal([]sheet.Patch{{ID: in.OperationID, Values: in.Values}})
			if receipt.ActorKey != actorKey || receipt.RequestHash != security.Digest(string(body)) {
				return sheet.Conflict()
			}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if row.Version != in.Version {
			return sheet.Conflict()
		}
		form := r.form(row)
		if err := validateForm(t, form.Config); err != nil {
			return err
		}
		allowed := map[string]bool{}
		for _, ff := range form.Config.Fields {
			allowed[ff.FieldID] = true
			v := in.Values[ff.FieldID]
			if ff.Required && (v == nil || v == "" || (isEmptyArray(v))) {
				return sheet.Invalid("请填写所有必填项")
			}
		}
		fields := sheet.Fields(t.Definition)
		for id, value := range in.Values {
			if !allowed[id] {
				return sheet.Invalid("提交包含表单外的字段")
			}

			if sheet.Kinds[fields[id].Kind].Attachment && value != nil {
				normalized, err := sheet.NormalizeValue(fields[id], value)
				if err != nil {
					return err
				}
				if ids, ok := normalized.([]string); ok && len(ids) > 0 {
					var count int64
					if err := tx.Table("sheet_form_uploads").Where("form_id=? AND field_id=? AND nonce=? AND asset_id IN ?", row.ID, id, row.Nonce, ids).Count(&count).Error; err != nil {
						return err
					}
					if count != int64(len(ids)) {
						return sheet.Invalid("附件不属于本次表单收集")
					}
				}
			}
		}
		// The operation UUID doubles as the record UUID, making anonymous retries stable.
		_, err = change(ctx, tx, sheet.Scope{WorkspaceID: t.WorkspaceID, SheetID: t.ID}, sheet.Changes{OperationID: in.OperationID, SchemaVersion: t.SchemaVersion, Records: []sheet.Patch{{ID: in.OperationID, Values: in.Values}}}, now, "form:"+row.ID+":"+row.Nonce)
		return err
	})
}
func isEmptyArray(v any) bool {
	switch s := v.(type) {
	case []any:
		return len(s) == 0
	case []string:
		return len(s) == 0
	}
	return false
}

// UploadScope grants only a bounded upload action; it never grants public file reads.
func (r *Repository) UploadScope(ctx context.Context, token, fieldID string) (sheet.Scope, error) {
	row, t, err := r.loadPublic(ctx, r.db, token, false)
	if err != nil {
		return sheet.Scope{}, err
	}
	form := r.form(row)
	allowed := false
	for _, f := range form.Config.Fields {
		if f.FieldID == fieldID {
			allowed = true
		}
	}
	if !allowed || !sheet.Kinds[sheet.Fields(t.Definition)[fieldID].Kind].Attachment {
		return sheet.Scope{}, sheet.Invalid("该字段不允许上传")
	}
	var count int64
	if err := r.db.WithContext(ctx).Table("sheet_form_uploads").Where("form_id=? AND created_at_ms>?", row.ID, row.UpdatedAtMS-86400000).Count(&count).Error; err != nil {
		return sheet.Scope{}, err
	}
	if count >= MaxFormUploads {
		return sheet.Scope{}, sheet.Invalid("表单附件配额已用完，请联系创建者")
	}
	return sheet.Scope{WorkspaceID: t.WorkspaceID, SheetID: t.ID, ActorID: row.OwnerID}, nil
}
func (r *Repository) RegisterUpload(ctx context.Context, token, fieldID, assetID string, now int64) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		row, t, err := r.loadPublic(ctx, tx, token, true)
		if err != nil {
			return err
		}
		field, ok := sheet.Fields(t.Definition)[fieldID]
		if !ok || !sheet.Kinds[field.Kind].Attachment {
			return sheet.Invalid("字段不允许上传")
		}
		var count int64
		q := tx.Table("assets").Where("id=? AND workspace_id=? AND owner_id=? AND state='ready'", assetID, t.WorkspaceID, row.OwnerID)
		if field.Kind == "image" {
			q = q.Where("media_type LIKE 'image/%'")
		}
		if err := q.Count(&count).Error; err != nil {
			return err
		}
		if count != 1 {
			return sheet.Invalid("附件类型不符")
		}
		return tx.Table("sheet_form_uploads").Create(map[string]any{"form_id": row.ID, "field_id": fieldID, "asset_id": assetID, "nonce": row.Nonce, "created_at_ms": now}).Error
	})
}
