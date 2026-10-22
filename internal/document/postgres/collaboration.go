package postgres

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
)

type collaborationRow struct {
	DocumentID, Epoch  string
	ContentVersion     int64
	State, StateVector []byte
	UpdatedAtMS        int64
}

func (collaborationRow) TableName() string { return "document_collaboration_states" }
func (r collaborationRow) domain() document.CollaborationState {
	return document.CollaborationState{DocumentID: r.DocumentID, Epoch: r.Epoch, ContentVersion: r.ContentVersion, ProtocolVersion: document.CollaborationProtocolVersion, State: r.State, StateVector: r.StateVector, UpdatedAtMS: r.UpdatedAtMS}
}

type collaborationUpdateRow struct {
	DocumentID, OperationID, Epoch string
	ActorID                        *string
	ContentVersion                 int64
	Update                         []byte `gorm:"column:update_data"`
	CreatedAtMS                    int64
}

const collaborationRetainedVersions int64 = 256
const collaborationIncrementalLimit = 100

func (collaborationUpdateRow) TableName() string { return "document_collaboration_updates" }

func (r *Repository) CollaborationAvailable() bool { return r.collaboration != nil }

func currentBlocks(ctx context.Context, tx *gorm.DB, did string) ([]document.Block, error) {
	var rows []blockRow
	if err := tx.WithContext(ctx).Where("document_id=? AND valid_to IS NULL", did).Find(&rows).Error; err != nil {
		return nil, err
	}
	records := make([]document.BlockRecord, 0, len(rows))
	for _, row := range rows {
		records = append(records, row.domain())
	}
	return document.Expand(records)
}

func (r *Repository) EnableCollaboration(ctx context.Context, scope document.DirectoryScope, timestamp int64) (document.CollaborationState, error) {
	var result document.CollaborationState
	if r.collaboration == nil {
		return result, document.CollaborationUnavailable()
	}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		doc, err := LockContent(ctx, tx, scope)
		if err != nil {
			return err
		}
		var state collaborationRow
		err = tx.Where("document_id=?", doc.ID).Take(&state).Error
		if err == nil {
			if state.ContentVersion != doc.ContentVersion {
				return fmt.Errorf("collaboration projection is not current")
			}
			result = state.domain()
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		blocks, err := currentBlocks(ctx, tx, doc.ID)
		if err != nil {
			return err
		}
		transformed, err := r.collaboration.Transform(ctx, document.CollaborationTransform{Blocks: &blocks})
		if err != nil {
			return err
		}
		normalized, err := document.Normalize(transformed.Blocks)
		if err != nil {
			return err
		}
		if !document.EquivalentCollaborationBlocks(blocks, normalized) {
			return fault.New(fault.Conflict, "COLLABORATION_SEED_MISMATCH", "正文转换校验未通过，原文档仍保留")
		}
		state = collaborationRow{DocumentID: doc.ID, Epoch: uuid.NewString(), ContentVersion: doc.ContentVersion, State: transformed.State, StateVector: transformed.StateVector, UpdatedAtMS: timestamp}
		if err := tx.Create(&state).Error; err != nil {
			return err
		}
		result = state.domain()
		return nil
	})
	return result, err
}

func (r *Repository) ReadCollaboration(ctx context.Context, scope document.DirectoryScope, after int64) (document.CollaborationState, bool, error) {
	var result document.CollaborationState
	changed := false
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		doc, err := New(tx).Get(ctx, scope.WorkspaceID, scope.DocumentID)
		if err != nil {
			return err
		}
		if scope.CollectionID != "" && scope.CollectionID != doc.CollectionID {
			return fault.Missing()
		}
		if after == doc.ContentVersion {
			// Visibility is checked above even for an idle subscription.
			return nil
		}
		var row collaborationRow
		query := tx.Where("document_id=?", doc.ID)
		if after > 0 {
			query = query.Select("document_id,epoch,content_version,state_vector,updated_at_ms")
		}
		if err := query.Take(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return fault.New(fault.NotFound, "COLLABORATION_NOT_ENABLED", "文档尚未启用正文协同")
			}
			return err
		}
		if row.ContentVersion != doc.ContentVersion {
			return fmt.Errorf("collaboration projection is not current")
		}
		if after > 0 {
			var budget struct {
				Count        int64
				Bytes        int64
				Versions     int64
				FirstVersion int64
			}
			recent := tx.Table("document_collaboration_updates").Select("content_version,octet_length(update_data) AS bytes").Where("document_id=? AND content_version>?", doc.ID, after).Order("content_version,operation_id").Limit(collaborationIncrementalLimit + 1)
			if err := tx.Table("(?) AS recent", recent).Select("count(*) AS count,COALESCE(SUM(bytes),0) AS bytes,COUNT(DISTINCT content_version) AS versions,COALESCE(MIN(content_version),0) AS first_version").Scan(&budget).Error; err != nil {
				return err
			}
			if budget.Count > 0 && budget.Count <= collaborationIncrementalLimit && budget.Bytes <= document.MaxCollaborationStateBytes && budget.FirstVersion == after+1 && budget.Versions == doc.ContentVersion-after {
				var updates []collaborationUpdateRow
				if err := tx.Where("document_id=? AND content_version>?", doc.ID, after).Order("content_version,operation_id").Limit(collaborationIncrementalLimit).Find(&updates).Error; err != nil {
					return err
				}
				result = row.domain()
				result.Updates = make([][]byte, 0, len(updates))
				for _, update := range updates {
					result.Updates = append(result.Updates, update.Update)
				}
			} else if err := tx.Where("document_id=?", doc.ID).Take(&row).Error; err != nil {
				return err
			}
		}
		if result.DocumentID == "" {
			result = row.domain()
		}
		changed = true
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, changed, err
}

// SyncCollaboration must run after the native projection changes, under its existing document lock.
// Every old API and embedded-table writer calls this before committing its receipt.
func SyncCollaboration(ctx context.Context, tx *gorm.DB, did string, version int64, operation, actor string, timestamp int64, rotateEpoch bool, engine document.CollaborationEngine) error {
	var state collaborationRow
	if err := tx.WithContext(ctx).Where("document_id=?", did).Take(&state).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if engine == nil {
		return document.CollaborationUnavailable()
	}
	if state.ContentVersion != version-1 {
		return fmt.Errorf("collaboration writer skipped a content revision")
	}
	blocks, err := currentBlocks(ctx, tx, did)
	if err != nil {
		return err
	}
	result, err := engine.Transform(ctx, document.CollaborationTransform{State: state.State, Blocks: &blocks})
	if err != nil {
		return err
	}
	canonical, err := document.Normalize(result.Blocks)
	if err != nil {
		return err
	}
	if !document.EquivalentCollaborationBlocks(blocks, canonical) {
		return fault.New(fault.Conflict, "COLLABORATION_PROJECTION_MISMATCH", "正文协同投影校验失败，当前修改未提交")
	}
	state.State, state.StateVector, state.ContentVersion, state.UpdatedAtMS = result.State, result.StateVector, version, timestamp
	if rotateEpoch {
		state.Epoch = uuid.NewString()
	}
	if err := tx.Model(&collaborationRow{}).Where("document_id=?", did).Updates(map[string]any{"epoch": state.Epoch, "content_version": version, "state": state.State, "state_vector": state.StateVector, "updated_at_ms": timestamp}).Error; err != nil {
		return err
	}
	return appendCollaborationUpdate(ctx, tx, collaborationUpdateRow{DocumentID: did, OperationID: operation, ActorID: &actor, ContentVersion: version, Epoch: state.Epoch, Update: result.Update, CreatedAtMS: timestamp})
}

// Only the transport tail is pruned. Binary identity, immutable native history and operation receipts remain intact.
func appendCollaborationUpdate(ctx context.Context, tx *gorm.DB, row collaborationUpdateRow) error {
	if err := tx.WithContext(ctx).Create(&row).Error; err != nil {
		return err
	}
	if row.ContentVersion > collaborationRetainedVersions {
		return tx.Where("document_id=? AND content_version<=?", row.DocumentID, row.ContentVersion-collaborationRetainedVersions).Delete(&collaborationUpdateRow{}).Error
	}
	return nil
}

func replaceProjection(ctx context.Context, tx *gorm.DB, did string, version int64, blocks []document.Block) error {
	records, err := document.Flatten(blocks)
	if err != nil {
		return err
	}
	var old []blockRow
	if err := tx.WithContext(ctx).Where("document_id=? AND valid_to IS NULL", did).Find(&old).Error; err != nil {
		return err
	}
	before := make(map[string]blockRow, len(old))
	for _, row := range old {
		before[row.BlockID] = row
	}
	closed := []string{}
	insert := []blockRow{}
	for _, record := range records {
		previous, exists := before[record.ID]
		delete(before, record.ID)
		if exists {
			var before, after document.Payload
			if json.Unmarshal(previous.Payload, &before) != nil || json.Unmarshal(record.Payload, &after) != nil {
				return fmt.Errorf("invalid stored collaboration payload")
			}
			if document.EquivalentCollaborationPayload(before, after) {
				record.Payload = previous.Payload
			}
		}
		if exists && equalParent(previous.ParentID, record.ParentID) && previous.Position == record.Position && bytes.Equal(previous.Payload, record.Payload) {
			continue
		}
		if exists {
			closed = append(closed, record.ID)
		}
		insert = append(insert, blockRow{DocumentID: did, BlockID: record.ID, ParentID: record.ParentID, Position: record.Position, Payload: record.Payload, ValidFrom: version})
	}
	for id := range before {
		closed = append(closed, id)
	}
	if len(closed) > 0 {
		if err := tx.WithContext(ctx).Model(&blockRow{}).Where("document_id=? AND valid_to IS NULL AND block_id IN ?", did, closed).Update("valid_to", version).Error; err != nil {
			return err
		}
	}
	if len(insert) > 0 {
		if err := cacheBlocks(insert); err != nil {
			return err
		}
		if err := tx.WithContext(ctx).CreateInBatches(insert, commandBatchSize).Error; err != nil {
			return err
		}
	}
	return nil
}

// Embedded table versions are business references, not editable rich-text attributes.
// A stale browser property update must not undo a table transaction's newer reference.
func preserveTableReferences(ctx context.Context, tx *gorm.DB, did string, blocks []document.Block) (bool, error) {
	var rows []blockRow
	if err := tx.WithContext(ctx).Select("block_id,payload").Where("document_id=? AND valid_to IS NULL AND payload->>'type'='data_table'", did).Find(&rows).Error; err != nil {
		return false, err
	}
	references := map[string]document.Payload{}
	for _, row := range rows {
		var payload document.Payload
		if err := json.Unmarshal(row.Payload, &payload); err != nil {
			return false, err
		}
		if _, valid := document.TableReference(row.BlockID, payload); valid {
			references[row.BlockID] = payload
		}
	}
	changed := false
	var visit func([]document.Block)
	visit = func(siblings []document.Block) {
		for index := range siblings {
			block := &siblings[index]
			if previous, exists := references[block.ID]; exists && block.Type == "data_table" {
				if block.Props == nil {
					block.Props = map[string]any{}
				}
				before, _ := document.TableReference(block.ID, previous)
				after, valid := document.TableReference(block.ID, document.Payload{Type: block.Type, Props: block.Props, Content: block.Content})
				if !valid || after != before {
					block.Props["table_id"], block.Props["table_version"] = previous.Props["table_id"], previous.Props["table_version"]
					changed = true
				}
			}
			visit(block.Children)
		}
	}
	visit(blocks)
	return changed, nil
}

type collaborationPreparation struct {
	state        collaborationRow
	transformed  document.CollaborationTransformResult
	transformErr error
	ready        bool
}

// prepareCollaboration performs ordinary CRDT conversion without holding database locks.
// The commit transaction revalidates permission, receipts, epoch and the exact base.
func (r *Repository) prepareCollaboration(ctx context.Context, commit document.CollaborationCommit) (collaborationPreparation, error) {
	var prepared collaborationPreparation
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, _, err := readSnapshot(ctx, tx, document.ReadQuery{Scope: commit.Scope}); err != nil {
			return err
		}
		var receipts int64
		if err := tx.Model(&operationRow{}).Where("document_id=? AND operation_id=?", commit.Scope.DocumentID, commit.Input.OperationID).Count(&receipts).Error; err != nil {
			return err
		}
		if receipts > 0 {
			return nil
		}
		if err := tx.Where("document_id=?", commit.Scope.DocumentID).Take(&prepared.state).Error; err != nil {
			return missing(err)
		}
		prepared.ready = prepared.state.Epoch == commit.Input.Epoch
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return prepared, err
	}
	if prepared.ready {
		prepared.transformed, prepared.transformErr = r.collaboration.Transform(ctx, document.CollaborationTransform{State: prepared.state.State, Update: commit.Input.Update, Targets: commit.Input.Targets})
	}
	return prepared, nil
}

func (r *Repository) CommitCollaboration(ctx context.Context, commit document.CollaborationCommit) (document.CollaborationResult, error) {
	var result document.CollaborationResult
	if r.collaboration == nil {
		return result, document.CollaborationUnavailable()
	}
	prepared, err := r.prepareCollaboration(ctx, commit)
	if err != nil {
		return result, err
	}
	err = r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		doc, err := LockContent(ctx, tx, commit.Scope)
		if err != nil {
			return err
		}
		_, replay, err := CheckOperation(ctx, tx, doc.ID, commit.Scope.ActorID, commit.Input.OperationID, commit.RequestHash)
		if err != nil {
			return err
		}
		if replay {
			var receipt operationRow
			if err := tx.Where("document_id=? AND operation_id=?", doc.ID, commit.Input.OperationID).Take(&receipt).Error; err != nil {
				return err
			}
			return json.Unmarshal(receipt.Result, &result)
		}
		var state collaborationRow
		if err := tx.Select("document_id,epoch,content_version,updated_at_ms").Where("document_id=?", doc.ID).Take(&state).Error; err != nil {
			return missing(err)
		}
		if state.Epoch != commit.Input.Epoch {
			return fault.New(fault.Conflict, "COLLABORATION_EPOCH_CHANGED", "文档已恢复或切换版本，未同步的本机修改仍保留，请先导出后重新载入")
		}
		if state.ContentVersion != doc.ContentVersion {
			return fmt.Errorf("collaboration projection is not current")
		}
		var transformed document.CollaborationTransformResult
		if prepared.ready && prepared.state.Epoch == state.Epoch && prepared.state.ContentVersion == state.ContentVersion {
			state.State = prepared.state.State
			transformed, err = prepared.transformed, prepared.transformErr
		} else {
			// A competing commit requires a fresh merge. Keep the existing serialized
			// fallback so a normal CRDT edit is never rejected for a stale save counter.
			var binary struct{ State []byte }
			if err := tx.Table("document_collaboration_states").Select("state").Where("document_id=?", doc.ID).Take(&binary).Error; err != nil {
				return err
			}
			state.State = binary.State
			transformed, err = r.collaboration.Transform(ctx, document.CollaborationTransform{State: state.State, Update: commit.Input.Update, Targets: commit.Input.Targets})
		}
		if err != nil {
			return err
		}
		blocks, err := document.Normalize(transformed.Blocks)
		if err != nil {
			return err
		}
		protected, err := preserveTableReferences(ctx, tx, doc.ID, blocks)
		if err != nil {
			return err
		}
		if protected {
			reconciled, err := r.collaboration.Transform(ctx, document.CollaborationTransform{State: transformed.State, Blocks: &blocks})
			if err != nil {
				return err
			}
			transformed.State, transformed.StateVector, transformed.Update = reconciled.State, reconciled.StateVector, reconciled.State
		}
		var resolved []document.ResolvedBlock
		if len(commit.Input.TableCopies) > 0 {
			metadata, _, err := commandState(ctx, tx, doc, nil, true)
			if err != nil {
				return err
			}
			records, err := document.Flatten(blocks)
			if err != nil {
				return err
			}
			plan := document.CommandPlan{}
			for _, record := range records {
				var payload document.Payload
				if err := json.Unmarshal(record.Payload, &payload); err != nil {
					return err
				}
				plan.Upserts = append(plan.Upserts, document.BlockMutation{StructureNode: document.StructureNode{ID: record.ID}, Payload: &payload})
			}
			command := document.Command{Scope: commit.Scope, Timestamp: commit.Timestamp, Input: document.CommandsInput{TableCopies: commit.Input.TableCopies, Operations: []document.Operation{{Type: "insert_blocks", Blocks: blocks}}}}
			// Copy validation is performed against the exact merged tree and current stored identities below.
			if len(commit.Input.TableCopies) > document.MaxCopiedTables {
				return fault.Field("body.table_copies", "单次最多复制 100 个数据表")
			}
			seen := map[string]bool{}
			for _, copy := range commit.Input.TableCopies {
				if seen[copy.BlockID] {
					return fault.Field("body.table_copies", "复制目标不能重复")
				}
				seen[copy.BlockID] = true
				for _, id := range []string{copy.BlockID, copy.Source.WorkspaceID, copy.Source.DocumentID, copy.Source.TableID} {
					value, err := uuid.Parse(id)
					if err != nil || value == uuid.Nil || value.String() != id {
						return fault.Field("body.table_copies", "复制标识必须是标准 UUID")
					}
				}
				if copy.Source.DocumentVersion < 1 || copy.Source.DocumentVersion > document.MaxVersion {
					return fault.Field("body.table_copies", "来源版本无效")
				}
			}
			operations, copies, err := copyCommandTables(ctx, tx, command, metadata, plan, false)
			if err != nil {
				return err
			}
			resolved = copies
			// The copy helper's recursive empty slices must regain canonical []
			// before crossing the strict engine boundary (and before persistence).
			blocks, err = document.Normalize(operations[0].Blocks)
			if err != nil {
				return err
			}
			rewritten, err := r.collaboration.Transform(ctx, document.CollaborationTransform{State: transformed.State, Blocks: &blocks})
			if err != nil {
				return err
			}
			canonical, err := document.Normalize(rewritten.Blocks)
			if err != nil {
				return err
			}
			if !document.EquivalentCollaborationBlocks(blocks, canonical) {
				return fmt.Errorf("collaboration table copy projection changed unexpectedly")
			}
			// The broadcast must include both the user's update and server-created table references.
			transformed.State, transformed.StateVector, transformed.Update = rewritten.State, rewritten.StateVector, rewritten.State
		}
		if err := RequireBlockReferences(ctx, tx, commit.Scope, blocks); err != nil {
			return err
		}
		version := doc.ContentVersion
		changed := !bytes.Equal(state.State, transformed.State)
		if changed {
			if err := CheckVersion(version, version); err != nil {
				return err
			}
			version++
			if err := insertRevision(ctx, tx, revisionRow{DocumentID: doc.ID, Version: version, Title: doc.Title, AuthorID: &commit.Scope.ActorID, CreatedAtMS: commit.Timestamp}); err != nil {
				return err
			}
			if err := replaceProjection(ctx, tx, doc.ID, version, blocks); err != nil {
				return err
			}
			if err := tx.Model(&documentRow{}).Where("id=?", doc.ID).Updates(map[string]any{"content_version": version, "updated_at_ms": commit.Timestamp}).Error; err != nil {
				return err
			}
			if err := tx.Model(&collaborationRow{}).Where("document_id=?", doc.ID).Updates(map[string]any{"content_version": version, "state": transformed.State, "state_vector": transformed.StateVector, "updated_at_ms": commit.Timestamp}).Error; err != nil {
				return err
			}
		}
		result = document.CollaborationResult{DocumentID: doc.ID, OperationID: commit.Input.OperationID, Epoch: state.Epoch, ContentVersion: version, Changed: changed, ResolvedBlocks: resolved}
		encoded, err := json.Marshal(result)
		if err != nil {
			return err
		}
		if changed {
			if err := appendCollaborationUpdate(ctx, tx, collaborationUpdateRow{DocumentID: doc.ID, OperationID: commit.Input.OperationID, ActorID: &commit.Scope.ActorID, ContentVersion: version, Epoch: state.Epoch, Update: transformed.Update, CreatedAtMS: commit.Timestamp}); err != nil {
				return err
			}
		}
		return tx.Create(&operationRow{DocumentID: doc.ID, OperationID: commit.Input.OperationID, ActorID: &commit.Scope.ActorID, RequestHash: commit.RequestHash, ResultVersion: version, Result: encoded, CreatedAtMS: commit.Timestamp}).Error
	})
	return result, err
}
