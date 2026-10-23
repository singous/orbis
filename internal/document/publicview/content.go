package publicview

import (
	"encoding/json"
	"fmt"
	"strings"

	"orbis.local/orbis/internal/board"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/table"
)

const InitialTableRows = 100

type TableRef struct {
	Restricted bool                 `json:"restricted,omitempty"`
	Groups     []table.Group        `json:"groups"`
	ID         string               `json:"id"`
	Version    int64                `json:"version"`
	Title      string               `json:"title"`
	Fields     []table.Field        `json:"fields"`
	View       table.PublicView     `json:"view"`
	Items      []table.PublicRecord `json:"items"`
	Total      int64                `json:"total"`
	RecordsURL string               `json:"records_url"`
}
type Block struct {
	ID        string             `json:"id"`
	Type      string             `json:"type"`
	Props     map[string]any     `json:"props"`
	Content   []document.TextRun `json:"content"`
	Children  []Block            `json:"children"`
	Table     *document.Grid     `json:"table,omitempty"`
	DataTable *TableRef          `json:"data_table,omitempty"`
	Board     *board.View        `json:"board,omitempty"`
}
type Options struct {
	RedactUnsafeLinks bool
	MaxBytes          int
	BudgetError       error
	used              *int
	URLs              URLPolicy
	Asset             func(string) (string, error)
	Table             func(table.Reference) (TableRef, error)
	Sheet             func(string, string) (TableRef, error)
	Board             func(document.BoardReference) (board.View, error)
}

// Project copies only renderer fields, rewriting managed media and removing editor-only state.
func Project(blocks []document.Block, options Options) ([]Block, error) {
	result := []Block{}
	if options.MaxBytes > 0 && options.used == nil {
		options.used = new(int)
	}
	for _, source := range blocks {
		if source.Type == "drawing" {
			continue
		}
		if !knownBlock(source.Type) {
			return nil, Unsafe()
		}
		encoded, err := json.Marshal(document.Payload{Type: source.Type, Props: source.Props, Content: source.Content, Table: source.Table})
		if err != nil {
			return nil, err
		}
		var b document.Block
		if err := json.Unmarshal(encoded, &b); err != nil {
			return nil, err
		}
		b.ID = source.ID
		target := Block{ID: b.ID, Type: b.Type, Props: map[string]any{}, Content: b.Content, Children: []Block{}, Table: b.Table}
		for key, value := range b.Props {
			if !publicProperty(b.Type, key) {
				continue
			}
			switch value.(type) {
			case string, float64, bool, nil:
				target.Props[key] = value
			default:
				return nil, Unsafe()
			}
		}
		rewriteRuns := func(runs []document.TextRun) error {
			for i := range runs {
				if runs[i].Href != nil {
					value, err := options.link(*runs[i].Href)
					if err != nil {
						if options.RedactUnsafeLinks {
							runs[i].Href = nil
							continue
						}
						return err
					}
					runs[i].Href = &value
				}
			}
			return nil
		}
		if err := rewriteRuns(target.Content); err != nil {
			return nil, err
		}
		if target.Table != nil {
			for _, row := range target.Table.Rows {
				for _, cell := range row {
					if err := rewriteRuns(cell.Content); err != nil {
						return nil, err
					}
				}
			}
		}
		if href, ok := b.Props["href"].(string); ok && href != "" {
			value, err := options.link(href)
			if err != nil {
				if options.RedactUnsafeLinks {
					value = ""
				} else {
					return nil, err
				}
			}
			target.Props["href"] = value
		}
		if media, ok := b.Props["source"].(map[string]any); ok {
			var value string
			var err error
			switch media["type"] {
			case "asset":
				if options.Asset == nil {
					return nil, Unsafe()
				}
				value, err = options.Asset(media["asset_id"].(string))
			case "external":
				value, err = options.URLs.Link(media["url"].(string))
				if err != nil && options.RedactUnsafeLinks {
					err = nil
					value = ""
				}
			default:
				return nil, Unsafe()
			}
			if err != nil {
				return nil, err
			}
			if value == "" {
				target.Props["source"] = nil
			} else {
				target.Props["source"] = map[string]any{"type": "external", "url": value}
			}
		} else if b.Type == "image" || b.Type == "audio" || b.Type == "video" || b.Type == "file" || b.Type == "drawing" {
			target.Props["source"] = nil
		}
		if b.Type == "data_table" {
			if id, ok := b.Props["sheet_id"].(string); ok {
				if options.Sheet == nil {
					return nil, Unsafe()
				}
				view, _ := b.Props["sheet_view_id"].(string)
				projected, err := options.Sheet(id, view)
				if err != nil {
					return nil, err
				}
				target.DataTable = &projected
			}
			if ref, ok := document.TableReference(b.ID, document.Payload{Type: b.Type, Props: b.Props}); ok {
				if options.Table == nil {
					return nil, Unsafe()
				}
				projected, err := options.Table(ref)
				if err != nil {
					return nil, err
				}
				target.DataTable = &projected
			}
		}
		if b.Type == "board" {
			refs := document.BoardReferences([]document.Block{b})
			if len(refs) > 0 {
				if options.Board == nil {
					return nil, Unsafe()
				}
				view, err := options.Board(refs[0])
				if err != nil {
					return nil, err
				}
				target.Board = &view
			}
		}
		if options.used != nil {
			encoded, err := json.Marshal(target)
			if err != nil {
				return nil, err
			}
			*options.used += len(encoded) + 1
			if *options.used > options.MaxBytes {
				if options.BudgetError != nil {
					return nil, options.BudgetError
				}
				return nil, fault.New(fault.TooLarge, "PUBLIC_CONTENT_TOO_LARGE", "公开内容超出读取预算")
			}
		}
		children, err := Project(source.Children, options)
		if err != nil {
			return nil, err
		}
		target.Children = children
		result = append(result, target)
	}
	return result, nil
}
func PlainText(blocks []Block) string {
	values := []string{}
	var visit func([]Block)
	visit = func(items []Block) {
		for _, b := range items {
			var text strings.Builder
			for _, run := range b.Content {
				text.WriteString(run.Text)
			}
			if text.Len() > 0 {
				values = append(values, text.String())
			}
			for _, key := range []string{"title", "name", "caption", "alt"} {
				if value, ok := b.Props[key].(string); ok && value != "" {
					values = append(values, value)
				}
			}
			if b.Table != nil {
				for _, row := range b.Table.Rows {
					for _, cell := range row {
						var text strings.Builder
						for _, run := range cell.Content {
							text.WriteString(run.Text)
						}
						values = append(values, text.String())
					}
				}
			}
			if b.DataTable != nil {
				values = append(values, b.DataTable.Title)
			}
			if b.Board != nil && !b.Board.Restricted {
				values = append(values, b.Board.Title, b.Board.Text)
			}
			visit(b.Children)
		}
	}
	visit(blocks)
	return strings.Join(values, "\n")
}

// MarkdownBlocks is used only after the public projection has been authorized.
func MarkdownBlocks(blocks []Block) ([]document.Block, map[string][]byte, error) {
	result := []document.Block{}
	tables := map[string][]byte{}
	for _, b := range blocks {
		target := document.Block{ID: b.ID, Type: b.Type, Props: b.Props, Content: b.Content, Table: b.Table}
		if b.Type == "data_table" && b.DataTable != nil {
			data := table.Projection{Title: b.DataTable.Title, View: b.DataTable.View.Name, Version: b.DataTable.Version, Columns: []string{}, Rows: [][]string{}}
			if int64(len(b.DataTable.Items)) != b.DataTable.Total {
				return nil, nil, fmt.Errorf("public table export requires all records")
			}
			for _, field := range b.DataTable.Fields {
				data.Columns = append(data.Columns, field.Name)
			}
			for _, row := range b.DataTable.Items {
				cells := []string{}
				for _, field := range b.DataTable.Fields {
					cells = append(cells, table.Display(field, row.Values[field.ID]))
				}
				data.Rows = append(data.Rows, cells)
			}
			encoded, err := table.RenderExport(data, "markdown")
			if err != nil {
				return nil, nil, err
			}
			tables[b.ID] = encoded
		}
		children, childTables, err := MarkdownBlocks(b.Children)
		if err != nil {
			return nil, nil, err
		}
		target.Children = children
		for key, value := range childTables {
			tables[key] = value
		}
		result = append(result, target)
	}
	return result, tables, nil
}

func knownBlock(kind string) bool {
	switch kind {
	case "board":
		return true
	case "paragraph", "heading", "quote", "bullet_list_item", "numbered_list_item", "check_list_item", "toggle_list_item", "group", "divider", "code_block", "image", "audio", "video", "file", "drawing", "table", "data_table", "callout", "card", "card_group", "steps", "step", "tabs", "tab", "code_group":
		return true
	}
	return false
}
func publicProperty(kind, key string) bool {
	switch key {
	case "text_alignment", "text_color", "background_color":
		return true
	}
	switch kind {
	case "heading":
		return key == "level"
	case "numbered_list_item":
		return key == "start"
	case "check_list_item":
		return key == "checked"
	case "code_block":
		return key == "language"
	case "image", "audio", "video", "file":
		switch key {
		case "name", "caption", "alt", "width", "height", "show_preview":
			return true
		}
	case "drawing":
		return key == "caption"
	case "callout":
		return key == "title" || key == "tone"
	case "card", "step", "tab":
		return key == "title"
	case "card_group":
		return key == "columns"
	}
	return false
}

func (options Options) link(value string) (string, error) {
	if id, ok := document.ParseAssetLink(value); ok {
		if options.Asset == nil {
			return "", Unsafe()
		}
		return options.Asset(id)
	}
	return options.URLs.Link(value)
}
