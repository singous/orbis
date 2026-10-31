package sheet

import (
	"encoding/json"
	"math"
	"net/mail"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

type Kind struct{ Numeric, System, Multiple, Attachment bool }

var Kinds = map[string]Kind{
	"text": {}, "number": {Numeric: true}, "select": {}, "multi_select": {Multiple: true}, "datetime": {Numeric: true}, "person": {Multiple: true},
	"image": {Multiple: true, Attachment: true}, "attachment": {Multiple: true, Attachment: true}, "checkbox": {}, "url": {}, "email": {}, "phone": {},
	"rating": {Numeric: true}, "progress": {Numeric: true}, "created_by": {System: true}, "created_at": {System: true, Numeric: true}, "updated_by": {System: true}, "updated_at": {System: true, Numeric: true},
}

func validName(s string, max int) bool {
	return strings.TrimSpace(s) != "" && utf8.RuneCountInString(s) <= max && !strings.ContainsRune(s, 0)
}
func Fields(d Definition) map[string]Field {
	r := map[string]Field{}
	for _, f := range d.Fields {
		r[f.ID] = f
	}
	return r
}
func ValidateDefinition(d Definition) error {
	raw, _ := json.Marshal(d)
	if len(raw) > MaxDefinitionBytes {
		return Invalid("表格配置超过 1 MiB")
	}
	if len(d.Fields) < 1 || len(d.Fields) > MaxFields || len(d.Views) < 1 || len(d.Views) > MaxViews {
		return Invalid("字段或视图数量超出限制")
	}
	fields := map[string]Field{}
	for _, f := range d.Fields {
		if _, ok := Kinds[f.Kind]; !ok {
			return Invalid("不支持的字段类型")
		}
		if _, ok := fields[f.ID]; ok || !ValidID(f.ID) || !validName(f.Name, 120) {
			return Invalid("字段名称或标识无效")
		}
		if len(f.Options) > 100 {
			return Invalid("选项最多 100 个")
		}
		options := map[string]bool{}
		for _, o := range f.Options {
			switch o.Color {
			case "", "gray", "blue", "green", "amber", "purple", "pink":
			default:
				return Invalid("选项颜色无效")
			}
			if !ValidID(o.ID) || options[o.ID] || !validName(o.Label, 120) {
				return Invalid("选项名称或标识无效")
			}
			options[o.ID] = true
		}
		if f.Default != nil {
			if Kinds[f.Kind].System {
				return Invalid("系统字段不可设置默认值")
			}
			if _, err := NormalizeValue(f, f.Default); err != nil {
				return err
			}
		}
		fields[f.ID] = f
	}
	seen := map[string]bool{}
	for _, v := range d.Views {
		if !ValidID(v.ID) || seen[v.ID] || !validName(v.Name, 120) || (v.Kind != "grid" && v.Kind != "kanban") {
			return Invalid("视图配置无效")
		}
		seen[v.ID] = true
		if v.RowHeight != 32 && v.RowHeight != 40 && v.RowHeight != 64 && v.RowHeight != 96 {
			return Invalid("行高无效")
		}
		ids := map[string]bool{}
		for _, id := range v.FieldIDs {
			if _, ok := fields[id]; !ok || ids[id] {
				return Invalid("视图字段无效")
			}
			ids[id] = true
		}
		if len(v.FieldIDs) == 0 {
			return Invalid("至少显示一个字段")
		}
		for id, w := range v.Widths {
			if _, ok := fields[id]; !ok || w < 100 || w > 600 {
				return Invalid("列宽无效")
			}
		}
		if v.GroupFieldID != "" {
			f, ok := fields[v.GroupFieldID]
			if !ok || f.Kind != "select" {
				return Invalid("分组需选择单选字段")
			}
		}
		for id, color := range v.TextColors {
			if _, ok := fields[id]; !ok {
				return Invalid("颜色字段无效")
			}
			switch color {
			case "gray", "blue", "green", "amber", "purple", "pink":
			default:
				return Invalid("颜色无效")
			}
		}
		if len(v.HighlightDuplicates) > 3 {
			return Invalid("最多同时高亮三个字段的重复值")
		}
		for _, id := range v.HighlightDuplicates {
			f, ok := fields[id]
			if !ok || Kinds[f.Kind].Multiple || Kinds[f.Kind].System {
				return Invalid("此字段不支持重复值高亮")
			}
		}
		if len(v.Filters) > 20 || len(v.Sorts) > 8 {
			return Invalid("筛选或排序条件过多")
		}
		for _, s := range v.Sorts {
			f, ok := fields[s.FieldID]
			if !ok || Kinds[f.Kind].Multiple {
				return Invalid("此字段不支持排序")
			}
		}
		for _, filter := range v.Filters {
			f, ok := fields[filter.FieldID]
			if !ok {
				return Invalid("筛选字段不存在")
			}
			switch filter.Operator {
			case "empty", "not_empty":
			case "eq", "ne", "contains":
				if Kinds[f.Kind].System {
					return Invalid("系统字段暂不支持筛选")
				}
			case "gt", "gte", "lt", "lte":
				if !Kinds[f.Kind].Numeric || Kinds[f.Kind].System || filter.Value == nil {
					return Invalid("比较条件需数值或日期字段")
				}
			default:
				return Invalid("筛选条件无效")
			}
			if filter.Operator != "empty" && filter.Operator != "not_empty" {
				if Kinds[f.Kind].Multiple {
					if _, ok := filter.Value.(string); !ok {
						return Invalid("请选择筛选值")
					}
				} else if _, err := NormalizeValue(f, filter.Value); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
func NormalizeValue(f Field, value any) (any, error) {
	if value == nil || value == "" {
		return nil, nil
	}
	k, ok := Kinds[f.Kind]
	if !ok {
		return nil, Invalid("不支持的字段类型")
	}
	if k.Multiple {
		items, ok := value.([]any)
		if !ok {
			if ss, yes := value.([]string); yes {
				for _, s := range ss {
					items = append(items, s)
				}
				ok = true
			}
		}
		if !ok || len(items) > 100 {
			return nil, Invalid(f.Name + "的值须为列表")
		}
		out := []string{}
		seen := map[string]bool{}
		for _, item := range items {
			s, ok := item.(string)
			if !ok || !ValidID(s) {
				return nil, Invalid(f.Name + "包含无效标识")
			}
			if f.Kind == "multi_select" && !hasOption(f, s) {
				return nil, Invalid(f.Name + "包含已删除的选项")
			}
			if !seen[s] {
				out = append(out, s)
				seen[s] = true
			}
		}
		return out, nil
	}
	if k.Numeric {
		n, ok := value.(float64)
		if !ok {
			switch v := value.(type) {
			case int64:
				n = float64(v)
				ok = true
			case int:
				n = float64(v)
				ok = true
			}
		}
		if !ok || math.IsNaN(n) || math.IsInf(n, 0) || math.Abs(n) > 9007199254740991 {
			return nil, Invalid(f.Name + "须为有效数字")
		}
		if (f.Kind == "rating" && (n < 0 || n > 5 || n != math.Trunc(n))) || (f.Kind == "progress" && (n < 0 || n > 100)) || (f.Kind == "datetime" && (n < -62135596800000 || n > 253402300799999 || n != math.Trunc(n))) {
			return nil, Invalid(f.Name + "超出范围")
		}
		return n, nil
	}
	if f.Kind == "checkbox" {
		if b, ok := value.(bool); ok {
			return b, nil
		}
		return nil, Invalid(f.Name + "须为布尔值")
	}
	s, ok := value.(string)
	if !ok || utf8.RuneCountInString(s) > MaxText || strings.ContainsRune(s, 0) {
		return nil, Invalid(f.Name + "的文本无效")
	}
	if f.Kind == "select" && !hasOption(f, s) {
		return nil, Invalid(f.Name + "的选项不存在")
	}
	if f.Kind == "email" {
		a, err := mail.ParseAddress(s)
		if err != nil || a.Address != s {
			return nil, Invalid("邮箱格式无效")
		}
	}
	if f.Kind == "url" {
		u, err := url.Parse(s)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
			return nil, Invalid("链接须为 HTTP 或 HTTPS 地址")
		}
	}
	return s, nil
}
func hasOption(f Field, s string) bool {
	for _, o := range f.Options {
		if o.ID == s {
			return true
		}
	}
	return false
}
func NormalizeValues(d Definition, values map[string]any, defaults bool) (map[string]any, error) {
	out := map[string]any{}
	fields := Fields(d)
	if defaults {
		for _, f := range d.Fields {
			if f.Default != nil && !Kinds[f.Kind].System {
				out[f.ID], _ = NormalizeValue(f, f.Default)
			}
		}
	}
	for id, value := range values {
		f, ok := fields[id]
		if !ok || Kinds[f.Kind].System {
			return nil, Invalid("字段不存在或不可编辑")
		}
		v, err := NormalizeValue(f, value)
		if err != nil {
			return nil, err
		}
		out[id] = v
	}
	data, _ := json.Marshal(out)
	if len(data) > MaxRecordBytes {
		return nil, Invalid("记录超出 64 KiB")
	}
	return out, nil
}
func Display(f Field, value any) string {
	if value == nil {
		return ""
	}
	if f.Kind == "select" {
		for _, o := range f.Options {
			if o.ID == value {
				return o.Label
			}
		}
	}
	if s, ok := value.(string); ok {
		return s
	}
	b, _ := json.Marshal(value)
	return string(b)
}
func DefaultDefinition(template string) Definition {
	name := "文本"
	if template == "tasks" {
		name = "任务"
	}
	if template == "books" {
		name = "书名"
	}
	if template == "plan" {
		name = "计划"
	}
	if template == "contacts" {
		name = "姓名"
	}
	fields := []Field{{ID: uuid.NewString(), Name: name, Kind: "text", Options: []Option{}}, {ID: uuid.NewString(), Name: "状态", Kind: "select", Options: []Option{{uuid.NewString(), "待开始", "green"}, {uuid.NewString(), "进行中", "amber"}, {uuid.NewString(), "已完成", "blue"}}}, {ID: uuid.NewString(), Name: "日期", Kind: "datetime", Options: []Option{}}}
	if template == "contacts" {
		fields[1] = Field{ID: fields[1].ID, Name: "电话", Kind: "phone", Options: []Option{}}
		fields[2] = Field{ID: fields[2].ID, Name: "邮箱", Kind: "email", Options: []Option{}}
	}
	if template == "books" {
		fields = append(fields, Field{ID: uuid.NewString(), Name: "评分", Kind: "rating", Options: []Option{}})
	}
	ids := []string{}
	for _, f := range fields {
		ids = append(ids, f.ID)
	}
	return Definition{fields, []View{{ID: uuid.NewString(), Name: "表格视图", Kind: "grid", FieldIDs: ids, Widths: map[string]int{}, Filters: []Filter{}, Sorts: []Sort{}, RowHeight: 40}}}
}
