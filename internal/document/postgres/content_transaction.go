package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"gorm.io/gorm"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
)

// LockDocumentDirectoryForRead prevents archive, movement and access revocation
// while an independently versioned resource is written. It does not serialize
// record writes on the document body lock.
func LockDocumentDirectoryForRead(ctx context.Context, tx *gorm.DB, scope document.DirectoryScope) error {
	if scope.ActorID != "" {
		if err := wsstore.RequireLocked(ctx, tx, scope.WorkspaceID, scope.ActorID, workspace.Edit); err != nil {
			return err
		}
	}
	if _, err := collectionFor(tx.WithContext(ctx), scope, "SHARE", true); err != nil {
		return err
	}
	_, err := New(tx).Get(ctx, scope.WorkspaceID, scope.DocumentID)
	return err
}

// LockContent is shared by whole-document writes and commands that atomically update an embedded resource.
func LockContent(ctx context.Context, tx *gorm.DB, scope document.DirectoryScope) (document.Document, error) {
	if err := wsstore.RequireLocked(ctx, tx, scope.WorkspaceID, scope.ActorID, workspace.Edit); err != nil {
		return document.Document{}, err
	}
	var location documentRow
	if err := tx.WithContext(ctx).Where("workspace_id=? AND id=?", scope.WorkspaceID, scope.DocumentID).Take(&location).Error; err != nil {
		return document.Document{}, missing(err)
	}
	if scope.CollectionID != "" && scope.CollectionID != location.CollectionID {
		return document.Document{}, fault.Missing()
	}
	scope.CollectionID = location.CollectionID
	if _, err := collectionFor(tx.WithContext(ctx), scope, "SHARE", true); err != nil {
		return document.Document{}, err
	}
	row, err := lockedDocument(tx.WithContext(ctx), scope)
	if err != nil {
		return document.Document{}, err
	}
	if err := readableDocument(tx.WithContext(ctx), row); err != nil {
		return document.Document{}, err
	}
	return row.domain(), nil
}
func CheckOperation(ctx context.Context, tx *gorm.DB, did, actor, operation, hash string) (int64, bool, error) {
	var previous operationRow
	err := tx.WithContext(ctx).Where("document_id=? AND operation_id=?", did, operation).Take(&previous).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	if previous.ActorID == nil || *previous.ActorID != actor || previous.RequestHash != hash {
		return 0, false, fault.New(fault.Conflict, "IDEMPOTENCY_CONFLICT", "操作 ID 已用于其他请求")
	}
	return previous.ResultVersion, true, nil
}
func CheckVersion(current, expected int64) error {
	if current != expected {
		return &fault.Error{
			Kind:    fault.Conflict,
			Code:    "DOCUMENT_VERSION_CONFLICT",
			Message: "文档版本已变化，请刷新后重试",
			Details: map[string]int64{"expected_version": expected, "current_version": current},
		}
	}
	if current >= document.MaxVersion {
		return fault.New(fault.Conflict, "DOCUMENT_VERSION_EXHAUSTED", "文档版本号已达到上限")
	}
	return nil
}
func BlockAt(ctx context.Context, tx *gorm.DB, scope document.DirectoryScope, version int64, id string) (document.Payload, error) {
	var row blockRow
	err := tx.WithContext(ctx).Table("document_block_versions b").Select("b.*").Joins("JOIN documents d ON d.id=b.document_id").Where(
		"d.workspace_id=? AND d.id=? AND b.block_id=? AND b.valid_from<=? AND (b.valid_to IS NULL OR b.valid_to>?)",
		scope.WorkspaceID,
		scope.DocumentID,
		id,
		version,
		version,
	).Take(&row).Error
	if err != nil {
		return document.Payload{}, missing(err)
	}
	var payload document.Payload
	err = json.Unmarshal(row.Payload, &payload)
	return payload, err
}

type BlockCommit struct {
	Document                            document.Document
	ActorID, BlockID, OperationID, Hash string
	Payload                             document.Payload
	Timestamp                           int64
}

// CommitBlock requires LockContent in the same transaction and changes only one block's temporal row.
func CommitBlock(ctx context.Context, tx *gorm.DB, input BlockCommit, engines ...document.CollaborationEngine) (int64, error) {
	if input.Document.ContentVersion >= document.MaxVersion {
		return 0, fault.New(fault.Conflict, "DOCUMENT_VERSION_EXHAUSTED", "文档版本号已达到上限")
	}
	var before blockRow
	if err := tx.WithContext(ctx).Where("document_id=? AND block_id=? AND valid_to IS NULL", input.Document.ID, input.BlockID).Take(&before).Error; err != nil {
		return 0, missing(err)
	}
	encoded, err := json.Marshal(input.Payload)
	if err != nil {
		return 0, err
	}
	if err := checkBlockBudget(ctx, tx, before, encoded); err != nil {
		return 0, err
	}
	next := input.Document.ContentVersion + 1
	if err := insertRevision(ctx, tx, revisionRow{DocumentID: input.Document.ID, Version: next, Title: input.Document.Title, AuthorID: &input.ActorID, CreatedAtMS: input.Timestamp}); err != nil {
		return 0, err
	}
	if err := tx.WithContext(ctx).Model(&blockRow{}).Where("document_id=? AND block_id=? AND valid_to IS NULL", input.Document.ID, input.BlockID).Update("valid_to", next).Error; err != nil {
		return 0, err
	}
	before.ValidFrom = next
	before.ValidTo = nil
	before.Payload = encoded
	if err := cacheBlock(&before); err != nil {
		return 0, err
	}
	if err := tx.WithContext(ctx).Create(&before).Error; err != nil {
		return 0, err
	}
	updated := tx.WithContext(ctx).Model(&documentRow{}).Where("workspace_id=? AND id=? AND content_version=?", input.Document.WorkspaceID, input.Document.ID, input.Document.ContentVersion).Updates(
		map[string]any{"content_version": next, "updated_at_ms": input.Timestamp},
	)
	if updated.Error != nil {
		return 0, updated.Error
	}
	if updated.RowsAffected != 1 {
		return 0, fault.New(fault.Conflict, "DOCUMENT_VERSION_CONFLICT", "文档版本已变化，请刷新后重试")
	}
	var engine document.CollaborationEngine
	if len(engines) > 0 {
		engine = engines[0]
	}
	if err := SyncCollaboration(ctx, tx, input.Document.ID, next, input.OperationID, input.ActorID, input.Timestamp, false, engine); err != nil {
		return 0, err
	}
	err = tx.WithContext(ctx).Create(&operationRow{
		DocumentID:    input.Document.ID,
		OperationID:   input.OperationID,
		ActorID:       &input.ActorID,
		RequestHash:   input.Hash,
		ResultVersion: next,
		CreatedAtMS:   input.Timestamp,
	}).Error
	return next, err
}

// Only growing payloads require a complete size check; ordinary table edits keep the same reference size.
func checkBlockBudget(ctx context.Context, tx *gorm.DB, before blockRow, encoded []byte) error {
	var previous document.Payload
	if err := json.Unmarshal(before.Payload, &previous); err != nil {
		return err
	}
	old, err := json.Marshal(previous)
	if err != nil {
		return err
	}
	delta := len(encoded) - len(old)
	if delta <= 0 {
		return nil
	}
	var rows []blockRow
	if err := tx.WithContext(ctx).Where("document_id=? AND valid_to IS NULL", before.DocumentID).Find(&rows).Error; err != nil {
		return err
	}
	records := make([]document.BlockRecord, 0, len(rows))
	for _, row := range rows {
		records = append(records, row.domain())
	}
	blocks, err := document.Expand(records)
	if err != nil {
		return err
	}
	data, err := json.Marshal(blocks)
	if err != nil {
		return err
	}
	if len(data)+delta > document.MaxContentBytes {
		return fault.New(fault.TooLarge, "CONTENT_TOO_LARGE", "表格引用更新后的文档内容超出大小限制")
	}
	return nil
}
