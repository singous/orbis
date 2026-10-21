package postgres

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/table"
	tablestore "orbis.local/orbis/internal/table/postgres"
	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
)

func copySourceMetadata(ctx context.Context, tx *gorm.DB, actor string, source document.TableCopySource) (table.Metadata, error) {
	role, err := wsstore.New(tx).Role(ctx, source.WorkspaceID, actor)
	if err != nil {
		return table.Metadata{}, err
	}
	if !workspace.Allowed(role, workspace.Read) {
		return table.Metadata{}, fault.Denied()
	}
	doc, err := New(tx).Get(ctx, source.WorkspaceID, source.DocumentID)
	if err != nil {
		return table.Metadata{}, err
	}
	if source.DocumentVersion > doc.ContentVersion {
		return table.Metadata{}, fault.Missing()
	}
	scope := table.Scope{ActorID: actor, WorkspaceID: source.WorkspaceID, DocumentID: source.DocumentID, TableID: source.TableID}
	header, err := tablestore.LoadHeader(ctx, tx, scope, false)
	if err != nil {
		return table.Metadata{}, err
	}
	payload, err := BlockAt(ctx, tx, document.DirectoryScope{ActorID: actor, WorkspaceID: source.WorkspaceID, DocumentID: source.DocumentID}, source.DocumentVersion, header.BlockID)
	if err != nil {
		return table.Metadata{}, err
	}
	ref, ok := document.TableReference(header.BlockID, payload)
	if !ok || ref.TableID != header.ID {
		return table.Metadata{}, fault.Missing()
	}
	return tablestore.Metadata(ctx, tx, header, ref.Version, source.DocumentVersion)
}

func copiedPayload(tableID string) document.Payload {
	return document.Payload{Type: "data_table", Props: map[string]any{"table_id": tableID, "table_version": float64(1)}, Content: []document.TextRun{}}
}

func rewriteCopiedBlocks(blocks []document.Block, replacements map[string]document.Payload) []document.Block {
	result := append([]document.Block(nil), blocks...)
	for index := range result {
		block := &result[index]
		if replacement, exists := replacements[block.ID]; exists {
			block.Type, block.Props, block.Content, block.Table = replacement.Type, replacement.Props, replacement.Content, replacement.Table
		}
		block.Children = rewriteCopiedBlocks(block.Children, replacements)
	}
	return result
}

// Source reads use immutable versions without acquiring a second document lock.
func copyCommandTables(ctx context.Context, tx *gorm.DB, command document.Command, structure []document.StructureNode, plan document.CommandPlan, preview bool) ([]document.Operation, []document.ResolvedBlock, error) {
	if len(command.Input.TableCopies) == 0 {
		return command.Input.Operations, nil, nil
	}
	existing := make(map[string]bool, len(structure))
	for _, node := range structure {
		existing[node.ID] = true
	}
	changes := make(map[string]document.BlockMutation, len(plan.Upserts))
	for _, change := range plan.Upserts {
		changes[change.ID] = change
	}
	budget := &tablestore.CopyBudget{}
	replacements := map[string]document.Payload{}
	resolved := make([]document.ResolvedBlock, 0, len(command.Input.TableCopies))
	for _, request := range command.Input.TableCopies {
		change, exists := changes[request.BlockID]
		if existing[request.BlockID] || !exists || change.Payload == nil {
			return nil, nil, fault.Field("body.table_copies", "复制目标须为本次保留的新插入块")
		}
		ref, ok := document.TableReference(request.BlockID, *change.Payload)
		if !ok || ref.TableID != request.Source.TableID {
			return nil, nil, fault.Field("body.table_copies", "复制目标与来源表格不一致")
		}
		metadata, err := copySourceMetadata(ctx, tx, command.Scope.ActorID, request.Source)
		if err != nil {
			return nil, nil, err
		}
		if metadata.TableVersion != ref.Version {
			return nil, nil, fault.New(fault.Conflict, "TABLE_VERSION_CONFLICT", "来源表格快照与复制引用不一致，请重新复制")
		}
		definition := metadata.Definition
		tableID := uuid.NewString()
		if preview {
			if err := tablestore.CheckCopyRecords(ctx, tx, metadata, budget); err != nil {
				return nil, nil, err
			}
		} else {
			rows, err := tablestore.CopyRecordsWithinBudget(ctx, tx, metadata, budget)
			if err != nil {
				return nil, nil, err
			}
			definition, rows, err = table.Copy(metadata.Definition, rows)
			if err != nil {
				return nil, nil, err
			}
			scope := table.Scope{ActorID: command.Scope.ActorID, WorkspaceID: command.Scope.WorkspaceID, DocumentID: command.Scope.DocumentID}
			header, err := tablestore.Create(ctx, tx, scope, request.BlockID, definition, rows, command.Timestamp)
			if err != nil {
				return nil, nil, err
			}
			tableID = header.ID
		}
		payload := copiedPayload(tableID)
		replacements[request.BlockID] = payload
		resolved = append(resolved, document.ResolvedBlock{ID: request.BlockID, Payload: payload})
	}
	operations := append([]document.Operation(nil), command.Input.Operations...)
	for index := range operations {
		if operations[index].Type == "insert_blocks" {
			operations[index].Blocks = rewriteCopiedBlocks(operations[index].Blocks, replacements)
		}
	}
	return operations, resolved, nil
}

func withoutCopiedReferences(plan document.CommandPlan, copies []document.TableCopy) document.CommandPlan {
	if len(copies) == 0 {
		return plan
	}
	ids := make(map[string]bool, len(copies))
	for _, copy := range copies {
		ids[copy.BlockID] = true
	}
	upserts := make([]document.BlockMutation, 0, len(plan.Upserts))
	for _, change := range plan.Upserts {
		if !ids[change.ID] {
			upserts = append(upserts, change)
		}
	}
	plan.Upserts = upserts
	return plan
}
