package document

import (
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/table"
)

func normalizeTableReference(block *Block) error {
	for key := range block.Props {
		if key != "table_id" && key != "table_version" && key != "sheet_id" && key != "sheet_view_id" {
			return fault.Field("body.blocks", "数据表块属性不受支持")
		}
	}
	if id, exists := block.Props["sheet_id"]; exists {
		value, ok := id.(string)
		if !ok || !table.ValidID(value) || block.Props["table_id"] != nil || block.Props["table_version"] != nil {
			return fault.Field("body.blocks", "数据表引用无效")
		}
		if view, exists := block.Props["sheet_view_id"]; exists {
			value, ok := view.(string)
			if !ok || !table.ValidID(value) {
				return fault.Field("body.blocks", "视图引用无效")
			}
		}
		return nil
	}
	id, version := block.Props["table_id"], block.Props["table_version"]
	if id == nil && version == nil {
		block.Props["table_id"] = nil
		block.Props["table_version"] = nil
		return nil
	}
	value, ok := id.(string)
	if !ok || !table.ValidID(value) || !integerProp(block.Props, "table_version", 1, float64(MaxVersion)) {
		return fault.Field("body.blocks", "数据表须同时提供有效 ID 与版本号")
	}
	return nil
}
func TableReference(blockID string, payload Payload) (table.Reference, bool) {
	if payload.Type != "data_table" {
		return table.Reference{}, false
	}
	id, ok := payload.Props["table_id"].(string)
	if !ok || !table.ValidID(id) || !integerProp(payload.Props, "table_version", 1, float64(MaxVersion)) {
		return table.Reference{}, false
	}
	return table.Reference{BlockID: blockID, TableID: id, Version: int64(payload.Props["table_version"].(float64))}, true
}
func TableReferences(blocks []Block) []table.Reference {
	result := []table.Reference{}
	var visit func([]Block)
	visit = func(items []Block) {
		for _, block := range items {
			if ref, ok := TableReference(block.ID, Payload{Type: block.Type, Props: block.Props}); ok {
				result = append(result, ref)
			}
			visit(block.Children)
		}
	}
	visit(blocks)
	return result
}

// SheetReferences are live references; they never make the document own sheet records.
type SheetReference struct{ ID, ViewID string }

func SheetReferences(blocks []Block) []SheetReference {
	result := []SheetReference{}
	for _, block := range blocks {
		if block.Type == "data_table" {
			if id, ok := block.Props["sheet_id"].(string); ok && table.ValidID(id) {
				view, _ := block.Props["sheet_view_id"].(string)
				result = append(result, SheetReference{id, view})
			}
		}
		result = append(result, SheetReferences(block.Children)...)
	}
	return result
}
