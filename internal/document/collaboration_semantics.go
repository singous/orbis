package document

import (
	"bytes"
	"encoding/json"
	"slices"
	"strings"
)

// CRDT bindings may join adjacent equally formatted runs and order mark sets.
// Those representation changes must neither reject a lossless conversion nor
// rewrite an untouched native block's payload/revision. All other fields remain exact.
func canonicalCollaborationRuns(runs []TextRun) []TextRun {
	result := make([]TextRun, 0, len(runs))
	var merged strings.Builder
	accumulating := false
	for _, source := range runs {
		if source.Text == "" {
			continue
		}
		run := source
		run.Marks = append([]string{}, source.Marks...)
		slices.Sort(run.Marks)
		if len(result) > 0 {
			previous := &result[len(result)-1]
			if slices.Equal(previous.Marks, run.Marks) && sameOptionalString(previous.Href, run.Href) && sameOptionalString(previous.TextColor, run.TextColor) && sameOptionalString(previous.BackgroundColor, run.BackgroundColor) {
				if !accumulating {
					merged.WriteString(previous.Text)
					accumulating = true
				}
				merged.WriteString(run.Text)
				continue
			}
			if accumulating {
				previous.Text = merged.String()
				merged.Reset()
				accumulating = false
			}
		}
		result = append(result, run)
	}
	if accumulating {
		result[len(result)-1].Text = merged.String()
	}
	return result
}

func sameOptionalString(a, b *string) bool {
	return a == nil && b == nil || a != nil && b != nil && *a == *b
}

func canonicalCollaborationPayload(payload Payload) Payload {
	payload.Content = canonicalCollaborationRuns(payload.Content)
	if payload.Table != nil {
		grid := *payload.Table
		grid.Rows = make([][]GridCell, len(payload.Table.Rows))
		for y, row := range payload.Table.Rows {
			grid.Rows[y] = make([]GridCell, len(row))
			for x, cell := range row {
				cell.Content = canonicalCollaborationRuns(cell.Content)
				grid.Rows[y][x] = cell
			}
		}
		payload.Table = &grid
	}
	return payload
}

func EquivalentCollaborationPayload(a, b Payload) bool {
	left, err := json.Marshal(canonicalCollaborationPayload(a))
	if err != nil {
		return false
	}
	right, err := json.Marshal(canonicalCollaborationPayload(b))
	return err == nil && bytes.Equal(left, right)
}

func EquivalentCollaborationBlocks(a, b []Block) bool {
	if len(a) != len(b) {
		return false
	}
	for index, left := range a {
		right := b[index]
		if left.ID != right.ID || left.Type != right.Type || !EquivalentCollaborationPayload(Payload{Type: left.Type, Props: left.Props, Content: left.Content, Table: left.Table}, Payload{Type: right.Type, Props: right.Props, Content: right.Content, Table: right.Table}) || !EquivalentCollaborationBlocks(left.Children, right.Children) {
			return false
		}
	}
	return true
}
