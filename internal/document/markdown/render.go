package markdown

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"unicode"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
)

const MaxExportBytes = 16 << 20
const MaxExportTables = 100
const MaxExportRecords = 50000

func ExportLimit() error {
	return fault.New(fault.Validation, "DOCUMENT_EXPORT_TOO_LARGE", "文档导出超过 16 MiB、100 个数据表格或 50,000 条表格记录限制")
}

type renderer struct {
	ctx      context.Context
	output   bytes.Buffer
	assetURL func(string) string
	tables   map[string][]byte
}

func Render(ctx context.Context, blocks []document.Block, workspaceID string, tables map[string][]byte) ([]byte, error) {
	return RenderWithAssetURL(ctx, blocks, tables, func(id string) string { return "/api/v1/workspaces/" + workspaceID + "/assets/" + id + "/content" })
}
func RenderWithAssetURL(ctx context.Context, blocks []document.Block, tables map[string][]byte, assetURL func(string) string) ([]byte, error) {
	encoded, err := json.Marshal(blocks)
	if err != nil {
		return nil, err
	}
	var copyBlocks []document.Block
	if err := json.Unmarshal(encoded, &copyBlocks); err != nil {
		return nil, err
	}
	var rewrite func([]document.Block)
	rewrite = func(items []document.Block) {
		for i := range items {
			b := &items[i]
			runs := func(values []document.TextRun) {
				for i := range values {
					if values[i].Href != nil {
						if id, ok := document.ParseAssetLink(*values[i].Href); ok {
							value := assetURL(id)
							values[i].Href = &value
						}
					}
				}
			}
			runs(b.Content)
			if href, ok := b.Props["href"].(string); ok {
				if id, ok := document.ParseAssetLink(href); ok {
					b.Props["href"] = assetURL(id)
				}
			}
			if b.Table != nil {
				for _, row := range b.Table.Rows {
					for _, cell := range row {
						runs(cell.Content)
					}
				}
			}
			rewrite(b.Children)
		}
	}
	rewrite(copyBlocks)
	blocks = copyBlocks
	r := renderer{ctx: ctx, assetURL: assetURL, tables: tables}
	if err := r.blocks(blocks, ""); err != nil {
		return nil, err
	}
	return r.output.Bytes(), nil
}
func (r *renderer) emit(value, prefix string) error {
	if err := r.ctx.Err(); err != nil {
		return err
	}
	for _, line := range strings.Split(value, "\n") {
		if r.output.Len()+len(prefix)+len(line)+1 > MaxExportBytes {
			return ExportLimit()
		}
		r.output.WriteString(prefix)
		r.output.WriteString(line)
		r.output.WriteByte('\n')
	}
	return nil
}
func (r *renderer) blocks(blocks []document.Block, prefix string) error {
	nextNumber, delimiter := 1, "."
	previousNumbered := false
	for _, b := range blocks {
		text := inline(b.Content)
		body, childPrefix := text, prefix
		marker := ""
		if b.Type != "numbered_list_item" {
			nextNumber, delimiter, previousNumbered = 1, ".", false
		}
		switch b.Type {
		case "heading":
			body = strings.Repeat("#", int(b.Props["level"].(float64))) + " " + text
		case "bullet_list_item", "toggle_list_item":
			marker = "- "
		case "numbered_list_item":
			number := nextNumber
			if start, ok := b.Props["start"].(float64); ok {
				number = int(start)
			}
			if previousNumbered && number != nextNumber {
				if delimiter == "." {
					delimiter = ")"
				} else {
					delimiter = "."
				}
			}
			marker = fmt.Sprintf("%d%s ", number, delimiter)
			nextNumber = number + 1
			previousNumbered = true
		case "check_list_item":
			marker = "- "
			if b.Props["checked"] == true {
				body = "[x] " + text
			} else {
				body = "[ ] " + text
			}
		case "quote", "callout":
			childPrefix = prefix + "> "
			if b.Type == "callout" {
				title, _ := b.Props["title"].(string)
				if title != "" {
					body = "**" + escapeText(title) + "**\n\n" + text
				}
			}
			if err := r.emit(body, childPrefix); err != nil {
				return err
			}
			body = ""
		case "code_block":
			var code strings.Builder
			for _, run := range b.Content {
				code.WriteString(run.Text)
			}
			value := code.String()
			fence := strings.Repeat("`", max(3, longest(value, '`')+1))
			language, _ := b.Props["language"].(string)
			if strings.ContainsAny(language, "`\r\n\x00") {
				language = ""
			}
			body = fence + language + "\n" + value + "\n" + fence
		case "divider":
			body = "---"
		case "image", "audio", "video", "file", "drawing":
			body = r.media(b)
		case "card", "step", "tab":
			title, _ := b.Props["title"].(string)
			body = "### " + escapeText(title)
			if href, ok := b.Props["href"].(string); ok && href != "" {
				body = "### [" + escapeText(title) + "](" + destination(href) + ")"
			}
		case "data_table":
			if data, ok := r.tables[b.ID]; ok {
				body = string(data)
			} else if b.Props["table_id"] != nil {
				return fmt.Errorf("missing table export projection")
			}
		case "table":
			body = renderGrid(b.Table)
		}
		if marker != "" {
			lines := strings.Split(body, "\n")
			body = marker + lines[0]
			if len(lines) > 1 {
				body += "\n" + strings.Repeat(" ", len(marker)) + strings.Join(lines[1:], "\n"+strings.Repeat(" ", len(marker)))
			}
			childPrefix = prefix + strings.Repeat(" ", len(marker))
		}
		if body != "" {
			if err := r.emit(body, prefix); err != nil {
				return err
			}
		}
		if len(b.Children) > 0 {
			if err := r.emit("", childPrefix); err != nil {
				return err
			}
			if err := r.blocks(b.Children, childPrefix); err != nil {
				return err
			}
		}
		if err := r.emit("", prefix); err != nil {
			return err
		}
	}
	return nil
}
func (r *renderer) media(b document.Block) string {
	label := b.Type
	for _, key := range []string{"caption", "name", "alt"} {
		if text, ok := b.Props[key].(string); ok && text != "" {
			label = text
			break
		}
	}
	source, ok := b.Props["source"].(map[string]any)
	if !ok {
		return escapeText(label)
	}
	target, _ := source["url"].(string)
	if source["type"] == "asset" {
		target = r.assetURL(source["asset_id"].(string))
	}
	if target == "" {
		return escapeText(label)
	}
	prefix := ""
	if b.Type == "image" || b.Type == "drawing" {
		prefix = "!"
	}
	return prefix + "[" + escapeText(label) + "](" + destination(target) + ")"
}
func longest(value string, needle rune) int {
	best, count := 0, 0
	for _, c := range value {
		if c == needle {
			count++
			best = max(best, count)
		} else {
			count = 0
		}
	}
	return best
}
func destination(value string) string {
	value = strings.NewReplacer(
		"<",
		"%3C",
		">",
		"%3E",
		"\n",
		"%0A",
		"\r",
		"%0D",
		"\t",
		"%09",
	).Replace(value)
	return "<" + strings.ReplaceAll(value, "&", "&amp;") + ">"
}
func escapeText(value string) string {
	var result strings.Builder
	leading := true
	for _, c := range value {
		switch c {
		case '&':
			result.WriteString("&amp;")
		case '<':
			result.WriteString("&lt;")
		case '>':
			result.WriteString("&gt;")
		case '\r':
			continue
		case '\n':
			result.WriteString("<br>")
			leading = true
			continue
		case ' ':
			if leading {
				result.WriteString("&#32;")
			} else {
				result.WriteRune(c)
			}
			continue
		case '\t':
			result.WriteString("&#9;")
			continue
		default:
			if c < 128 && strings.ContainsRune("!\"#$%'()*+,-./:;=?@[\\]^_`{|}~", c) {
				result.WriteByte('\\')
			}
			result.WriteRune(c)
		}
		leading = false
	}
	return result.String()
}
func inline(runs []document.TextRun) string {
	var result strings.Builder
	for _, run := range coalesceRuns(runs) {
		if run.Text == "" {
			continue
		}
		value := escapeText(run.Text)
		hasCode := false
		for _, mark := range run.Marks {
			if mark == "code" {
				hasCode = true
			}
		}
		if hasCode {
			fence := strings.Repeat("`", longest(run.Text, '`')+1)
			raw := strings.ReplaceAll(strings.ReplaceAll(run.Text, "\r", ""), "\n", " ")
			if strings.HasPrefix(raw, "`") || strings.HasSuffix(raw, "`") || (strings.HasPrefix(raw, " ") && strings.HasSuffix(raw, " ") && strings.TrimSpace(raw) != "") {
				raw = " " + raw + " "
			}
			value = fence + raw + fence
		} else {
			// Keep surrounding whitespace outside emphasis delimiters.
			left := run.Text[:len(run.Text)-len(strings.TrimLeftFunc(run.Text, unicode.IsSpace))]
			right := run.Text[len(strings.TrimRightFunc(run.Text, unicode.IsSpace)):]
			core := strings.TrimSpace(run.Text)
			if core != "" {
				value = escapeText(core)
				for _, mark := range []string{"italic", "bold", "strike"} {
					for _, m := range run.Marks {
						if m == mark {
							delimiter := map[string]string{"italic": "*", "bold": "**", "strike": "~~"}[mark]
							value = delimiter + value + delimiter
						}
					}
				}
				value = escapeText(left) + value + escapeText(right)
			}
		}
		if run.Href != nil {
			value = "[" + value + "](" + destination(*run.Href) + ")"
		}
		result.WriteString(value)
	}
	return result.String()
}
func renderGrid(grid *document.Grid) string {
	if grid == nil || len(grid.Rows) == 0 || len(grid.ColumnWidths) == 0 {
		return ""
	}
	width := len(grid.ColumnWidths)
	rows := make([][]string, len(grid.Rows))
	used := make([][]bool, len(rows))
	for i := range rows {
		rows[i] = make([]string, width)
		used[i] = make([]bool, width)
	}
	for y, row := range grid.Rows {
		x := 0
		for _, cell := range row {
			for x < width && used[y][x] {
				x++
			}
			rows[y][x] = tableCell(inline(cell.Content))
			for yy := y; yy < y+cell.RowSpan; yy++ {
				for xx := x; xx < x+cell.ColumnSpan; xx++ {
					used[yy][xx] = true
				}
			}
			x += cell.ColumnSpan
		}
	}
	if grid.HeaderRows == 0 {
		rows = append([][]string{make([]string, width)}, rows...)
	}
	var out strings.Builder
	for index, row := range rows {
		out.WriteString("| " + strings.Join(row, " | ") + " |\n")
		if index == 0 {
			out.WriteString("| " + strings.Repeat("--- | ", width) + "\n")
		}
	}
	return strings.TrimSuffix(out.String(), "\n")
}

// Coalesce adjacent equal styles so delimiter runs cannot become literal content.
func coalesceRuns(runs []document.TextRun) []document.TextRun {
	result := []document.TextRun{}
	var value strings.Builder
	var current document.TextRun
	previous := ""
	flush := func() {
		if value.Len() > 0 {
			current.Text = value.String()
			result = append(result, current)
			value.Reset()
		}
	}
	for _, run := range runs {
		flags := ""
		for _, mark := range []string{"bold", "italic", "strike", "code"} {
			for _, m := range run.Marks {
				if m == mark {
					flags += mark + ","
				}
			}
		}
		key := flags
		if run.Href != nil {
			key += "|" + *run.Href
		}
		if key != previous {
			flush()
			current = run
			previous = key
		} else if value.Len() == 0 {
			current = run
		}
		value.WriteString(run.Text)
	}
	flush()
	return result
}
func tableCell(value string) string {
	var result strings.Builder
	slashes := 0
	for _, r := range value {
		if r == '\n' || r == '\r' {
			continue
		}
		if r == '|' && slashes%2 == 0 {
			result.WriteByte('\\')
		}
		result.WriteRune(r)
		if r == '\\' {
			slashes++
		} else {
			slashes = 0
		}
	}
	return result.String()
}
