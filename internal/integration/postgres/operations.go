package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/internal/platform/fault"
)

type OperationRow struct {
	TokenID, OperationID, WorkspaceID string
	DocumentID                        *string
	Kind, RequestHash, State          string
	Result                            json.RawMessage `gorm:"type:jsonb"`
	CreatedAtMS, UpdatedAtMS          int64
}

func (OperationRow) TableName() string { return "integration_operations" }
func (row OperationRow) Public() integration.OperationRecord {
	return integration.OperationRecord{OperationID: row.OperationID, Kind: row.Kind, DocumentID: row.DocumentID, State: row.State, Result: row.Result, CreatedAtMS: row.CreatedAtMS, UpdatedAtMS: row.UpdatedAtMS}
}
func ReserveOperation(ctx context.Context, tx *gorm.DB, p integration.Principal, kind, id, hash string, did *string, timestamp int64) (OperationRow, error) {
	value := OperationRow{TokenID: p.Token.ID, OperationID: id, WorkspaceID: p.Token.WorkspaceID, DocumentID: did, Kind: kind, RequestHash: hash, State: "pending", CreatedAtMS: timestamp, UpdatedAtMS: timestamp}
	if err := tx.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&value).Error; err != nil {
		return value, err
	}
	var row OperationRow
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "NO KEY UPDATE"}).Where("token_id=? AND operation_id=?", p.Token.ID, id).Take(&row).Error; err != nil {
		return row, err
	}
	if row.RequestHash != hash || row.Kind != kind {
		return row, fault.New(fault.Conflict, "IDEMPOTENCY_CONFLICT", "操作 ID 已用于其他请求")
	}
	return row, nil
}
func CompleteOperation(ctx context.Context, tx *gorm.DB, p integration.Principal, id, did string, result any, timestamp int64) error {
	encoded, err := json.Marshal(result)
	if err != nil {
		return err
	}
	return tx.WithContext(ctx).Model(&OperationRow{}).Where("token_id=? AND operation_id=?", p.Token.ID, id).Updates(map[string]any{"document_id": did, "state": "completed", "result": encoded, "updated_at_ms": timestamp}).Error
}
func FindOperation(ctx context.Context, tx *gorm.DB, p integration.Principal, id string) (OperationRow, error) {
	var row OperationRow
	err := tx.WithContext(ctx).Where("token_id=? AND operation_id=? AND workspace_id=?", p.Token.ID, id, p.Token.WorkspaceID).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return row, fault.New(fault.NotFound, "OPERATION_NOT_FOUND", "集成操作回执不存在")
	}
	return row, err
}
