package document

import (
	"fmt"

	"orbis.local/orbis/internal/platform/fault"
)

const MaxCopiedTables = 100

type TableCopySource struct {
	WorkspaceID     string `json:"workspace_id"`
	DocumentID      string `json:"document_id"`
	TableID         string `json:"table_id"`
	DocumentVersion int64  `json:"document_version"`
}

type TableCopy struct {
	BlockID string          `json:"block_id"`
	Source  TableCopySource `json:"source"`
}

type ResolvedBlock struct {
	ID      string  `json:"id"`
	Payload Payload `json:"payload"`
}

func validateTableCopies(input CommandsInput) error {
	if len(input.TableCopies) > MaxCopiedTables {
		return fault.Field("body.table_copies", "单次最多复制 100 个数据表")
	}
	if len(input.TableCopies) == 0 {
		return nil
	}
	inserted := map[string]Block{}
	var visit func([]Block)
	visit = func(blocks []Block) {
		for _, block := range blocks {
			inserted[block.ID] = block
			visit(block.Children)
		}
	}
	for _, op := range input.Operations {
		if op.Type == "insert_blocks" {
			visit(op.Blocks)
		}
	}
	seen := map[string]bool{}
	for index, copy := range input.TableCopies {
		field := fmt.Sprintf("body.table_copies[%d]", index)
		if !validBlockID(copy.BlockID) || seen[copy.BlockID] {
			return fault.Field(field+".block_id", "复制目标须为不重复的标准块 UUID")
		}
		seen[copy.BlockID] = true
		source := copy.Source
		if !validBlockID(source.WorkspaceID) || !validBlockID(source.DocumentID) || !validBlockID(source.TableID) || source.DocumentVersion < 1 || source.DocumentVersion > MaxVersion {
			return fault.Field(field+".source", "需要提供有效的来源工作空间、文档、表格与固定文档版本")
		}
		block, exists := inserted[copy.BlockID]
		ref, ok := TableReference(block.ID, Payload{Type: block.Type, Props: block.Props, Content: block.Content})
		if !exists || !ok || ref.TableID != source.TableID {
			return fault.Field(field+".block_id", "复制目标须为本批次新插入、引用来源表格的块")
		}
		for _, op := range input.Operations {
			if op.BlockID == copy.BlockID && (op.Type == "update_block" || op.Type == "replace_text") {
				return fault.Field(field+".block_id", "请在插入内容中声明复制块属性，不要再次覆盖复制目标")
			}
		}
	}
	return nil
}
