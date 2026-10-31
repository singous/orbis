package table

import (
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/platform/fault"
)

func Invalid(message string) error { return fault.Field("body.definition", message) }
func ValidID(value string) bool {
	id, err := uuid.Parse(value)
	return err == nil && id != uuid.Nil && id.String() == value
}
func name(value string, max int) (string, error) {
	value = strings.TrimSpace(value)
	if n := utf8.RuneCountInString(value); n < 1 || n > max || strings.ContainsRune(value, 0) {
		return "", Invalid("字段、视图和表格名称格式不正确")
	}
	return value, nil
}
func FieldMap(def Definition) map[string]Field {
	result := make(map[string]Field, len(def.Fields))
	for _, field := range def.Fields {
		result[field.ID] = field
	}
	return result
}
func idSubset(ids []string, fields map[string]Field) bool {
	seen := map[string]bool{}
	for _, id := range ids {
		if _, ok := fields[id]; !ok || seen[id] {
			return false
		}
		seen[id] = true
	}
	return true
}

// NormalizeDefinition copies values before supplying defaults and validating all references.
func NormalizeDefinition(input Definition) (Definition, error) {
	data, err := json.Marshal(input)
	if err != nil {
		return Definition{}, Invalid("表格定义不是有效 JSON")
	}
	if len(data) > MaxDefinitionBytes {
		return Definition{}, Invalid("表格定义超出 1 MiB 限制")
	}
	var def Definition
	if err := json.Unmarshal(data, &def); err != nil {
		return def, err
	}
	if len(def.Fields) < 1 || len(def.Fields) > MaxFields || len(def.Views) < 1 || len(def.Views) > MaxViews {
		return def, Invalid("字段或视图数量超出限制")
	}
	def.Title, err = name(def.Title, MaxTitleLength)
	if err != nil {
		return def, err
	}
	fields := map[string]Field{}
	for index := range def.Fields {
		field := &def.Fields[index]
		if !ValidID(field.ID) {
			return def, Invalid("字段 ID 必须是标准 UUID")
		}
		if _, exists := fields[field.ID]; exists {
			return def, Invalid("字段 ID 不能重复")
		}
		field.Name, err = name(field.Name, MaxNameLength)
		if err != nil {
			return def, err
		}
		if field.Kind == "" {
			field.Kind = "text"
		}
		switch field.Kind {
		case "text", "number", "select", "multi_select", "datetime", "checkbox", "url":
		default:
			return def, Invalid("字段类型不受支持")
		}
		if field.Options == nil {
			field.Options = []Option{}
		}
		if len(field.Options) > MaxOptions || (field.Kind != "select" && field.Kind != "multi_select" && len(field.Options) > 0) {
			return def, Invalid("字段选项数量或类型不正确")
		}
		seen := map[string]bool{}
		for i := range field.Options {
			option := &field.Options[i]
			if !ValidID(option.ID) || seen[option.ID] {
				return def, Invalid("选项 ID 不正确或重复")
			}
			seen[option.ID] = true
			option.Label, err = name(option.Label, MaxNameLength)
			if err != nil {
				return def, err
			}
			if option.Color == "" {
				option.Color = "gray"
			}
			switch option.Color {
			case "gray", "blue", "green", "amber", "red", "purple":
			default:
				return def, Invalid("选项颜色不受支持")
			}
		}
		fields[field.ID] = *field
	}
	views := map[string]bool{}
	for index := range def.Views {
		view := &def.Views[index]
		if !ValidID(view.ID) || views[view.ID] {
			return def, Invalid("视图 ID 不正确或重复")
		}
		views[view.ID] = true
		view.Name, err = name(view.Name, MaxNameLength)
		if err != nil {
			return def, err
		}
		if view.Kind == "" {
			view.Kind = "grid"
		}
		if view.Kind != "grid" && view.Kind != "kanban" {
			return def, Invalid("视图类型不受支持")
		}
		if view.FieldIDs == nil {
			view.FieldIDs = []string{}
		}
		if view.Widths == nil {
			view.Widths = map[string]int{}
		}
		if view.Filters == nil {
			view.Filters = []Filter{}
		}
		if view.Sorts == nil {
			view.Sorts = []Sort{}
		}
		if !idSubset(view.FieldIDs, fields) {
			return def, Invalid("视图字段不存在或重复")
		}
		for id, width := range view.Widths {
			if _, ok := fields[id]; !ok || width < MinColumnWidth || width > MaxColumnWidth {
				return def, Invalid("列宽须在 100 至 600 之间且属于有效字段")
			}
		}
		if view.GroupFieldID != nil {
			field, exists := fields[*view.GroupFieldID]
			if !exists || field.Kind != "select" {
				return def, Invalid("分组字段必须是单选字段")
			}
		}
		if view.Kind == "kanban" && view.GroupFieldID == nil {
			return def, Invalid("看板视图必须设置分组字段")
		}
		if len(view.Filters) > MaxFilters || len(view.Sorts) > MaxSorts {
			return def, Invalid("筛选或排序条件数量超出限制")
		}
		sorted := map[string]bool{}
		for _, sort := range view.Sorts {
			if _, ok := fields[sort.FieldID]; !ok || sorted[sort.FieldID] {
				return def, Invalid("排序字段不存在或重复")
			}
			sorted[sort.FieldID] = true
		}
		for i := range view.Filters {
			if err := validateFilter(fields, &view.Filters[i]); err != nil {
				return def, err
			}
		}
	}
	if !views[def.PublicViewID] || len(def.PublicFieldIDs) == 0 || !idSubset(def.PublicFieldIDs, fields) {
		return def, Invalid("公开视图或字段配置不正确")
	}
	normalized, err := json.Marshal(def)
	if err != nil {
		return def, err
	}
	if len(normalized) > MaxDefinitionBytes {
		return def, Invalid("补齐默认值后的表格定义超出 1 MiB 限制")
	}
	return def, nil
}
func validateFilter(fields map[string]Field, filter *Filter) error {
	field, exists := fields[filter.FieldID]
	if !exists {
		return Invalid("筛选字段不存在")
	}
	if filter.Operator == "" {
		filter.Operator = "eq"
	}
	switch filter.Operator {
	case "empty", "not_empty":
		if filter.Value != nil {
			return Invalid("空值筛选不接受 value")
		}
		return nil
	case "gt", "gte", "lt", "lte":
		if (field.Kind != "number" && field.Kind != "datetime") || filter.Value == nil {
			return Invalid("大小比较仅支持数字和日期值")
		}
	case "contains":
		value, ok := filter.Value.(string)
		if !ok || utf8.RuneCountInString(value) > MaxCellText || strings.ContainsRune(value, 0) {
			return Invalid("包含筛选值不正确")
		}
		if field.Kind == "text" || field.Kind == "url" {
			return nil
		}
		if field.Kind != "multi_select" {
			return Invalid("该字段不支持包含筛选")
		}
		for _, option := range field.Options {
			if option.ID == value {
				return nil
			}
		}
		return Invalid("多选筛选值必须是有效选项")
	case "eq", "ne":
		if field.Kind == "multi_select" {
			return Invalid("多选字段仅支持包含和空值筛选")
		}
	default:
		return Invalid("筛选操作符不受支持")
	}
	return ValidateValue(field, filter.Value)
}
func DefaultDefinition() Definition {
	title := Field{ID: uuid.NewString(), Name: "标题", Kind: "text", Options: []Option{}}
	status := Field{ID: uuid.NewString(), Name: "状态", Kind: "select", Options: []Option{
		{ID: uuid.NewString(), Label: "待开始", Color: "gray"},
		{ID: uuid.NewString(), Label: "进行中", Color: "blue"},
		{ID: uuid.NewString(), Label: "已完成", Color: "green"},
	}}
	due := Field{ID: uuid.NewString(), Name: "截止时间", Kind: "datetime", Options: []Option{}}
	fields := []string{title.ID, status.ID, due.ID}
	grid := View{ID: uuid.NewString(), Name: "全部记录", Kind: "grid", FieldIDs: fields, Widths: map[string]int{}, Filters: []Filter{}, Sorts: []Sort{}}
	board := View{
		ID:           uuid.NewString(),
		Name:         "按状态",
		Kind:         "kanban",
		FieldIDs:     append([]string{}, fields...),
		Widths:       map[string]int{},
		Filters:      []Filter{},
		Sorts:        []Sort{},
		GroupFieldID: &status.ID,
	}
	return Definition{
		Title:          "数据表",
		Fields:         []Field{title, status, due},
		Views:          []View{grid, board},
		PublicViewID:   grid.ID,
		PublicFieldIDs: append([]string{}, fields...),
	}
}
func SelectView(def Definition, id string) (View, error) {
	if id == "" {
		return def.Views[0], nil
	}
	for _, view := range def.Views {
		if view.ID == id {
			return view, nil
		}
	}
	return View{}, fault.Field("query.view_id", "视图不存在")
}
