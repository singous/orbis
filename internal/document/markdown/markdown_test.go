package markdown

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
)

func flattenText(blocks []document.Block) string {
	var out strings.Builder
	for _, b := range blocks {
		for _, r := range b.Content {
			out.WriteString(r.Text)
		}
		if b.Table != nil {
			for _, row := range b.Table.Rows {
				for _, cell := range row {
					for _, r := range cell.Content {
						out.WriteString(r.Text)
					}
				}
			}
		}
		out.WriteString(flattenText(b.Children))
	}
	return out.String()
}
func TestParseRichMarkdownAndSafeFallbacks(t *testing.T) {
	wid := uuid.NewString()
	source := "\ufeff# 标题\r\n\r\n**粗体** 与 *斜体* ~~删除~~ `x < y` [链接](https://example.test/a_(b))\n\n- [x] 完成\n  - 子项\n\n> 引用\n>\n> ```go\n> fmt.Println(1)\n> ```\n\n| A | B |\n| :--- | ---: |\n| **甲** | 乙\\|丙 |\n\n之前 ![图片](https://example.test/a.png) 之后\n\n<div onclick=\"evil()\">原文</div>\n\n[保留](javascript:alert%281%29) ![保留](relative.png)\n"
	parsed, err := Parse(t.Context(), source, wid)
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]int{}
	for _, b := range parsed.Blocks {
		kinds[b.Type]++
	}
	if kinds["table"] != 1 || kinds["image"] != 1 || kinds["check_list_item"] != 1 {
		t.Fatalf("missing content: %v", kinds)
	}
	if len(parsed.Warnings) != 3 {
		t.Fatalf("warnings: %+v", parsed.Warnings)
	}
	text := flattenText(parsed.Blocks)
	for _, value := range []string{"标题", "粗体", "fmt.Println(1)", "乙|丙", "<div onclick=\"evil()\">原文</div>", "javascript:alert%281%29", "relative.png"} {
		if !strings.Contains(text, value) {
			t.Fatalf("lost %q in %q", value, text)
		}
	}
	for _, b := range parsed.Blocks {
		if b.Table != nil {
			if b.Table.Rows[1][1].Alignment != "right" {
				t.Fatal("lost table alignment")
			}
		}
	}
}
func TestRoundTripEscapesListsLinksCodeAndGrid(t *testing.T) {
	source := "# 标题\n\nA &amp; B &lt;x&gt; **加粗** [符号](<https://example.test/a(b)?x=1&y=2>) `x``y`\n\n3. 三\n   - 子\n4. 四\n\n> 引用\n> 第二行\n\n````go\n``` inside\n````\n\n| 字段 | 值 |\n| --- | --- |\n| a\\|b | x&lt;y |\n"
	first, err := Parse(t.Context(), source, uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	output, err := Render(t.Context(), first.Blocks, uuid.NewString(), nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Parse(t.Context(), string(output), uuid.NewString())
	if err != nil {
		t.Fatalf("%s: %v", output, err)
	}
	if flattenText(first.Blocks) != flattenText(second.Blocks) {
		t.Fatalf("round trip changed text\nbefore: %q\nafter: %q\nmarkdown:\n%s", flattenText(first.Blocks), flattenText(second.Blocks), output)
	}
	if strings.Contains(string(output), "<x>") {
		t.Fatal("unescaped HTML")
	}
}
func TestMarkdownLimitsAndCancellation(t *testing.T) {
	for _, source := range []string{strings.Repeat("a", MaxImportBytes+1), "x\x00y", strings.Repeat("> ", document.MaxDepth+2) + "deep"} {
		if _, err := Parse(t.Context(), source, uuid.NewString()); err == nil {
			t.Fatal("accepted oversized or invalid source")
		}
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := Parse(ctx, "hello", uuid.NewString()); err == nil {
		t.Fatal("ignored canceled parse")
	}
	b := document.Block{ID: uuid.NewString(), Type: "data_table", Props: map[string]any{"table_id": uuid.NewString()}}
	if _, err := Render(t.Context(), []document.Block{b}, uuid.NewString(), map[string][]byte{b.ID: []byte(strings.Repeat("a", MaxExportBytes))}); err == nil {
		t.Fatal("ignored final newline export budget")
	}
}
func TestMergedGridAndComponentExport(t *testing.T) {
	grid := &document.Grid{HeaderRows: 1, Rows: [][]document.GridCell{
		{{Content: []document.TextRun{{Text: "merged"}}, ColumnSpan: 2, RowSpan: 2}},
		{},
		{{Content: []document.TextRun{{Text: "left"}}}, {Content: []document.TextRun{{Text: "right"}}}},
	}}
	blocks := []document.Block{
		{ID: uuid.NewString(), Type: "table", Table: grid},
		{ID: uuid.NewString(), Type: "card", Props: map[string]any{"title": "Card", "href": "https://example.test"}, Children: []document.Block{
			{ID: uuid.NewString(), Type: "paragraph", Content: []document.TextRun{{Text: "card text"}}},
		}},
	}
	normalized, err := document.Normalize(blocks)
	if err != nil {
		t.Fatal(err)
	}
	output, err := Render(t.Context(), normalized, uuid.NewString(), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, part := range []string{"| merged |  |", "| left | right |", "Card", "card text"} {
		if !strings.Contains(string(output), part) {
			t.Fatalf("missing %q in %s", part, output)
		}
	}
}

func TestInlineStyleAndCodeRoundTrip(t *testing.T) {
	cases := [][]document.TextRun{
		{{Text: "one", Marks: []string{"bold"}}, {Text: "two", Marks: []string{"bold"}}},
		{{Text: "one", Marks: []string{"italic"}}, {Text: "two", Marks: []string{"bold"}}},
		{{Text: "*literal* <tag>", Marks: []string{"bold"}}},
		{{Text: "a|b", Marks: []string{"code"}}},
		{{Text: "x`y", Marks: []string{"code"}}},
		{{Text: "", Marks: []string{"code"}}},
	}
	for _, runs := range cases {
		b := document.Block{ID: uuid.NewString(), Type: "paragraph", Content: runs}
		normalized, err := document.Normalize([]document.Block{b})
		if err != nil {
			t.Fatal(err)
		}
		out, err := Render(t.Context(), normalized, uuid.NewString(), nil)
		if err != nil {
			t.Fatal(err)
		}
		parsed, err := Parse(t.Context(), string(out), uuid.NewString())
		if err != nil {
			t.Fatal(err)
		}
		if flattenText(normalized) != flattenText(parsed.Blocks) {
			t.Errorf("text changed: %q -> %q via %q", flattenText(normalized), flattenText(parsed.Blocks), out)
		}
	}
}

func TestGridCodePipeRoundTrip(t *testing.T) {
	b := document.Block{ID: uuid.NewString(), Type: "table", Table: &document.Grid{HeaderRows: 1, Rows: [][]document.GridCell{
		{{Content: []document.TextRun{{Text: "heading"}}}},
		{{Content: []document.TextRun{{Text: "a|b", Marks: []string{"code"}}}}},
	}}}
	blocks, err := document.Normalize([]document.Block{b})
	if err != nil {
		t.Fatal(err)
	}
	out, err := Render(t.Context(), blocks, uuid.NewString(), nil)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := Parse(t.Context(), string(out), uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	if flattenText(blocks) != flattenText(parsed.Blocks) {
		t.Fatalf("grid code lost pipe: %s", out)
	}
}

func TestRetiredDrawingsDoNotExportTheirPreview(t *testing.T) {
	output, err := Render(t.Context(), []document.Block{
		{ID: uuid.NewString(), Type: "paragraph", Content: []document.TextRun{{Text: "Before"}}},
		{ID: uuid.NewString(), Type: "drawing", Props: map[string]any{"caption": "Retired caption", "source": map[string]any{"type": "external", "url": "https://example.test/retired.png"}}},
		{ID: uuid.NewString(), Type: "paragraph", Content: []document.TextRun{{Text: "After"}}},
	}, uuid.NewString(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(output), "retired.png") || strings.Contains(string(output), "Retired caption") || !strings.Contains(string(output), "Before") || !strings.Contains(string(output), "After") {
		t.Fatalf("retired drawing changed surrounding content: %s", output)
	}
}
