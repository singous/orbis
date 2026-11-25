package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"gorm.io/gorm"
	"orbis.local/orbis/internal/document"
)

const maxLocalTextBlocks = 100

// replaceTextProjection uses the engine's classification of a merged update
// to compare only existing top-level text blocks. Unsupported shapes and old
// engines use the complete projection, whose semantics remain authoritative.
func replaceTextProjection(ctx context.Context, tx *gorm.DB, did string, version int64, blocks []document.Block, ids []string) error {
	if len(ids) == 0 || len(ids) > maxLocalTextBlocks {
		return replaceProjection(ctx, tx, did, version, blocks)
	}
	targets := make(map[string]int, len(ids))
	for _, id := range ids {
		targets[id] = -1
	}
	remaining := len(targets)
	for position, block := range blocks {
		if _, exists := targets[block.ID]; exists {
			targets[block.ID] = position
			remaining--
			if remaining == 0 {
				break
			}
		}
	}
	if remaining != 0 {
		return replaceProjection(ctx, tx, did, version, blocks)
	}
	var old []blockRow
	if err := tx.WithContext(ctx).Table(blockContentTable).Where("document_id=? AND valid_to IS NULL AND block_id IN ?", did, ids).Find(&old).Error; err != nil {
		return err
	}
	if len(old) != len(ids) {
		return replaceProjection(ctx, tx, did, version, blocks)
	}

	var closed []string
	var insert []blockRow
	for _, row := range old {
		position, exists := targets[row.BlockID]
		if !exists || row.ParentID != nil || row.Position != position {
			return replaceProjection(ctx, tx, did, version, blocks)
		}
		block := blocks[position]
		var before document.Payload
		if err := json.Unmarshal(row.Payload, &before); err != nil {
			return fmt.Errorf("read stored collaboration block %s: %w", row.BlockID, err)
		}
		if len(block.Children) != 0 || block.Type != before.Type || (block.Type != "paragraph" && block.Type != "heading") {
			return replaceProjection(ctx, tx, did, version, blocks)
		}
		after := document.Payload{Type: block.Type, Props: block.Props, Content: block.Content}
		if document.EquivalentCollaborationPayload(before, after) {
			continue
		}
		payload, err := json.Marshal(after)
		if err != nil {
			return err
		}
		closed = append(closed, row.BlockID)
		insert = append(insert, blockRow{DocumentID: did, BlockID: row.BlockID, Position: position, Payload: payload, ValidFrom: version})
	}
	return persistProjectionChanges(ctx, tx, did, version, closed, insert)
}
