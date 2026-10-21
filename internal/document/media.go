package document

import (
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/platform/fault"
)

const MaxMediaURLLength = 4096
const MaxMediaCaptionLength = 2000
const MaxMediaDimension = 16384

type AssetReference struct{ ID, Kind string }

func mediaBlock(kind string) bool {
	return kind == "image" || kind == "audio" || kind == "video" || kind == "file"
}
func normalizeMedia(block *Block) error {
	for key, value := range block.Props {
		switch key {
		case "source":
		case "name", "caption", "alt":
			text, ok := value.(string)
			limit := MaxMediaCaptionLength
			if key == "name" {
				limit = 255
			}
			if !ok || utf8.RuneCountInString(text) > limit || strings.ContainsRune(text, 0) {
				return fault.Field("body.blocks", "媒体描述格式不正确")
			}
		case "width", "height":
			if !integerProp(block.Props, key, 1, MaxMediaDimension) {
				return fault.Field("body.blocks", "媒体尺寸超出范围")
			}
		case "show_preview":
			if _, ok := value.(bool); !ok {
				return fault.Field("body.blocks", "show_preview 必须是布尔值")
			}
		default:
			return fault.Field("body.blocks", "媒体块属性不受支持")
		}
	}
	source, exists := block.Props["source"]
	if !exists || source == nil {
		block.Props["source"] = nil
		return nil
	}
	fields, ok := source.(map[string]any)
	if !ok || len(fields) != 2 {
		return fault.Field("body.blocks", "媒体来源格式不正确")
	}
	switch fields["type"] {
	case "asset":
		text, ok := fields["asset_id"].(string)
		id, err := uuid.Parse(text)
		if !ok || err != nil || id == uuid.Nil || id.String() != text {
			return fault.Field("body.blocks", "文件引用须为标准 UUID")
		}
	case "external":
		text, ok := fields["url"].(string)
		parsed, err := url.Parse(text)
		if !ok || len(text) > MaxMediaURLLength || !SafeLink(text) || err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return fault.Field("body.blocks", "外部媒体须使用无用户凭据的 HTTP 或 HTTPS 地址")
		}
	default:
		return fault.Field("body.blocks", "媒体来源类型不受支持")
	}
	return nil
}

// MediaReferences visits only validated renderer fields, never arbitrary nested metadata.
func MediaReferences(blocks []Block) []AssetReference {
	result := []AssetReference{}
	var visit func([]Block)
	visit = func(items []Block) {
		for _, block := range items {
			addRuns := func(runs []TextRun) {
				for _, run := range runs {
					if run.Href != nil {
						if id, ok := ParseAssetLink(*run.Href); ok {
							result = append(result, AssetReference{ID: id, Kind: "file"})
						}
					}
				}
			}
			addRuns(block.Content)
			if block.Type == "card" {
				if href, ok := block.Props["href"].(string); ok {
					if id, ok := ParseAssetLink(href); ok {
						result = append(result, AssetReference{ID: id, Kind: "file"})
					}
				}
			}
			if block.Table != nil {
				for _, row := range block.Table.Rows {
					for _, cell := range row {
						addRuns(cell.Content)
					}
				}
			}

			if mediaBlock(block.Type) || block.Type == "drawing" {
				if source, ok := block.Props["source"].(map[string]any); ok && source["type"] == "asset" {
					if id, ok := source["asset_id"].(string); ok {
						kind := block.Type
						if kind == "drawing" {
							kind = "image"
						}
						result = append(result, AssetReference{ID: id, Kind: kind})
					}
				}
			}
			visit(block.Children)
		}
	}
	visit(blocks)
	return result
}
