package markdown

import (
	"sort"

	"orbis.local/orbis/internal/document"
)

type Loss struct {
	BlockID string   `json:"block_id"`
	Type    string   `json:"type"`
	Reason  string   `json:"reason"`
	Fields  []string `json:"fields"`
}

func Losses(blocks []document.Block) []Loss {
	result := []Loss{}
	var visit func([]document.Block)
	visit = func(items []document.Block) {
		for _, b := range items {
			fields := map[string]bool{}
			switch b.Type {
			case "image", "audio", "video", "file", "drawing", "table", "data_table", "callout", "card", "card_group", "steps", "step", "tabs", "tab", "code_group", "toggle_list_item":
				fields["component_type"] = true
				fields["component_properties"] = true
			}
			for _, key := range []string{"text_alignment", "text_color", "background_color"} {
				if value, exists := b.Props[key]; exists && value != "left" && value != "default" {
					fields["props."+key] = true
				}
			}
			runs := func(values []document.TextRun) {
				for _, run := range values {
					if run.TextColor != nil && *run.TextColor != "default" {
						fields["content.text_color"] = true
					}
					if run.BackgroundColor != nil && *run.BackgroundColor != "default" {
						fields["content.background_color"] = true
					}
					for _, mark := range run.Marks {
						if mark == "underline" {
							fields["content.marks.underline"] = true
						}
					}
				}
			}
			runs(b.Content)
			if b.Table != nil {
				for _, row := range b.Table.Rows {
					for _, cell := range row {
						runs(cell.Content)
					}
				}
			}
			if len(fields) > 0 {
				names := []string{}
				for field := range fields {
					names = append(names, field)
				}
				sort.Strings(names)
				result = append(result, Loss{BlockID: b.ID, Type: b.Type, Reason: "Markdown 无法完整保留这些组件属性或样式", Fields: names})
			}
			visit(b.Children)
		}
	}
	visit(blocks)
	return result
}
