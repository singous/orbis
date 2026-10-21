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
	"orbis.local/orbis/internal/document/markdown"
	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/table"
	tablestore "orbis.local/orbis/internal/table/postgres"
	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
)

type Transfers struct{ db *gorm.DB }

func NewTransfers(db *gorm.DB) *Transfers { return &Transfers{db: db} }

type importRow struct {
	WorkspaceID, CollectionID, OperationID, ActorID, RequestHash, DocumentID string
	Result                                                                   json.RawMessage `gorm:"type:jsonb"`
	CreatedAtMS                                                              int64           `gorm:"column:created_at_ms"`
}

func (importRow) TableName() string { return "document_imports" }
func (r *Transfers) Import(ctx context.Context, input integration.ImportCommand) (integration.ImportResult, error) {
	var result integration.ImportResult
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		scope := input.Scope
		if err := wsstore.RequireLocked(ctx, tx, scope.WorkspaceID, scope.ActorID, workspace.Edit); err != nil {
			return err
		}
		if err := docstore.LockDirectory(ctx, tx, scope); err != nil {
			return err
		}
		var previous importRow
		err := tx.Where("workspace_id=? AND collection_id=? AND operation_id=?", scope.WorkspaceID, scope.CollectionID, input.Input.OperationID).Take(&previous).Error
		if err == nil {
			if previous.ActorID != scope.ActorID || previous.RequestHash != input.Hash {
				return fault.New(fault.Conflict, "IDEMPOTENCY_CONFLICT", "操作 ID 已用于其他请求")
			}
			if _, err := docstore.New(tx).Get(ctx, scope.WorkspaceID, previous.DocumentID); err != nil {
				return err
			}
			return json.Unmarshal(previous.Result, &result)
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		blocks, err := document.Flatten(input.Parsed.Blocks)
		if err != nil {
			return err
		}
		doc, err := docstore.InsertDocument(ctx, tx, scope.ActorID, input.Document, blocks)
		if err != nil {
			return err
		}
		references := document.MediaReferences(input.Parsed.Blocks)
		ids := make([]string, 0, len(references))
		for _, ref := range references {
			ids = append(ids, ref.ID)
		}
		media, err := assetstore.RequireFiles(ctx, tx, scope.WorkspaceID, ids)
		if err != nil {
			return err
		}
		for _, ref := range references {
			if ref.Kind != "file" && (!asset.InlineType(media[ref.ID]) || !strings.HasPrefix(media[ref.ID], ref.Kind+"/")) {
				return fault.Field("body.markdown", "图片引用的媒体类型不正确")
			}
		}
		result = integration.ImportResult{Document: doc, Warnings: input.Parsed.Warnings}
		encoded, err := json.Marshal(result)
		if err != nil {
			return err
		}
		return tx.Create(&importRow{
			WorkspaceID:  scope.WorkspaceID,
			CollectionID: scope.CollectionID,
			OperationID:  input.Input.OperationID,
			ActorID:      scope.ActorID,
			RequestHash:  input.Hash,
			DocumentID:   doc.ID,
			Result:       encoded,
			CreatedAtMS:  doc.CreatedAtMS,
		}).Error
	})
	return result, err
}
func (r *Transfers) Export(ctx context.Context, input integration.ExportQuery) (integration.ExportSnapshot, error) {
	result := integration.ExportSnapshot{Tables: map[string][]byte{}}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		scope := input.Scope
		role, err := wsstore.New(tx).Role(ctx, scope.WorkspaceID, scope.ActorID)
		if err != nil {
			return err
		}
		if !workspace.Allowed(role, workspace.Read) {
			return fault.Denied()
		}
		rev, records, err := docstore.New(tx).Read(ctx, scope.WorkspaceID, scope.DocumentID, input.Version)
		if err != nil {
			return err
		}
		blocks, err := document.Expand(records)
		if err != nil {
			return err
		}
		result.Content = document.Content{Revision: rev, Blocks: blocks}
		references := document.TableReferences(blocks)
		if len(references) > markdown.MaxExportTables {
			return markdown.ExportLimit()
		}
		rowCount, byteCount := 0, 0
		for _, ref := range references {
			tableScope := table.Scope{ActorID: scope.ActorID, WorkspaceID: scope.WorkspaceID, DocumentID: scope.DocumentID, TableID: ref.TableID}
			header, err := tablestore.LoadHeader(ctx, tx, tableScope, false)
			if err != nil {
				return err
			}
			if header.BlockID != ref.BlockID {
				return fault.Missing()
			}
			meta, err := tablestore.Metadata(ctx, tx, header, ref.Version, rev.Version)
			if err != nil {
				return err
			}
			projected, err := tablestore.Export(ctx, tx, meta, table.Query{Scope: tableScope})
			if err != nil {
				return err
			}
			rowCount += len(projected.Rows)
			if rowCount > markdown.MaxExportRecords {
				return markdown.ExportLimit()
			}
			encoded, err := table.RenderExport(projected, "markdown")
			if err != nil {
				return err
			}
			byteCount += len(encoded)
			if byteCount > markdown.MaxExportBytes {
				return markdown.ExportLimit()
			}
			result.Tables[ref.BlockID] = encoded
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
