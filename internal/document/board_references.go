package document

import (
	"github.com/google/uuid"

	"orbis.local/orbis/internal/platform/fault"
)

type BoardReference struct {
	ID, PageID, Mode string
	Revision         int64
	FrameID          *string
}

func boardReferenceID(value any) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	id, err := uuid.Parse(text)
	return err == nil && id != uuid.Nil && id.String() == text
}
func normalizeBoardReference(block *Block) error {
	for key := range block.Props {
		switch key {
		case "board_id", "page_id", "mode", "revision", "frame_id":
		default:
			return fault.Field("body.blocks", "画板引用属性不受支持")
		}
	}
	if block.Props["board_id"] == nil && block.Props["page_id"] == nil && block.Props["frame_id"] == nil && block.Props["revision"] == nil {
		if mode := block.Props["mode"]; mode != nil && mode != "live" {
			return fault.Field("body.blocks", "空画板引用模式无效")
		}
		block.Props = map[string]any{"board_id": nil, "page_id": nil, "frame_id": nil, "mode": "live", "revision": nil}
		return nil
	}
	if !boardReferenceID(block.Props["board_id"]) || !boardReferenceID(block.Props["page_id"]) {
		return fault.Field("body.blocks", "画板引用标识无效")
	}
	if frame := block.Props["frame_id"]; frame != nil && !boardReferenceID(frame) {
		return fault.Field("body.blocks", "画框引用无效")
	}
	switch block.Props["mode"] {
	case "live":
		if block.Props["revision"] != nil {
			return fault.Field("body.blocks", "实时画板引用不能指定固定版本")
		}
	case "snapshot":
		if !integerProp(block.Props, "revision", 1, float64(MaxVersion)) {
			return fault.Field("body.blocks", "画板快照须指定有效版本")
		}
	default:
		return fault.Field("body.blocks", "画板引用模式无效")
	}
	block.Props["frame_id"] = block.Props["frame_id"]
	block.Props["revision"] = block.Props["revision"]
	return nil
}
func BoardReferences(blocks []Block) []BoardReference {
	result := []BoardReference{}
	for _, block := range blocks {
		if block.Type == "board" {
			id, _ := block.Props["board_id"].(string)
			if id == "" {
				continue
			}
			page, _ := block.Props["page_id"].(string)
			mode, _ := block.Props["mode"].(string)
			ref := BoardReference{ID: id, PageID: page, Mode: mode}
			if v, ok := block.Props["revision"].(float64); ok {
				ref.Revision = int64(v)
			}
			if v, ok := block.Props["frame_id"].(string); ok {
				ref.FrameID = &v
			}
			result = append(result, ref)
		}
		result = append(result, BoardReferences(block.Children)...)
	}
	return result
}
