package postgres

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"orbis.local/orbis/internal/asset"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/document/markdown"
	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/internal/integration"
	itstore "orbis.local/orbis/internal/integration/postgres"
	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/database"
	"orbis.local/orbis/internal/platform/fault"
)

const importRetention = 7 * 24 * time.Hour

type Imports struct {
	db      *gorm.DB
	library *Library
	objects asset.Store
	clock   clock.Clock
}

func NewImports(db *gorm.DB, library *Library, objects asset.Store, c clock.Clock) *Imports {
	return &Imports{db: db, library: library, objects: objects, clock: c}
}

type stagedImportRow struct {
	ID, TokenID, OperationID, WorkspaceID, CollectionID, Title, ExpectedSHA256, State string
	ParentID, ProcessingID, ErrorCode                                                 *string
	SizeBytes, ReceivedBytes, CreatedAtMS, UpdatedAtMS                                int64
	ExpiresAtMS                                                                       *int64
	Result                                                                            json.RawMessage `gorm:"type:jsonb"`
}

func (stagedImportRow) TableName() string { return "integration_imports" }

type importChunk struct {
	ImportID               string
	OffsetBytes, SizeBytes int64
	SHA256, StorageKey     string
}

func (importChunk) TableName() string { return "integration_import_chunks" }
func (row stagedImportRow) public() (integration.ImportStatus, error) {
	result := integration.ImportStatus{ID: row.ID, OperationID: row.OperationID, CollectionID: row.CollectionID, State: row.State, SizeBytes: row.SizeBytes, ReceivedBytes: row.ReceivedBytes, ChunkBytes: integration.MaxImportChunkBytes, ErrorCode: row.ErrorCode, CreatedAtMS: row.CreatedAtMS, UpdatedAtMS: row.UpdatedAtMS, ExpiresAtMS: row.ExpiresAtMS}
	if row.Result != nil {
		result.Result = &integration.CreatedDocument{}
		if err := json.Unmarshal(row.Result, result.Result); err != nil {
			return result, err
		}
	}
	return result, nil
}
func (r *Imports) scope(ctx context.Context, tx *gorm.DB, p integration.Principal, row stagedImportRow, lock bool) error {
	if p.Token.DocumentID != nil || (p.Token.CollectionID != nil && *p.Token.CollectionID != row.CollectionID) {
		return integration.ScopeMissing()
	}
	scope := document.DirectoryScope{ActorID: p.UserID, WorkspaceID: p.Token.WorkspaceID, CollectionID: row.CollectionID}
	if lock {
		if _, err := docstore.LockSnapshotCollection(ctx, tx, scope); err != nil {
			return err
		}
	} else {
		if _, err := docstore.New(tx).Collection(ctx, scope); err != nil {
			return err
		}
	}
	if row.ParentID != nil {
		doc, err := docstore.New(tx).Get(ctx, p.Token.WorkspaceID, *row.ParentID)
		if err != nil {
			return err
		}
		if doc.CollectionID != row.CollectionID {
			return integration.ScopeMissing()
		}
	}
	return r.library.tokens.CheckTokenTime(p.Token)
}
func advisoryKey(value string) int64 {
	sum := sha256.Sum256([]byte(value))
	return int64(binary.BigEndian.Uint64(sum[:8]))
}
func (r *Imports) BeginImport(ctx context.Context, claimed integration.Principal, input integration.StagedImportInput, hash string, timestamp int64) (integration.ImportStatus, error) {
	var row stagedImportRow
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		p, err := r.library.tokens.RequirePrincipal(ctx, tx, claimed, []integration.Permission{integration.DocumentsWrite}, true)
		if err != nil {
			return err
		}
		expires := timestamp + importRetention.Milliseconds()
		row = stagedImportRow{ID: uuid.NewString(), TokenID: p.Token.ID, OperationID: input.OperationID, WorkspaceID: p.Token.WorkspaceID, CollectionID: input.CollectionID, ParentID: input.ParentID, Title: input.Title, ExpectedSHA256: input.SHA256, SizeBytes: input.SizeBytes, State: "uploading", CreatedAtMS: timestamp, UpdatedAtMS: timestamp, ExpiresAtMS: &expires}
		op, err := itstore.ReserveOperation(ctx, tx, p, "import", input.OperationID, hash, nil, timestamp)
		if err != nil {
			return err
		}
		if err := r.scope(ctx, tx, p, row, true); err != nil {
			return err
		}
		var existing stagedImportRow
		err = tx.Where("token_id=? AND operation_id=?", p.Token.ID, input.OperationID).Take(&existing).Error
		if err == nil {
			row = existing
			if row.State == "completed" {
				status, err := row.public()
				if err != nil {
					return err
				}
				if status.Result == nil {
					return fault.Missing()
				}
				if _, err := r.library.tokens.Document(ctx, tx, p, status.Result.DocumentID, false); err != nil {
					return err
				}
			}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if op.State != "pending" {
			return fault.Missing()
		}
		var admitted bool
		if err := tx.Raw("SELECT pg_try_advisory_xact_lock(?)", advisoryKey("import-admission:"+p.Token.ID)).Scan(&admitted).Error; err != nil {
			return err
		}
		if !admitted {
			return fault.New(fault.Unavailable, "IMPORT_BUSY", "导入创建繁忙，请稍后重试")
		}
		var count int64
		if err := tx.Model(&stagedImportRow{}).Where("token_id=? AND state IN ? AND (expires_at_ms IS NULL OR expires_at_ms>?)", p.Token.ID, []string{"uploading", "queued", "processing"}, timestamp).Count(&count).Error; err != nil {
			return err
		}
		if count >= integration.MaxPendingImports {
			return fault.New(fault.Conflict, "IMPORT_PENDING_LIMIT", "未完成的导入已达到上限")
		}
		return tx.Create(&row).Error
	})
	if err != nil {
		return integration.ImportStatus{}, err
	}
	return row.public()
}

// locked obtains the global operation lock before the import row, matching worker completion.
func (r *Imports) locked(ctx context.Context, tx *gorm.DB, claimed integration.Principal, id string, write bool) (integration.Principal, stagedImportRow, error) {
	permission := integration.DocumentsRead
	if write {
		permission = integration.DocumentsWrite
	}
	p, err := r.library.tokens.RequirePrincipal(ctx, tx, claimed, []integration.Permission{permission}, write)
	if err != nil {
		return p, stagedImportRow{}, err
	}
	var row stagedImportRow
	if err := tx.Where("id=? AND token_id=? AND workspace_id=?", id, p.Token.ID, p.Token.WorkspaceID).Take(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			err = fault.Missing()
		}
		return p, row, err
	}
	if write {
		var op itstore.OperationRow
		if err := tx.Clauses(clause.Locking{Strength: "NO KEY UPDATE"}).Where("token_id=? AND operation_id=?", p.Token.ID, row.OperationID).Take(&op).Error; err != nil {
			return p, row, err
		}
		if err := tx.Clauses(clause.Locking{Strength: "NO KEY UPDATE"}).Where("id=?", id).Take(&row).Error; err != nil {
			return p, row, err
		}
	}
	if err := r.scope(ctx, tx, p, row, false); err != nil {
		return p, row, err
	}
	if row.State == "completed" {
		status, err := row.public()
		if err != nil {
			return p, row, err
		}
		if status.Result == nil {
			return p, row, fault.Missing()
		}
		if _, err := r.library.tokens.Document(ctx, tx, p, status.Result.DocumentID, false); err != nil {
			return p, row, err
		}
	}
	return p, row, nil
}
func (r *Imports) ImportStatus(ctx context.Context, p integration.Principal, id string) (integration.ImportStatus, error) {
	var row stagedImportRow
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error { var err error; _, row, err = r.locked(ctx, tx, p, id, false); return err }, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return integration.ImportStatus{}, err
	}
	return row.public()
}
func (r *Imports) WriteImportChunk(ctx context.Context, p integration.Principal, id string, offset int64, data []byte, digest string) (integration.ImportStatus, error) {
	var row stagedImportRow
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		principal, current, err := r.locked(ctx, tx, p, id, true)
		if err != nil {
			return err
		}
		row = current
		if err := r.scope(ctx, tx, principal, row, true); err != nil {
			return err
		}
		if row.State != "uploading" {
			return fault.New(fault.Conflict, "IMPORT_NOT_UPLOADING", "导入已结束上传")
		}
		if row.ExpiresAtMS != nil && *row.ExpiresAtMS <= r.clock.Now().UnixMilli() {
			return fault.New(fault.Conflict, "IMPORT_EXPIRED", "暂存导入已过期")
		}
		var old importChunk
		err = tx.Where("import_id=? AND offset_bytes=?", id, offset).Take(&old).Error
		if err == nil {
			if old.SHA256 != digest || old.SizeBytes != int64(len(data)) {
				return fault.New(fault.Conflict, "IMPORT_CHUNK_CONFLICT", "该偏移已保存其他数据")
			}
			return r.writeChunk(ctx, old.StorageKey, data, digest)
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if int64(len(data)) != min(integration.MaxImportChunkBytes, row.SizeBytes-offset) {
			return fault.Field("body", "需要从已接收偏移按声明块大小上传，最后一块可以较短")
		}
		if offset != row.ReceivedBytes || offset+int64(len(data)) > row.SizeBytes {
			return fault.New(fault.Conflict, "IMPORT_OFFSET_CONFLICT", "请从已接收字节数继续上传")
		}
		key, err := integration.ImportChunkKey(id, offset)
		if err != nil {
			return err
		}
		if err := r.writeChunk(ctx, key, data, digest); err != nil {
			return err
		}
		if err := r.library.tokens.CheckTokenTime(principal.Token); err != nil {
			return err
		}
		chunk := importChunk{ImportID: id, OffsetBytes: offset, SizeBytes: int64(len(data)), SHA256: digest, StorageKey: key}
		if err := tx.Create(&chunk).Error; err != nil {
			return err
		}
		row.ReceivedBytes += int64(len(data))
		row.UpdatedAtMS = r.clock.Now().UnixMilli()
		return tx.Model(&stagedImportRow{}).Where("id=?", id).Updates(map[string]any{"received_bytes": row.ReceivedBytes, "updated_at_ms": row.UpdatedAtMS}).Error
	})
	if err != nil {
		return integration.ImportStatus{}, err
	}
	return row.public()
}
func (r *Imports) writeChunk(ctx context.Context, key string, data []byte, digest string) error {
	file, err := r.objects.Open(ctx, key)
	if err == nil {
		sum := sha256.New()
		size, readErr := io.Copy(sum, io.LimitReader(file, integration.MaxImportChunkBytes+1))
		closeErr := file.Close()
		if readErr == nil && closeErr == nil && size == int64(len(data)) && hex.EncodeToString(sum.Sum(nil)) == digest {
			return nil
		}
		if readErr != nil || closeErr != nil {
			return errors.Join(readErr, closeErr)
		}
		// The import row is locked and this deterministic key is not yet recorded; recover only its incomplete object.
		if err := r.objects.Remove(ctx, key); err != nil {
			return err
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	size, actual, err := r.objects.Put(ctx, key, bytes.NewReader(data), integration.MaxImportChunkBytes)
	if err != nil {
		return err
	}
	if size != int64(len(data)) || actual != digest {
		return fault.New(fault.Validation, "IMPORT_SOURCE_CORRUPT", "导入分块校验失败")
	}
	return nil
}
func (r *Imports) FinalizeImport(ctx context.Context, p integration.Principal, id string) (integration.ImportStatus, error) {
	var row stagedImportRow
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		_, current, err := r.locked(ctx, tx, p, id, true)
		if err != nil {
			return err
		}
		row = current
		if row.State != "uploading" {
			return nil
		}
		if row.ExpiresAtMS != nil && *row.ExpiresAtMS <= r.clock.Now().UnixMilli() {
			return fault.New(fault.Conflict, "IMPORT_EXPIRED", "暂存导入已过期")
		}
		if row.ReceivedBytes != row.SizeBytes {
			return fault.New(fault.Conflict, "IMPORT_INCOMPLETE", "分块尚未上传完整")
		}
		row.State = "queued"
		row.UpdatedAtMS = r.clock.Now().UnixMilli()
		if err := tx.Model(&stagedImportRow{}).Where("id=?", id).Updates(map[string]any{"state": row.State, "updated_at_ms": row.UpdatedAtMS}).Error; err != nil {
			return err
		}
		return tx.Table("integration_import_outbox").Create(map[string]any{"import_id": id, "created_at_ms": row.UpdatedAtMS}).Error
	})
	if err != nil {
		return integration.ImportStatus{}, err
	}
	return row.public()
}

// ProcessImport owns one advisory transaction for codec admission. It deliberately holds no row locks while parsing;
// short state and final content transactions use other pool connections and revalidate authorization independently.
func (r *Imports) ProcessImport(ctx context.Context, id string) error {
	return database.WithAdvisoryOwner(ctx, r.db, advisoryKey("import-codec:"+id), func() error {
		var row stagedImportRow
		if err := r.db.WithContext(ctx).Where("id=?", id).Take(&row).Error; err != nil {
			return err
		}
		if row.State == "completed" || row.State == "failed" {
			return nil
		}
		if row.State != "queued" && row.State != "processing" {
			return errors.New("import not queued")
		}
		var token itstore.TokenRow
		if err := r.db.WithContext(ctx).Where("id=?", row.TokenID).Take(&token).Error; err != nil {
			return err
		}
		claimed := integration.Principal{UserID: token.OwnerID, Token: integration.Token{ID: row.TokenID, WorkspaceID: row.WorkspaceID}}
		fence := uuid.NewString()
		err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			_, current, err := r.locked(ctx, tx, claimed, id, true)
			if err != nil {
				return err
			}
			row = current
			if row.ExpiresAtMS != nil && *row.ExpiresAtMS <= r.clock.Now().UnixMilli() {
				return fault.New(fault.Conflict, "IMPORT_EXPIRED", "暂存导入已过期")
			}
			if row.State == "completed" || row.State == "failed" {
				return nil
			}
			return tx.Model(&stagedImportRow{}).Where("id=?", id).Updates(map[string]any{"state": "processing", "processing_id": fence, "updated_at_ms": r.clock.Now().UnixMilli()}).Error
		})
		if err != nil {
			return r.importFailure(ctx, id, nil, err)
		}
		if row.State == "completed" || row.State == "failed" {
			return nil
		}
		source, err := r.readImportSource(ctx, row)
		if err != nil {
			return r.importFailure(ctx, id, &fence, err)
		}
		parsed, err := markdown.ParseWithLimit(ctx, string(source), row.WorkspaceID, int(integration.MaxStagedImportBytes))
		if err != nil {
			return r.importFailure(ctx, id, &fence, err)
		}
		err = r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			p, current, err := r.locked(ctx, tx, claimed, id, true)
			if err != nil {
				return err
			}
			if current.State == "completed" {
				return nil
			}
			if current.State != "processing" || current.ProcessingID == nil || *current.ProcessingID != fence {
				return errors.New("import processing ownership changed")
			}
			timestamp := r.clock.Now().UnixMilli()
			if current.ExpiresAtMS != nil && *current.ExpiresAtMS <= timestamp {
				return fault.New(fault.Conflict, "IMPORT_EXPIRED", "暂存导入已过期")
			}
			input := integration.CreateDocumentInput{OperationID: row.OperationID, CollectionID: row.CollectionID, ParentID: row.ParentID, Title: row.Title}
			result, err := r.library.createDocumentInTransaction(ctx, tx, p, input, parsed, timestamp)
			if err != nil {
				return err
			}
			if err := itstore.CompleteOperation(ctx, tx, p, row.OperationID, result.DocumentID, result, timestamp); err != nil {
				return err
			}
			encoded, err := json.Marshal(result)
			if err != nil {
				return err
			}
			return tx.Model(&stagedImportRow{}).Where("id=? AND processing_id=?", id, fence).Updates(map[string]any{"state": "completed", "result": encoded, "updated_at_ms": timestamp}).Error
		})
		if err != nil {
			return r.importFailure(ctx, id, &fence, err)
		}
		return nil
	})
}
func (r *Imports) readImportSource(ctx context.Context, row stagedImportRow) ([]byte, error) {
	var chunks []importChunk
	if err := r.db.WithContext(ctx).Where("import_id=?", row.ID).Order("offset_bytes").Limit(int(integration.MaxStagedImportBytes/integration.MaxImportChunkBytes) + 1).Find(&chunks).Error; err != nil {
		return nil, err
	}
	var output bytes.Buffer
	full := sha256.New()
	for _, chunk := range chunks {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if chunk.OffsetBytes != int64(output.Len()) || chunk.SizeBytes < 1 || chunk.SizeBytes > integration.MaxImportChunkBytes || int64(output.Len())+chunk.SizeBytes > row.SizeBytes {
			return nil, corruptImport()
		}
		file, err := r.objects.Open(ctx, chunk.StorageKey)
		if err != nil {
			return nil, err
		}
		data, readErr := io.ReadAll(io.LimitReader(file, chunk.SizeBytes+1))
		closeErr := file.Close()
		if err := errors.Join(readErr, closeErr); err != nil {
			return nil, err
		}
		sum := sha256.Sum256(data)
		if int64(len(data)) != chunk.SizeBytes || hex.EncodeToString(sum[:]) != chunk.SHA256 {
			return nil, corruptImport()
		}
		output.Write(data)
		full.Write(data)
	}
	if int64(output.Len()) != row.SizeBytes || hex.EncodeToString(full.Sum(nil)) != row.ExpectedSHA256 {
		return nil, corruptImport()
	}
	return output.Bytes(), nil
}
func corruptImport() error {
	return fault.New(fault.Validation, "IMPORT_SOURCE_CORRUPT", "导入源数据摘要不匹配")
}
func (r *Imports) importFailure(ctx context.Context, id string, fence *string, cause error) error {
	var business *fault.Error
	if !errors.As(cause, &business) {
		return cause
	}
	// Persist only declared public codes; SQL errors and credential-bearing causes remain private and retryable.
	code := business.Code
	q := r.db.WithContext(ctx).Model(&stagedImportRow{}).Where("id=? AND state IN ?", id, []string{"queued", "processing"})
	if fence != nil {
		q = q.Where("processing_id=?", *fence)
	}
	return q.Updates(map[string]any{"state": "failed", "error_code": code, "updated_at_ms": r.clock.Now().UnixMilli()}).Error
}

// DispatchImports serializes each outbox item through bounded queue I/O and rotates observations fairly.
// Only an authoritative queue inspection may decide that dispatched work needs rescheduling.
func (r *Imports) DispatchImports(ctx context.Context, dispatch func(context.Context, string, bool) error) error {
	for range 20 {
		found := false
		err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var row struct {
				ImportID       string
				DispatchedAtMS *int64
			}
			err := tx.Table("integration_import_outbox o").Select("o.import_id,o.dispatched_at_ms").Joins("JOIN integration_imports i ON i.id=o.import_id").Where("i.state IN ? AND o.checked_at_ms<=?", []string{"queued", "processing"}, r.clock.Now().Add(-time.Second).UnixMilli()).Order("o.checked_at_ms,o.created_at_ms,o.import_id").Clauses(clause.Locking{Strength: "UPDATE", Table: clause.Table{Name: "o"}, Options: "SKIP LOCKED"}).Take(&row).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			if err != nil {
				return err
			}
			found = true
			attempt, cancel := context.WithTimeout(ctx, 3*time.Second)
			defer cancel()
			if err := dispatch(attempt, row.ImportID, row.DispatchedAtMS != nil); err != nil {
				return err
			}
			now := r.clock.Now().UnixMilli()
			return tx.Table("integration_import_outbox").Where("import_id=?", row.ImportID).Updates(map[string]any{"dispatched_at_ms": now, "checked_at_ms": now}).Error
		})
		if err != nil {
			return err
		}
		if !found {
			return nil
		}
	}
	return nil
}

// Cleanup retains receipts while reclaiming expired source bytes, including deterministic objects left by rolled-back chunks.
func (r *Imports) Cleanup(ctx context.Context) (int, error) {
	var candidates []stagedImportRow
	if err := r.db.WithContext(ctx).Where("expires_at_ms<=? AND purged_at_ms IS NULL", r.clock.Now().UnixMilli()).Order("expires_at_ms,id").Limit(10).Find(&candidates).Error; err != nil {
		return 0, err
	}
	count := 0
	for _, candidate := range candidates {
		purged := false
		err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var admitted bool
			if err := tx.Raw("SELECT pg_try_advisory_xact_lock(?)", advisoryKey("import-codec:"+candidate.ID)).Scan(&admitted).Error; err != nil {
				return err
			}
			if !admitted {
				return nil
			}
			var row stagedImportRow
			err := tx.Clauses(clause.Locking{Strength: "NO KEY UPDATE", Options: "SKIP LOCKED"}).Where("id=? AND expires_at_ms<=? AND purged_at_ms IS NULL", candidate.ID, r.clock.Now().UnixMilli()).Take(&row).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			if err != nil {
				return err
			}
			// Expired sources cannot accept new chunks or complete. Advisory ownership excludes any in-flight codec.
			var chunks []importChunk
			if err := tx.Where("import_id=?", row.ID).Limit(int(integration.MaxStagedImportBytes/integration.MaxImportChunkBytes) + 2).Find(&chunks).Error; err != nil {
				return err
			}
			keys := map[string]bool{}
			for _, chunk := range chunks {
				keys[chunk.StorageKey] = true
			}
			if row.ReceivedBytes < row.SizeBytes {
				key, err := integration.ImportChunkKey(row.ID, row.ReceivedBytes)
				if err != nil {
					return err
				}
				keys[key] = true
			}
			// Normalized source prefixes can also leave deterministic objects after a transaction rollback.
			for offset := int64(0); offset < row.SizeBytes; offset += integration.MaxImportChunkBytes {
				key, err := integration.ImportChunkKey(row.ID, offset)
				if err != nil {
					return err
				}
				keys[key] = true
			}
			for key := range keys {
				if err := r.objects.Remove(ctx, key); err != nil {
					return err
				}
			}

			updates := map[string]any{"purged_at_ms": r.clock.Now().UnixMilli()}
			if row.State != "completed" && row.State != "failed" {
				updates["state"] = "failed"
				updates["error_code"] = "IMPORT_EXPIRED"
				updates["updated_at_ms"] = r.clock.Now().UnixMilli()
			}
			if err := tx.Model(&stagedImportRow{}).Where("id=?", row.ID).Updates(updates).Error; err != nil {
				return err
			}
			purged = true
			return nil
		})
		if err != nil {
			return count, err
		}
		if purged {
			count++
		}
	}
	return count, nil
}
