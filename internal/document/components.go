package document

import (
	"strings"
	"unicode/utf8"

	"orbis.local/orbis/internal/platform/fault"
)

const MaxComponentTitle = 240
const MaxTabTitle = 160

func validColor(value string) bool {
	switch value {
	case "default", "transparent", "gray", "brown", "red", "orange", "yellow", "green", "blue", "purple", "pink":
		return true
	}
	if !strings.HasPrefix(value, "#") {
		return false
	}
	if n := len(value) - 1; n != 3 && n != 4 && n != 6 && n != 8 {
		return false
	}
	for _, r := range value[1:] {
		if !strings.ContainsRune("0123456789abcdefABCDEF", r) {
			return false
		}
	}
	return true
}
func normalizeRuns(runs []TextRun) error {
	for i := range runs {
		run := &runs[i]
		if strings.ContainsRune(run.Text, 0) {
			return fault.Field("body.blocks", "正文不能包含空字符")
		}
		if run.Marks == nil {
			run.Marks = []string{}
		}
		seen := map[string]bool{}
		for _, mark := range run.Marks {
			switch mark {
			case "bold", "italic", "strike", "underline", "code":
			default:
				return fault.Field("body.blocks", "文本样式不受支持")
			}
			if seen[mark] {
				return fault.Field("body.blocks", "文本样式重复")
			}
			seen[mark] = true
		}
		if run.Href != nil && !SafeLink(*run.Href) {
			return fault.Field("body.blocks", "链接必须使用 HTTP、HTTPS、邮件地址或站内绝对路径")
		}
		for _, color := range []*string{run.TextColor, run.BackgroundColor} {
			if color != nil && !validColor(*color) {
				return fault.Field("body.blocks", "文本颜色格式不正确")
			}
		}
	}
	return nil
}
func normalizeStyle(props map[string]any, allowed map[string]bool) error {
	for _, key := range []string{"text_alignment", "text_color", "background_color"} {
		allowed[key] = true
		value, exists := props[key]
		if !exists {
			continue
		}
		text, ok := value.(string)
		if !ok {
			return fault.Field("body.blocks", "块样式格式不正确")
		}
		if key == "text_alignment" {
			if text != "left" && text != "center" && text != "right" && text != "justify" {
				return fault.Field("body.blocks", "文本对齐方式不正确")
			}
		} else if !validColor(text) {
			return fault.Field("body.blocks", "块颜色格式不正确")
		}
	}
	return nil
}

// normalizeComponent supplies declared defaults without accepting arbitrary editor metadata.
func normalizeComponent(block *Block) (bool, error) {
	allowed := map[string]bool{}
	inline := false
	childType := ""
	titleDefault := ""
	titleLimit := MaxComponentTitle
	switch block.Type {
	case "callout":
		inline = true
		allowed["title"] = true
		allowed["tone"] = true
		if _, exists := block.Props["tone"]; !exists {
			block.Props["tone"] = "info"
		}
		switch block.Props["tone"] {
		case "info", "success", "warning", "danger":
		default:
			return true, fault.Field("body.blocks", "提示块风格不正确")
		}
	case "card":
		allowed["title"] = true
		allowed["href"] = true
		titleDefault = "卡片标题"
		if _, exists := block.Props["href"]; !exists {
			block.Props["href"] = ""
		}
		href, ok := block.Props["href"].(string)
		if !ok || len(href) > MaxMediaURLLength || (href != "" && !SafeLink(href)) {
			return true, fault.Field("body.blocks", "卡片链接不正确")
		}
	case "card_group":
		childType = "card"
		allowed["columns"] = true
		if _, exists := block.Props["columns"]; !exists {
			block.Props["columns"] = float64(2)
		}
		if !integerProp(block.Props, "columns", 2, 3) {
			return true, fault.Field("body.blocks", "卡片组仅支持 2 或 3 列")
		}
	case "steps":
		childType = "step"
	case "step":
		allowed["title"] = true
		titleDefault = "步骤标题"
	case "tabs":
		childType = "tab"
	case "tab":
		allowed["title"] = true
		titleDefault = "标签标题"
		titleLimit = MaxTabTitle
	case "code_group":
		childType = "code_block"
	default:
		return false, nil
	}
	if allowed["title"] {
		if _, exists := block.Props["title"]; !exists {
			block.Props["title"] = titleDefault
		}
		title, ok := block.Props["title"].(string)
		if !ok || utf8.RuneCountInString(title) > titleLimit || strings.ContainsRune(title, 0) {
			return true, fault.Field("body.blocks", "组件标题格式不正确")
		}
	}
	for key := range block.Props {
		if !allowed[key] {
			return true, fault.Field("body.blocks", "组件属性不受支持")
		}
	}
	if !inline && len(block.Content) > 0 {
		return true, fault.Field("body.blocks", "容器组件正文须放在子块中")
	}
	if childType != "" {
		for _, child := range block.Children {
			if child.Type != childType {
				return true, fault.Field("body.blocks", "组件包含不支持的子块")
			}
		}
	}
	return true, nil
}
