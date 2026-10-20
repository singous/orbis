package table

// PublicView contains only reader-visible presentation, never private filters or sorts.
type PublicView struct {
	Name         string         `json:"name"`
	Kind         string         `json:"kind"`
	GroupFieldID *string        `json:"group_field_id"`
	Widths       map[string]int `json:"widths"`
}
type PublicRecord struct {
	ID     string         `json:"id"`
	Values map[string]any `json:"values"`
}
type PublicData struct {
	Groups  []Group        `json:"groups"`
	Title   string         `json:"title"`
	Fields  []Field        `json:"fields"`
	View    PublicView     `json:"view"`
	Records []PublicRecord `json:"records"`
}

// PublicDefinition intersects explicitly public fields with the selected public view.
func PublicDefinition(def Definition) (PublicData, View) {
	view, _ := SelectView(def, def.PublicViewID)
	allowed := map[string]bool{}
	for _, id := range def.PublicFieldIDs {
		allowed[id] = true
	}
	ids := view.FieldIDs
	if len(ids) == 0 {
		for _, field := range def.Fields {
			ids = append(ids, field.ID)
		}
	}
	fields := FieldMap(def)
	result := PublicData{Groups: []Group{}, Title: def.Title, Fields: []Field{}, View: PublicView{Name: view.Name, Kind: view.Kind, Widths: map[string]int{}}, Records: []PublicRecord{}}
	selected := map[string]bool{}
	for _, id := range ids {
		if allowed[id] {
			result.Fields = append(result.Fields, fields[id])
			selected[id] = true
			if width, ok := view.Widths[id]; ok {
				result.View.Widths[id] = width
			}
		}
	}
	if view.GroupFieldID != nil && selected[*view.GroupFieldID] {
		result.View.GroupFieldID = view.GroupFieldID
	} else {
		result.View.Kind = "grid"
	}
	return result, view
}

type PublicPage struct {
	Data           PublicData
	Total          int64
	ContentVersion int64
	TableVersion   int64
}

// PublicGroups counts only the explicitly public grouping field.
func PublicGroups(data PublicData) []Group {
	result := []Group{}
	if data.View.GroupFieldID == nil {
		return result
	}
	id := *data.View.GroupFieldID
	counts := map[string]int64{}
	for _, record := range data.Records {
		value, _ := record.Values[id].(string)
		counts[value]++
	}
	result = append(result, Group{Name: "未分组", Count: counts[""]})
	for _, field := range data.Fields {
		if field.ID == id {
			for _, option := range field.Options {
				key := option.ID
				result = append(result, Group{OptionID: &key, Name: option.Label, Count: counts[key]})
			}
		}
	}
	return result
}
