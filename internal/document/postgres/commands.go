package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"gorm.io/gorm"
	"orbis.local/orbis/internal/asset"
	assetstore "orbis.local/orbis/internal/asset/postgres"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
	tablestore "orbis.local/orbis/internal/table/postgres"
	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
)

const commandBatchSize = 250

type structureRow struct {
	BlockID       string
	ParentID      *string
	Position      int
	BlockType     string
	ValidFrom     int64
	PayloadBytes  *int
	PayloadDigest *string
	GridCells     int
}

func commandState(ctx context.Context, tx *gorm.DB, doc document.Document, ops []document.Operation, writeCache bool) ([]document.StructureNode, map[string]document.Payload, error) {
	var metadata []structureRow
	if err := tx.WithContext(ctx).Table("document_block_versions").Select(`block_id,parent_id,position,payload->>'type' AS block_type,valid_from,payload_bytes,payload_digest,
      CASE WHEN payload->>'type'='table' THEN jsonb_array_length(payload->'table'->'rows')*jsonb_array_length(payload->'table'->'column_widths') ELSE 0 END AS grid_cells`).Where("document_id=? AND valid_to IS NULL", doc.ID).Find(&metadata).Error; err != nil {
		return nil, nil, err
	}
	ids := map[string]bool{}
	for _, row := range metadata {
		if row.PayloadBytes == nil || row.PayloadDigest == nil {
			ids[row.BlockID] = true
		}
	}
	for _, op := range ops {
		if op.Type == "replace_text" {
			ids[op.BlockID] = true
		}
	}
	needed := make([]string, 0, len(ids))
	for id := range ids {
		needed = append(needed, id)
	}
	loaded := map[string]blockRow{}
	payloads := map[string]document.Payload{}
	if len(needed) > 0 {
		var rows []blockRow
		if err := tx.WithContext(ctx).Where("document_id=? AND valid_to IS NULL AND block_id IN ?", doc.ID, needed).Find(&rows).Error; err != nil {
			return nil, nil, err
		}
		for _, row := range rows {
			if err := cacheBlock(&row); err != nil {
				return nil, nil, err
			}
			loaded[row.BlockID] = row
			var payload document.Payload
			if err := json.Unmarshal(row.Payload, &payload); err != nil {
				return nil, nil, err
			}
			payloads[row.BlockID] = payload
		}
	}
	result := make([]document.StructureNode, 0, len(metadata))
	cacheRows := []blockRow{}
	for _, row := range metadata {
		bytes, digest := row.PayloadBytes, row.PayloadDigest
		if bytes == nil || digest == nil {
			cached, exists := loaded[row.BlockID]
			if !exists {
				return nil, nil, fmt.Errorf("missing payload cache source")
			}
			bytes, digest = cached.PayloadBytes, cached.PayloadDigest
			cacheRows = append(cacheRows, cached)
		}
		result = append(result, document.StructureNode{ID: row.BlockID, ParentID: row.ParentID, Position: row.Position, Type: row.BlockType, Revision: row.ValidFrom, PayloadBytes: *bytes, PayloadDigest: *digest, GridCells: row.GridCells})
	}
	if writeCache {
		for start := 0; start < len(cacheRows); start += commandBatchSize {
			end := min(start+commandBatchSize, len(cacheRows))
			values := []string{}
			args := []any{}
			for _, row := range cacheRows[start:end] {
				values = append(values, "(CAST(? AS UUID),CAST(? AS BIGINT),CAST(? AS INTEGER),CAST(? AS TEXT))")
				args = append(args, row.BlockID, row.ValidFrom, *row.PayloadBytes, *row.PayloadDigest)
			}
			args = append(args, doc.ID)
			if err := tx.WithContext(ctx).Exec("WITH cached(block_id,valid_from,payload_bytes,payload_digest) AS (VALUES "+strings.Join(values, ",")+") UPDATE document_block_versions b SET payload_bytes=c.payload_bytes,payload_digest=c.payload_digest FROM cached c WHERE b.document_id=? AND b.block_id=c.block_id AND b.valid_from=c.valid_from AND b.payload_bytes IS NULL", args...).Error; err != nil {
				return nil, nil, err
			}
		}
	}
	return result, payloads, nil
}
func RequireCommandReferences(ctx context.Context, tx *gorm.DB, scope document.DirectoryScope, plan document.CommandPlan) error {
	return commandReferences(ctx, tx, scope, plan, true)
}
func commandReferences(ctx context.Context, tx *gorm.DB, scope document.DirectoryScope, plan document.CommandPlan, lock bool) error {
	blocks := []document.Block{}
	for _, change := range plan.Upserts {
		if change.Payload != nil {
			p := change.Payload
			blocks = append(blocks, document.Block{ID: change.ID, Type: p.Type, Props: p.Props, Content: p.Content, Table: p.Table, Children: []document.Block{}})
		}
	}
	return blockReferences(ctx, tx, scope, blocks, lock)
}
func RequireBlockReferences(ctx context.Context, tx *gorm.DB, scope document.DirectoryScope, blocks []document.Block) error {
	return blockReferences(ctx, tx, scope, blocks, true)
}
func blockReferences(ctx context.Context, tx *gorm.DB, scope document.DirectoryScope, blocks []document.Block, lock bool) error {
	for _, ref := range document.BoardReferences(blocks) {
		var source struct {
			DocumentID string
			Revision   int64
		}
		if err := tx.WithContext(ctx).Table("boards").Select("document_id,revision").Where("workspace_id=? AND id=?", scope.WorkspaceID, ref.ID).Take(&source).Error; err != nil {
			return missing(err)
		}
		if _, err := New(tx).Get(ctx, scope.WorkspaceID, source.DocumentID); err != nil {
			return err
		}
		version := ref.Revision
		if ref.Mode == "live" {
			version = source.Revision
		}
		var exists int64
		if err := tx.WithContext(ctx).Table("board_revisions").Where("board_id=? AND revision=? AND pages @> ?::jsonb", ref.ID, version, `[{"id":"`+ref.PageID+`"}]`).Count(&exists).Error; err != nil {
			return err
		}
		if exists != 1 {
			return fault.Missing()
		}
		if ref.FrameID != nil {
			var frames int64
			if err := tx.WithContext(ctx).Table("board_element_versions").Where("board_id=? AND page_id=? AND id=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>?) AND payload->>'shape_type'='basic.frame' AND (payload->'geometry'->>'rotation_rad')::numeric=0", ref.ID, ref.PageID, *ref.FrameID, version, version).Count(&frames).Error; err != nil {
				return err
			}
			if frames != 1 {
				return fault.Missing()
			}
		}
	}
	for _, ref := range document.SheetReferences(blocks) {
		var count int64
		if err := tx.WithContext(ctx).Table("sheets s").Joins("JOIN collections c ON c.id=s.collection_id").Joins("JOIN collection_groups g ON g.id=c.group_id").Where("s.id=? AND s.workspace_id=? AND c.archived_at_ms IS NULL AND g.archived_at_ms IS NULL", ref.ID, scope.WorkspaceID).Count(&count).Error; err != nil {
			return err
		}
		if count != 1 {
			return fault.Missing()
		}
	}
	references := document.MediaReferences(blocks)
	ids := []string{}
	for _, ref := range references {
		ids = append(ids, ref.ID)
	}
	media := map[string]string{}
	if lock {
		var err error
		media, err = assetstore.RequireFiles(ctx, tx, scope.WorkspaceID, ids)
		if err != nil {
			return err
		}
	} else if len(ids) > 0 {
		unique := map[string]bool{}
		for _, id := range ids {
			unique[id] = true
		}
		var rows []assetstore.Record
		if err := tx.WithContext(ctx).Where("workspace_id=? AND kind='file' AND state='ready' AND id IN ?", scope.WorkspaceID, ids).Find(&rows).Error; err != nil {
			return err
		}
		if len(rows) != len(unique) {
			return fault.Missing()
		}
		for _, row := range rows {
			media[row.ID] = row.MediaType
		}
	}
	for _, ref := range references {
		if ref.Kind != "file" && (!asset.InlineType(media[ref.ID]) || !strings.HasPrefix(media[ref.ID], ref.Kind+"/")) {
			return fault.Field("body.operations", "媒体引用类型与文件不匹配")
		}
	}
	if lock {
		return tablestore.RequireReferences(ctx, tx, scope.WorkspaceID, scope.DocumentID, document.TableReferences(blocks))
	}
	return tablestore.CheckReferences(ctx, tx, scope.WorkspaceID, scope.DocumentID, document.TableReferences(blocks))
}

// ApplyCommandsInTransaction allows Agent authorization and its global receipt to join the same commit.
func ApplyCommandsInTransaction(ctx context.Context, tx *gorm.DB, command document.Command, engines ...document.CollaborationEngine) (document.CommandResult, error) {
	doc, err := LockContent(ctx, tx, command.Scope)
	if err != nil {
		return document.CommandResult{}, err
	}
	_, replayed, err := CheckOperation(ctx, tx, doc.ID, command.Scope.ActorID, command.Input.OperationID, command.RequestHash)
	if err != nil {
		return document.CommandResult{}, err
	}
	if replayed {
		return commandReceipt(ctx, tx, command.Scope, command.Input.OperationID)
	}
	if err := CheckVersion(doc.ContentVersion, command.Input.ExpectedVersion); err != nil {
		return document.CommandResult{}, err
	}
	metadata, payloads, err := commandState(ctx, tx, doc, command.Input.Operations, true)
	if err != nil {
		return document.CommandResult{}, err
	}
	plan, err := document.PlanCommands(doc, metadata, command.Input.Operations, payloads)
	if err != nil {
		return document.CommandResult{}, err
	}
	operations, resolved, err := copyCommandTables(ctx, tx, command, metadata, plan, false)
	if err != nil {
		return document.CommandResult{}, err
	}
	if len(resolved) > 0 {
		plan, err = document.PlanCommands(doc, metadata, operations, payloads)
		if err != nil {
			return document.CommandResult{}, err
		}
	}
	if err := RequireCommandReferences(ctx, tx, command.Scope, plan); err != nil {
		return document.CommandResult{}, err
	}
	version := doc.ContentVersion + 1
	if err := insertRevision(ctx, tx, revisionRow{DocumentID: doc.ID, Version: version, Title: plan.Title, AuthorID: &command.Scope.ActorID, CreatedAtMS: command.Timestamp}); err != nil {
		return document.CommandResult{}, err
	}
	closeIDs := append(append([]string{}, plan.DeletedIDs...), plan.ChangedIDs...)
	if len(closeIDs) > 0 {
		if err := tx.WithContext(ctx).Model(&blockRow{}).Where("document_id=? AND valid_to IS NULL AND block_id IN ?", doc.ID, closeIDs).Update("valid_to", version).Error; err != nil {
			return document.CommandResult{}, err
		}
	}
	full := []blockRow{}
	moved := []document.BlockMutation{}
	for _, change := range plan.Upserts {
		if change.Payload == nil {
			moved = append(moved, change)
			continue
		}
		encoded, err := json.Marshal(change.Payload)
		if err != nil {
			return document.CommandResult{}, err
		}
		size, digest := change.PayloadBytes, change.PayloadDigest
		full = append(full, blockRow{DocumentID: doc.ID, BlockID: change.ID, ParentID: change.ParentID, Position: change.Position, Payload: encoded, PayloadBytes: &size, PayloadDigest: &digest, ValidFrom: version})
	}
	if len(full) > 0 {
		if err := tx.WithContext(ctx).CreateInBatches(full, commandBatchSize).Error; err != nil {
			return document.CommandResult{}, err
		}
	}
	for start := 0; start < len(moved); start += commandBatchSize {
		end := min(start+commandBatchSize, len(moved))
		values := []string{}
		args := []any{}
		for _, change := range moved[start:end] {
			values = append(values, "(CAST(? AS UUID),CAST(? AS UUID),CAST(? AS INTEGER),CAST(? AS BIGINT))")
			args = append(args, change.ID, change.ParentID, change.Position, change.Revision)
		}
		args = append(args, doc.ID, version, doc.ID)
		result := tx.WithContext(ctx).Exec("WITH moved(block_id,parent_id,position,source_version) AS (VALUES "+strings.Join(values, ",")+") INSERT INTO document_block_versions(document_id,block_id,parent_id,position,payload,payload_bytes,payload_digest,valid_from,valid_to) SELECT ?,m.block_id,m.parent_id,m.position,b.payload,b.payload_bytes,b.payload_digest,?,NULL FROM moved m JOIN document_block_versions b ON b.document_id=? AND b.block_id=m.block_id AND b.valid_from=m.source_version", args...)
		if result.Error != nil {
			return document.CommandResult{}, result.Error
		}
		if result.RowsAffected != int64(end-start) {
			return document.CommandResult{}, fmt.Errorf("structural mutation lost its source row")
		}
	}
	if err := tx.WithContext(ctx).Model(&documentRow{}).Where("id=? AND workspace_id=?", doc.ID, doc.WorkspaceID).Updates(map[string]any{"title": plan.Title, "content_version": version, "updated_at_ms": command.Timestamp}).Error; err != nil {
		return document.CommandResult{}, err
	}
	result := document.CommandResult{DocumentID: doc.ID, OperationID: command.Input.OperationID, BaseVersion: doc.ContentVersion, ContentVersion: version, Title: plan.Title, ChangedBlockIDs: plan.ChangedIDs, DeletedBlockIDs: plan.DeletedIDs, ResolvedBlocks: resolved}
	var engine document.CollaborationEngine
	if len(engines) > 0 {
		engine = engines[0]
	}
	if err := SyncCollaboration(ctx, tx, doc.ID, version, command.Input.OperationID, command.Scope.ActorID, command.Timestamp, false, engine); err != nil {
		return document.CommandResult{}, err
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return document.CommandResult{}, err
	}
	err = tx.WithContext(ctx).Create(&operationRow{DocumentID: doc.ID, OperationID: command.Input.OperationID, ActorID: &command.Scope.ActorID, RequestHash: command.RequestHash, ResultVersion: version, Result: encoded, CreatedAtMS: command.Timestamp}).Error
	return result, err
}
func (r *Repository) ApplyCommands(ctx context.Context, command document.Command) (document.CommandResult, error) {
	var result document.CommandResult
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		result, err = ApplyCommandsInTransaction(ctx, tx, command, r.collaboration)
		return err
	})
	return result, err
}
func (r *Repository) PreviewCommands(ctx context.Context, command document.Command) (document.CommandPreview, error) {
	var result document.CommandPreview
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		role, err := wsstore.New(tx).Role(ctx, command.Scope.WorkspaceID, command.Scope.ActorID)
		if err != nil {
			return err
		}
		if !workspace.Allowed(role, workspace.Edit) {
			return fault.Denied()
		}
		doc, err := New(tx).Get(ctx, command.Scope.WorkspaceID, command.Scope.DocumentID)
		if err != nil {
			return err
		}
		if err := CheckVersion(doc.ContentVersion, command.Input.ExpectedVersion); err != nil {
			return err
		}
		metadata, payloads, err := commandState(ctx, tx, doc, command.Input.Operations, false)
		if err != nil {
			return err
		}
		plan, err := document.PlanCommands(doc, metadata, command.Input.Operations, payloads)
		if err != nil {
			return err
		}
		operations, _, err := copyCommandTables(ctx, tx, command, metadata, plan, true)
		if err != nil {
			return err
		}
		if len(command.Input.TableCopies) > 0 {
			plan, err = document.PlanCommands(doc, metadata, operations, payloads)
			if err != nil {
				return err
			}
		}
		if err := commandReferences(ctx, tx, command.Scope, withoutCopiedReferences(plan, command.Input.TableCopies), false); err != nil {
			return err
		}
		result = document.CommandPreview{DocumentID: doc.ID, OperationID: command.Input.OperationID, ExpectedVersion: doc.ContentVersion, ProjectedVersion: doc.ContentVersion + 1, Title: plan.Title, ChangedBlockIDs: plan.ChangedIDs, DeletedBlockIDs: plan.DeletedIDs}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func commandReceipt(ctx context.Context, tx *gorm.DB, scope document.DirectoryScope, id string) (document.CommandResult, error) {
	var row operationRow
	err := tx.WithContext(ctx).Where("document_id=? AND operation_id=? AND actor_id=? AND result IS NOT NULL", scope.DocumentID, id, scope.ActorID).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return document.CommandResult{}, fault.New(fault.NotFound, "OPERATION_NOT_FOUND", "块命令回执不存在")
	}
	if err != nil {
		return document.CommandResult{}, err
	}
	var result document.CommandResult
	err = json.Unmarshal(row.Result, &result)
	return result, err
}
func (r *Repository) CommandReceipt(ctx context.Context, scope document.DirectoryScope, id string) (document.CommandResult, error) {
	if _, err := r.Get(ctx, scope.WorkspaceID, scope.DocumentID); err != nil {
		return document.CommandResult{}, err
	}
	return commandReceipt(ctx, r.db, scope, id)
}
