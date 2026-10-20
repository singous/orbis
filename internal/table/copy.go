package table

import (
	"encoding/json"

	"github.com/google/uuid"
)

// Copy remaps structural identities without rewriting UUID-shaped authored text.
func Copy(source Definition, rows []Record) (Definition, []Record, error) {
	data, err := json.Marshal(source)
	if err != nil {
		return Definition{}, nil, err
	}
	var def Definition
	if err := json.Unmarshal(data, &def); err != nil {
		return def, nil, err
	}
	fieldIDs, viewIDs := map[string]string{}, map[string]string{}
	options := map[string]map[string]string{}
	fields := FieldMap(source)
	for _, field := range source.Fields {
		fieldIDs[field.ID] = uuid.NewString()
		options[field.ID] = map[string]string{}
		for _, option := range field.Options {
			options[field.ID][option.ID] = uuid.NewString()
		}
	}
	for _, view := range source.Views {
		viewIDs[view.ID] = uuid.NewString()
	}
	mapValue := func(fieldID string, value any) any {
		if fields[fieldID].Kind != "select" && fields[fieldID].Kind != "multi_select" {
			return value
		}
		switch value := value.(type) {
		case string:
			return options[fieldID][value]
		case []any:
			result := make([]any, 0, len(value))
			for _, id := range value {
				result = append(result, options[fieldID][id.(string)])
			}
			return result
		default:
			return value
		}
	}
	for index := range def.Fields {
		field := &def.Fields[index]
		previous := field.ID
		field.ID = fieldIDs[previous]
		for i := range field.Options {
			field.Options[i].ID = options[previous][field.Options[i].ID]
		}
	}
	for index := range def.Views {
		view := &def.Views[index]
		view.ID = viewIDs[view.ID]
		for i, id := range view.FieldIDs {
			view.FieldIDs[i] = fieldIDs[id]
		}
		widths := map[string]int{}
		for id, width := range view.Widths {
			widths[fieldIDs[id]] = width
		}
		view.Widths = widths
		for i := range view.Filters {
			filter := &view.Filters[i]
			filter.Value = mapValue(filter.FieldID, filter.Value)
			filter.FieldID = fieldIDs[filter.FieldID]
		}
		for i := range view.Sorts {
			view.Sorts[i].FieldID = fieldIDs[view.Sorts[i].FieldID]
		}
		if view.GroupFieldID != nil {
			mapped := fieldIDs[*view.GroupFieldID]
			view.GroupFieldID = &mapped
		}
	}
	def.PublicViewID = viewIDs[def.PublicViewID]
	for index, id := range def.PublicFieldIDs {
		def.PublicFieldIDs[index] = fieldIDs[id]
	}
	copied := make([]Record, 0, len(rows))
	for _, row := range rows {
		values := map[string]any{}
		for id, value := range row.Values {
			if mapped, exists := fieldIDs[id]; exists {
				values[mapped] = mapValue(id, value)
			}
		}
		copied = append(copied, Record{ID: uuid.NewString(), Values: values})
	}
	return def, copied, nil
}
