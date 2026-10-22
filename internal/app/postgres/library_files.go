package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"orbis.local/orbis/internal/asset"
	assetstore "orbis.local/orbis/internal/asset/postgres"
	"orbis.local/orbis/internal/document"
	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/internal/integration"
	itstore "orbis.local/orbis/internal/integration/postgres"
	"orbis.local/orbis/internal/platform/fault"
)

type uploadRow struct {
	TokenID, OperationID, WorkspaceID, DocumentID, AssetID, ExpectedSHA256 string
	ExpectedSize                                                           int64
	Filename, MediaHint                                                    string
}

func (uploadRow) TableName() string { return "integration_uploads" }
func (r *Library) BeginUpload(ctx context.Context, claimed integration.Principal, did string, input integration.UploadInput, hash string, timestamp int64) (integration.UploadState, error) {
	var result integration.UploadState
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		p, err := r.tokens.RequirePrincipal(ctx, tx, claimed, []integration.Permission{integration.DocumentsWrite, integration.AssetsWrite}, true)
		if err != nil {
			return err
		}
		if _, err := r.tokens.Document(ctx, tx, p, did, false); err != nil {
			return err
		}
		op, err := itstore.ReserveOperation(ctx, tx, p, "upload", input.OperationID, hash, nil, timestamp)
		if err != nil {
			return err
		}
		if op.State == "completed" {
			var completed integration.UploadedFile
			if err := json.Unmarshal(op.Result, &completed); err != nil {
				return err
			}
			result.Completed = &completed
			return nil
		}
		var pending uploadRow
		err = tx.Where("token_id=? AND operation_id=?", p.Token.ID, input.OperationID).Take(&pending).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			id := uuid.NewString()
			row := assetstore.Record{ID: id, OwnerID: p.UserID, WorkspaceID: &p.Token.WorkspaceID, Kind: "file", State: "staging", StorageKey: id + ".blob", Filename: input.Filename, MediaType: "application/octet-stream", CreatedAtMS: timestamp, UpdatedAtMS: timestamp}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
			pending = uploadRow{TokenID: p.Token.ID, OperationID: input.OperationID, WorkspaceID: p.Token.WorkspaceID, DocumentID: did, AssetID: id, ExpectedSHA256: input.SHA256, ExpectedSize: input.SizeBytes, Filename: input.Filename, MediaHint: input.MediaHint}
			if err := tx.Create(&pending).Error; err != nil {
				return err
			}
			result.Asset = row.Domain()
			return nil
		}
		if err != nil {
			return err
		}
		var row assetstore.Record
		if err := tx.Where("id=? AND state='staging'", pending.AssetID).Take(&row).Error; err != nil {
			return err
		}
		result.Asset = row.Domain()
		return nil
	})
	return result, err
}
func (r *Library) PublishUpload(ctx context.Context, claimed integration.Principal, did string, input integration.UploadInput, hash string, write integration.UploadObject) (integration.UploadedFile, error) {
	var result integration.UploadedFile
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		p, err := r.tokens.RequirePrincipal(ctx, tx, claimed, []integration.Permission{integration.DocumentsWrite, integration.AssetsWrite}, true)
		if err != nil {
			return err
		}
		op, err := itstore.ReserveOperation(ctx, tx, p, "upload", input.OperationID, hash, nil, r.clock.Now().UnixMilli())
		if err != nil {
			return err
		}
		if op.State == "completed" {
			if _, err := r.tokens.Document(ctx, tx, p, did, false); err != nil {
				return err
			}
			return json.Unmarshal(op.Result, &result)
		}
		doc, err := r.tokens.Document(ctx, tx, p, did, false)
		if err != nil {
			return err
		}
		if _, err := docstore.LockSnapshotCollection(ctx, tx, document.DirectoryScope{WorkspaceID: p.Token.WorkspaceID, CollectionID: doc.CollectionID}); err != nil {
			return err
		}
		// Readers of this exact document finish before a content writer can take UPDATE, avoiding late FK lock inversion.
		if err := tx.Table("documents").Select("id").Where("id=? AND workspace_id=?", did, p.Token.WorkspaceID).Clauses(clause.Locking{Strength: "SHARE"}).Take(&struct{ ID string }{}).Error; err != nil {
			return err
		}
		if _, err := r.tokens.Document(ctx, tx, p, did, false); err != nil {
			return err
		}
		if err := r.tokens.CheckTokenTime(p.Token); err != nil {
			return err
		}
		var pending uploadRow
		if err := tx.Where("token_id=? AND operation_id=?", p.Token.ID, input.OperationID).Take(&pending).Error; err != nil {
			return err
		}
		var staged assetstore.Record
		if err := tx.Where("id=?", pending.AssetID).Take(&staged).Error; err != nil {
			return err
		}
		record, err := assetstore.PublishInTransaction(ctx, tx, r.clock, p.UserID, staged.ID, "file", &p.Token.WorkspaceID, func(ctx context.Context) (asset.Metadata, error) {
			metadata, err := write(ctx, staged.Domain())
			if err != nil {
				return metadata, err
			}
			if metadata.SHA256 != pending.ExpectedSHA256 || metadata.SizeBytes != pending.ExpectedSize {
				return metadata, fault.New(fault.Validation, "UPLOAD_DIGEST_MISMATCH", "附件校验失败")
			}
			if err := r.tokens.CheckTokenTime(p.Token); err != nil {
				return metadata, err
			}
			return metadata, nil
		})
		if err != nil {
			return err
		}
		now := r.clock.Now().UnixMilli()
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Table("integration_attachments").Create(map[string]any{"workspace_id": p.Token.WorkspaceID, "document_id": did, "asset_id": record.ID, "created_at_ms": now}).Error; err != nil {
			return err
		}
		result = integration.UploadedFile{FileMetadata: integration.FileInfo(record), DocumentID: did, OperationID: input.OperationID, BlockTemplate: document.Payload{Type: "file", Props: map[string]any{"source": map[string]any{"type": "asset", "asset_id": record.ID}, "name": record.Filename}, Content: []document.TextRun{}}}
		return itstore.CompleteOperation(ctx, tx, p, input.OperationID, did, result, now)
	})
	return result, err
}
func (r *Library) File(ctx context.Context, claimed integration.Principal, did, id string) (asset.Record, error) {
	var result asset.Record
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		p, err := r.tokens.RequirePrincipal(ctx, tx, claimed, []integration.Permission{integration.DocumentsRead, integration.AssetsRead}, false)
		if err != nil {
			return err
		}
		doc, err := r.tokens.Document(ctx, tx, p, did, false)
		if err != nil {
			return err
		}
		var count int64
		if err := tx.Table("integration_attachments").Where("workspace_id=? AND document_id=? AND asset_id=?", p.Token.WorkspaceID, did, id).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			referenced, err := docstore.ReferencesAsset(ctx, tx, did, doc.ContentVersion, id)
			if err == nil && !referenced {
				var linked int64
				err = tx.Table("boards b").Joins("JOIN board_element_versions e ON e.board_id=b.id").Where("b.workspace_id=? AND b.document_id=? AND e.asset_id=?", p.Token.WorkspaceID, did, id).Limit(1).Select("1").Scan(&linked).Error
				referenced = linked == 1
			}
			if err != nil {
				return err
			}
			if !referenced {
				return integration.ScopeMissing()
			}
		}
		var row assetstore.Record
		if err := tx.Where("id=? AND workspace_id=? AND kind='file' AND state='ready'", id, p.Token.WorkspaceID).Take(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return integration.ScopeMissing()
			}
			return err
		}
		result = row.Domain()
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
