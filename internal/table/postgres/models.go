// Package postgres persists immutable table definitions and temporal records in caller-owned transactions.
package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/table"
)

type Header struct {
	ID, WorkspaceID, DocumentID, BlockID string
	HeadVersion                          int64
	CreatedAtMS                          int64 `gorm:"column:created_at_ms"`
	UpdatedAtMS                          int64 `gorm:"column:updated_at_ms"`
}

func (Header) TableName() string { return "data_tables" }

type revisionRow struct {
	TableID     string
	Version     int64
	BaseVersion *int64
	Definition  json.RawMessage `gorm:"type:jsonb"`
	CreatedAtMS int64           `gorm:"column:created_at_ms"`
}

func (revisionRow) TableName() string { return "data_table_revisions" }

type kindRow struct{ TableID, FieldID, Kind string }

func (kindRow) TableName() string { return "data_table_field_kinds" }

type identityRow struct {
	TableID, RecordID string
	CreatedAtMS       int64 `gorm:"column:created_at_ms"`
}

func (identityRow) TableName() string { return "data_table_record_ids" }

type recordRow struct {
	TableID, RecordID string
	ValidFrom         int64
	ValidTo           *int64
	Values            json.RawMessage `gorm:"type:jsonb"`
	UpdatedAtMS       int64           `gorm:"column:updated_at_ms"`
}

func (recordRow) TableName() string { return "data_table_record_versions" }

type operationRow struct {
	DocumentID, OperationID string
	Result                  json.RawMessage `gorm:"type:jsonb"`
	CreatedAtMS             int64           `gorm:"column:created_at_ms"`
}

func (operationRow) TableName() string { return "data_table_operations" }
func missing(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return fault.Missing()
	}
	return err
}
func LoadHeader(ctx context.Context, tx *gorm.DB, scope table.Scope, lock bool) (Header, error) {
	q := tx.WithContext(ctx).Where("id=? AND workspace_id=? AND document_id=?", scope.TableID, scope.WorkspaceID, scope.DocumentID)
	if lock {
		q = q.Clauses(clause.Locking{Strength: "NO KEY UPDATE"})
	}
	var header Header
	err := q.Take(&header).Error
	return header, missing(err)
}
func Metadata(ctx context.Context, tx *gorm.DB, header Header, version, documentVersion int64) (table.Metadata, error) {
	var row revisionRow
	if err := tx.WithContext(ctx).Where("table_id=? AND version=?", header.ID, version).Take(&row).Error; err != nil {
		return table.Metadata{}, missing(err)
	}
	var definition table.Definition
	if err := json.Unmarshal(row.Definition, &definition); err != nil {
		return table.Metadata{}, err
	}
	return table.Metadata{
		TableID:        header.ID,
		BlockID:        header.BlockID,
		TableVersion:   version,
		ContentVersion: documentVersion,
		Definition:     definition,
		CreatedAtMS:    header.CreatedAtMS,
		UpdatedAtMS:    row.CreatedAtMS,
	}, nil
}
func Replay(ctx context.Context, tx *gorm.DB, did, operation string) (table.Result, error) {
	var row operationRow
	if err := tx.WithContext(ctx).Where("document_id=? AND operation_id=?", did, operation).Take(&row).Error; err != nil {
		return table.Result{}, missing(err)
	}
	var result table.Result
	err := json.Unmarshal(row.Result, &result)
	return result, err
}
func Receipt(ctx context.Context, tx *gorm.DB, did, operation string, result table.Result, now int64) error {
	data, err := json.Marshal(result)
	if err != nil {
		return err
	}
	return tx.WithContext(ctx).Create(&operationRow{DocumentID: did, OperationID: operation, Result: data, CreatedAtMS: now}).Error
}
func RequireReferences(ctx context.Context, tx *gorm.DB, wid, did string, references []table.Reference) error {
	return validateReferences(ctx, tx, wid, did, references, true)
}
func CheckReferences(ctx context.Context, tx *gorm.DB, wid, did string, references []table.Reference) error {
	return validateReferences(ctx, tx, wid, did, references, false)
}
func validateReferences(ctx context.Context, tx *gorm.DB, wid, did string, references []table.Reference, lock bool) error {
	if len(references) == 0 {
		return nil
	}
	ids := []string{}
	pairs := [][]any{}
	for _, reference := range references {
		ids = append(ids, reference.TableID)
		pairs = append(pairs, []any{reference.TableID, reference.Version})
	}
	var headers []Header
	q := tx.WithContext(ctx).Where("workspace_id=? AND document_id=? AND id IN ?", wid, did, ids).Order("id")
	if lock {
		q = q.Clauses(clause.Locking{Strength: "SHARE"})
	}
	if err := q.Find(&headers).Error; err != nil {
		return err
	}
	allowed := map[string]string{}
	for _, header := range headers {
		allowed[header.ID] = header.BlockID
	}
	seen := map[string]bool{}
	for _, reference := range references {
		if allowed[reference.TableID] != reference.BlockID || seen[reference.TableID] {
			return fault.New(fault.NotFound, "TABLE_REFERENCE_NOT_FOUND", "表格引用不属于当前文档块")
		}
		seen[reference.TableID] = true
	}
	var count int64
	if err := tx.WithContext(ctx).Model(&revisionRow{}).Where("(table_id,version) IN ?", pairs).Count(&count).Error; err != nil {
		return err
	}
	if count != int64(len(references)) {
		return fault.New(fault.NotFound, "TABLE_REFERENCE_NOT_FOUND", "引用的表格版本不存在")
	}
	return nil
}
