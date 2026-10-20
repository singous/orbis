package table

import (
	"encoding/json"
	"math"
	"net/url"
	"strings"
	"unicode/utf8"

	"orbis.local/orbis/internal/platform/fault"
)

func ValidateValue(field Field, value any) error {
	if value == nil {
		return nil
	}
	valid := false
	switch field.Kind {
	case "text", "url":
		text, ok := value.(string)
		valid = ok && utf8.RuneCountInString(text) <= MaxCellText && !strings.ContainsRune(text, 0)
		if valid && field.Kind == "url" && text != "" {
			parsed, err := url.Parse(text)
			valid = err == nil && !strings.ContainsAny(text, "\x00\r\n\t\\") && strings.TrimSpace(text) == text
			if valid {
				valid = parsed.User == nil && (((parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Hostname() != "") || (parsed.Scheme == "mailto" && parsed.Opaque != ""))
			}
		}
	case "number":
		n, ok := value.(float64)
		valid = ok && !math.IsNaN(n) && !math.IsInf(n, 0) && math.Abs(n) <= float64(MaxVersion)
	case "datetime":
		n, ok := value.(float64)
		valid = ok && n >= float64(MinDatetime) && n <= float64(MaxDatetime) && n == math.Trunc(n)
	case "checkbox":
		_, valid = value.(bool)
	case "select":
		text, ok := value.(string)
		if ok {
			for _, option := range field.Options {
				if option.ID == text {
					valid = true
				}
			}
		}
	case "multi_select":
		values, ok := value.([]any)
		if ok && len(values) <= len(field.Options) {
			options := map[string]bool{}
			for _, option := range field.Options {
				options[option.ID] = true
			}
			seen := map[string]bool{}
			valid = true
			for _, value := range values {
				text, ok := value.(string)
				if !ok || !options[text] || seen[text] {
					valid = false
					break
				}
				seen[text] = true
			}
		}
	}
	if !valid {
		return fault.Field("body.upserts", "字段值不符合类型、选项或范围约束")
	}
	return nil
}
func NormalizeChanges(input Changes) (Changes, error) {
	data, err := json.Marshal(input)
	if err != nil {
		return Changes{}, fault.Field("body", "表格变更不是有效 JSON")
	}
	var changes Changes
	if err := json.Unmarshal(data, &changes); err != nil {
		return changes, err
	}
	if len(changes.Upserts)+len(changes.Deletes)+len(changes.Restores) > MaxBatchRecords {
		return changes, fault.Field("body", "新增、更新、删除和历史恢复合计最多 200 条记录")
	}
	if changes.Definition == nil && len(changes.Upserts) == 0 && len(changes.Deletes) == 0 && len(changes.Restores) == 0 {
		return changes, fault.Field("body", "至少提供一项表格变更")
	}
	if changes.Definition != nil {
		normalized, err := NormalizeDefinition(*changes.Definition)
		if err != nil {
			return changes, err
		}
		changes.Definition = &normalized
	}
	if changes.Upserts == nil {
		changes.Upserts = []Upsert{}
	}
	if changes.Deletes == nil {
		changes.Deletes = []string{}
	}
	if changes.Restores == nil {
		changes.Restores = []RecordRestore{}
	}
	seen := map[string]bool{}
	for index := range changes.Upserts {
		row := &changes.Upserts[index]
		if !ValidID(row.ID) || seen[row.ID] {
			return changes, fault.Field("body.upserts", "记录 ID 不正确或重复")
		}
		seen[row.ID] = true
		if row.Values == nil {
			return changes, fault.Field("body.upserts", "values 必须是对象")
		}
		encoded, err := json.Marshal(row.Values)
		if err != nil || len(encoded) > MaxRecordBytes {
			return changes, fault.Field("body.upserts", "单条记录超过 64 KiB 限制")
		}
	}
	for _, id := range changes.Deletes {
		if !ValidID(id) || seen[id] {
			return changes, fault.Field("body.deletes", "记录不能重复修改或删除")
		}
		seen[id] = true
	}
	for _, restore := range changes.Restores {
		if !ValidID(restore.ID) || seen[restore.ID] || restore.TableVersion < 1 || restore.TableVersion > MaxVersion {
			return changes, fault.Field("body.restores", "历史恢复的记录 ID 或版本不正确，或与其他修改重复")
		}
		seen[restore.ID] = true
	}
	return changes, nil
}

// MergeValues preserves omitted cells and hidden historical fields, while validating all currently defined cells.
func MergeValues(previous, patch map[string]any, def Definition) (map[string]any, error) {
	fields := FieldMap(def)
	result := map[string]any{}
	for id, value := range previous {
		result[id] = value
	}
	for id, value := range patch {
		if _, ok := fields[id]; !ok {
			return nil, fault.Field("body.upserts", "记录包含不存在的字段")
		}
		result[id] = value
	}
	for id, field := range fields {
		if value, exists := result[id]; exists {
			if err := ValidateValue(field, value); err != nil {
				return nil, err
			}
		}
	}
	data, err := json.Marshal(result)
	if err != nil || len(data) > MaxRecordBytes {
		return nil, fault.Field("body.upserts", "单条记录超过 64 KiB 限制")
	}
	return result, nil
}
func ProjectValues(values map[string]any, def Definition) map[string]any {
	result := map[string]any{}
	for _, field := range def.Fields {
		if value, exists := values[field.ID]; exists {
			result[field.ID] = value
		}
	}
	return result
}
