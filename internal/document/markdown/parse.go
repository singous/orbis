// Package markdown converts the document contract to and from portable Markdown.
package markdown

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/yuin/goldmark/v2/ast"
	"github.com/yuin/goldmark/v2/extension"
	east "github.com/yuin/goldmark/v2/extension/ast"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
)

const MaxImportBytes = 2 << 20
const MaxASTNodes = 100000
const MaxASTDepth = 128

type Warning struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
type Parsed struct {
	Blocks   []document.Block
	Warnings []Warning
}
type converter struct {
	ctx         context.Context
	source      []byte
	workspaceID string
	warnings    []Warning
}

func (p *converter) warn(code, message string) {
	for _, w := range p.warnings {
		if w.Code == code {
			return
		}
	}
	p.warnings = append(p.warnings, Warning{Code: code, Message: message})
}
func newBlock(kind string) document.Block {
	return document.Block{ID: uuid.NewString(), Type: kind, Props: map[string]any{}, Content: []document.TextRun{}, Children: []document.Block{}}
}

// Parse bounds input and AST complexity, then normalizes the resulting domain tree.
func Parse(ctx context.Context, source, workspaceID string) (Parsed, error) {
	return ParseWithLimit(ctx, source, workspaceID, MaxImportBytes)
}

// ParseWithLimit supports bounded staged sources; normalized document limits remain unchanged.
func ParseWithLimit(ctx context.Context, source, workspaceID string, limit int) (Parsed, error) {
	if limit < 0 || len(source) > limit {
		return Parsed{}, fault.New(fault.TooLarge, "MARKDOWN_TOO_LARGE", "Markdown 超出当前入口的大小限制")
	}
	if !utf8.ValidString(source) || strings.ContainsRune(source, 0) {
		return Parsed{}, fault.Field("body.markdown", "Markdown 必须是无空字符的 UTF-8 文本")
	}
	if err := ctx.Err(); err != nil {
		return Parsed{}, err
	}
	if strings.TrimSpace(source) == "" {
		return Parsed{Blocks: []document.Block{}, Warnings: []Warning{}}, nil
	}
	source = strings.TrimPrefix(source, "\ufeff")
	source = strings.ReplaceAll(strings.ReplaceAll(source, "\r\n", "\n"), "\r", "\n")
	if err := ctx.Err(); err != nil {
		return Parsed{}, err
	}
	p := converter{ctx: ctx, source: []byte(source), workspaceID: workspaceID, warnings: []Warning{}}
	root, err := parseAST(ctx, p.source)
	if err != nil {
		return Parsed{}, err
	}
	count, depth := 0, 0
	err = ast.Walk(root, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			depth--
			return ast.WalkContinue, nil
		}
		count++
		depth++
		if err := ctx.Err(); err != nil {
			return ast.WalkStop, err
		}
		if count > MaxASTNodes || depth > MaxASTDepth {
			return ast.WalkStop, fault.Field("body.markdown", "Markdown 结构复杂度超出限制")
		}
		return ast.WalkContinue, nil
	})
	if err != nil {
		return Parsed{}, err
	}
	blocks, err := p.blocks(root, 1)
	if err != nil {
		return Parsed{}, err
	}
	blocks, err = document.Normalize(blocks)
	return Parsed{Blocks: blocks, Warnings: p.warnings}, err
}
func (p *converter) blocks(parent ast.Node, depth int) ([]document.Block, error) {
	result := []document.Block{}
	if depth > document.MaxDepth {
		return nil, fault.Field("body.markdown", "Markdown 嵌套层级超出限制")
	}
	for n := range parent.Children() {
		if err := p.ctx.Err(); err != nil {
			return nil, err
		}
		b := newBlock("paragraph")
		switch n := n.(type) {
		case *ast.Paragraph:
			result = append(result, p.paragraph(n)...)
			continue
		case *ast.Heading:
			b.Type = "heading"
			b.Props["level"] = n.Level
			b.Content = p.runs(n)
		case *ast.CodeBlock:
			b.Type = "code_block"
			lang, _ := n.Language(p.source)
			b.Props["language"] = lang
			b.Content = []document.TextRun{{Text: strings.TrimSuffix(n.Value.Str(p.source), "\n")}}
		case *ast.HTMLBlock:
			b.Content = []document.TextRun{{Text: n.Value.Str(p.source)}}
			p.warn("RAW_HTML_AS_TEXT", "原始 HTML 已保留为纯文本")
		case *ast.ThematicBreak:
			b.Type = "divider"
		case *ast.Blockquote:
			b.Type = "quote"
			children, err := p.blocks(n, depth+1)
			if err != nil {
				return nil, err
			}
			b.Children = children
		case *ast.List:
			index := 0
			for item := range n.Children() {
				entry := newBlock("bullet_list_item")
				if n.IsOrdered() {
					entry.Type = "numbered_list_item"
					entry.Props["start"] = n.Start + index
				}
				if status, ok := extension.TaskStatusOf(item); ok {
					entry.Type = "check_list_item"
					entry.Props = map[string]any{"checked": status == extension.TaskStatusCompleted}
				}
				children, err := p.blocks(item, depth+1)
				if err != nil {
					return nil, err
				}
				if len(children) > 0 && children[0].Type == "paragraph" {
					entry.Content = children[0].Content
					children = children[1:]
				}
				entry.Children = children
				result = append(result, entry)
				index++
			}
			continue
		case *east.Table:
			b.Type = "table"
			b.Table = &document.Grid{HeaderRows: 1}
			var rows func(ast.Node)
			rows = func(node ast.Node) {
				if node.Kind() == east.KindTableRow || node.Kind() == east.KindTableHeader {
					cells := []document.GridCell{}
					for cell := range node.Children() {
						c := cell.(*east.TableCell)
						align := c.Alignment.String()
						if align == "none" {
							align = "left"
						}
						cells = append(cells, document.GridCell{Content: p.runs(c), Alignment: align})
					}
					b.Table.Rows = append(b.Table.Rows, cells)
					return
				}
				for child := range node.Children() {
					rows(child)
				}
			}
			rows(n)
		case *ast.LinkReferenceDefinition:
			continue
		default:
			return nil, fault.Field("body.markdown", "Markdown 包含无法转换的结构")
		}
		result = append(result, b)
		if len(result) > document.MaxBlocks {
			return nil, fault.Field("body.markdown", "Markdown 文档块数量超出限制")
		}
	}
	return result, nil
}

type inlinePart struct {
	run   *document.TextRun
	image *document.Block
}

func (p *converter) inline(parent ast.Node, marks []string, href *string) []inlinePart {
	result := []inlinePart{}
	add := func(value string, styles []string, link *string) {
		unique := []string{}
		seen := map[string]bool{}
		for _, mark := range styles {
			if !seen[mark] {
				unique = append(unique, mark)
				seen[mark] = true
			}
		}
		r := document.TextRun{Text: value, Marks: unique, Href: link}
		result = append(result, inlinePart{run: &r})
	}
	for n := range parent.Children() {
		switch n := n.(type) {
		case *ast.Text:
			value := n.Value.Value(p.source)
			if n.SoftLineBreak() || n.HardLineBreak() {
				value += "\n"
			}
			add(value, marks, href)
		case *ast.CodeSpan:
			add(n.Value.Value(p.source), append(append([]string{}, marks...), "code"), href)
		case *ast.Strong:
			result = append(result, p.inline(n, append(append([]string{}, marks...), "bold"), href)...)
		case *ast.Emphasis:
			result = append(result, p.inline(n, append(append([]string{}, marks...), "italic"), href)...)
		case *east.Strikethrough:
			result = append(result, p.inline(n, append(append([]string{}, marks...), "strike"), href)...)
		case *ast.Link:
			target := n.Destination.Value(p.source)
			prefix := "/api/v1/workspaces/" + p.workspaceID + "/assets/"
			if strings.HasPrefix(target, prefix) && strings.HasSuffix(target, "/content") {
				id := strings.TrimSuffix(strings.TrimPrefix(target, prefix), "/content")
				if tableID, err := uuid.Parse(id); err == nil && tableID != uuid.Nil && tableID.String() == id {
					target = document.AssetLink(id)
				}
			}

			var link *string
			if document.SafeLink(target) {
				link = &target
			} else {
				p.warn("LINK_AS_TEXT", "不支持的链接地址已保留为纯文本")
			}
			result = append(result, p.inline(n, marks, link)...)
			if link == nil {
				add(" ("+target+")", nil, nil)
			}
		case *ast.AutoLink:
			target := n.Destination.Value(p.source)
			label := n.Label.Value(p.source)
			if document.SafeLink(target) {
				add(label, marks, &target)
			} else {
				add(label, marks, nil)
				p.warn("LINK_AS_TEXT", "不支持的链接地址已保留为纯文本")
			}
		case *ast.Image:
			label := ""
			for _, r := range p.runs(n) {
				label += r.Text
			}
			target := n.Destination.Value(p.source)
			b := newBlock("image")
			b.Props["alt"] = label
			b.Props["caption"] = n.Title.Value(p.source)
			prefix := "/api/v1/workspaces/" + p.workspaceID + "/assets/"
			if strings.HasPrefix(target, prefix) && strings.HasSuffix(target, "/content") {
				id := strings.TrimSuffix(strings.TrimPrefix(target, prefix), "/content")
				parsed, err := uuid.Parse(id)
				if err == nil && parsed != uuid.Nil && parsed.String() == id {
					b.Props["source"] = map[string]any{"type": "asset", "asset_id": id}
				}
			} else if document.SafeLink(target) && (strings.HasPrefix(target, "https://") || strings.HasPrefix(target, "http://")) {
				b.Props["source"] = map[string]any{"type": "external", "url": target}
			}
			if b.Props["source"] == nil {
				add("!["+label+"]("+target+")", nil, nil)
				p.warn("IMAGE_AS_TEXT", "无法解析的图片地址已保留为纯文本；请上传文件后重新关联")
			} else {
				result = append(result, inlinePart{image: &b})
			}
		case *ast.RawHTML:
			raw := n.Value.Value(p.source)
			if raw == "<br>" || raw == "<br/>" || raw == "<br />" {
				add("\n", marks, href)
			} else {
				add(raw, marks, href)
				p.warn("RAW_HTML_AS_TEXT", "原始 HTML 已保留为纯文本")
			}
		default:
			result = append(result, p.inline(n, marks, href)...)
		}
	}
	return result
}
func (p *converter) paragraph(n ast.Node) []document.Block {
	result := []document.Block{}
	current := newBlock("paragraph")
	flush := func() {
		if len(current.Content) > 0 {
			result = append(result, current)
			current = newBlock("paragraph")
		}
	}
	for _, part := range p.inline(n, nil, nil) {
		if part.image != nil {
			flush()
			result = append(result, *part.image)
		} else {
			current.Content = append(current.Content, *part.run)
		}
	}
	flush()
	return result
}
func (p *converter) runs(n ast.Node) []document.TextRun {
	result := []document.TextRun{}
	for _, part := range p.inline(n, nil, nil) {
		if part.run != nil {
			result = append(result, *part.run)
			continue
		}
		image := *part.image
		source := image.Props["source"].(map[string]any)
		target, _ := source["url"].(string)
		if source["type"] == "asset" {
			target = "/api/v1/workspaces/" + p.workspaceID + "/assets/" + source["asset_id"].(string) + "/content"
		}
		result = append(result, document.TextRun{Text: "![" + image.Props["alt"].(string) + "](" + target + ")"})
		p.warn("IMAGE_AS_TEXT", "无法在标题或单元格中放置的图片已保留为纯文本")
	}
	// Nested equivalent styles do not change semantics or create duplicate marks.
	for i := range result {
		seen := map[string]bool{}
		marks := []string{}
		for _, mark := range result[i].Marks {
			if !seen[mark] {
				marks = append(marks, mark)
				seen[mark] = true
			}
		}
		result[i].Marks = marks
	}
	return result
}
