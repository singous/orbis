package document

import (
	"github.com/google/uuid"
	"orbis.local/orbis/internal/platform/fault"
)

type CollectionIcon struct {
	Type    string `json:"type"`
	Name    string `json:"name,omitempty"`
	Color   string `json:"color,omitempty"`
	AssetID string `json:"asset_id,omitempty"`
}

// ValidateCollectionIcon checks the public icon identity and preset vocabulary.
func ValidateCollectionIcon(icon *CollectionIcon) error {
	if icon == nil {
		return nil
	}
	switch icon.Type {
	case "preset":
		if icon.AssetID != "" {
			return fault.Field("body.icon", "预设图标不能包含文件引用")
		}
		switch icon.Name {
		case "book", "notebook", "folder", "file-text", "lightbulb", "code", "palette", "rocket", "flask", "globe", "graduation-cap", "heart", "briefcase", "target", "coffee", "music":
		default:
			return fault.Field("body.icon.name", "内置图标名称不正确")
		}
		switch icon.Color {
		case "blue", "mint", "violet", "amber", "rose", "cyan", "slate":
		default:
			return fault.Field("body.icon.color", "图标配色不正确")
		}
	case "image":
		id, err := uuid.Parse(icon.AssetID)
		if err != nil || id == uuid.Nil || id.String() != icon.AssetID || icon.Name != "" || icon.Color != "" {
			return fault.Field("body.icon", "图片图标必须引用有效的已归一化图标文件")
		}
	default:
		return fault.Field("body.icon.type", "图标类型不正确")
	}
	return nil
}
