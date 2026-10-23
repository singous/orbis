// Package reader renders the same public snapshot as accessible HTML and machine-readable exports.
package reader

import (
	"bytes"
	_ "embed"
	"encoding/xml"
	"fmt"
	"html"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/document/publicview"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/publishing"
	"orbis.local/orbis/internal/table"
)

//go:embed reader.css
var stylesheet []byte

//go:embed reader.js
var script []byte

var publicPositionID = regexp.MustCompile(`^public-(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*))*$`)

const MaxHTMLBytes = 16 << 20

func Asset(kind string) []byte {
	if kind == "css" {
		return append([]byte{}, stylesheet...)
	}
	return append([]byte{}, script...)
}

type writer struct {
	bytes.Buffer
	err error
}

func (w *writer) emit(value string) {
	if w.err != nil {
		return
	}
	if w.Len()+len(value) > MaxHTMLBytes {
		w.err = fault.New(fault.TooLarge, "SITE_HTML_TOO_LARGE", "页面超过 HTML 输出限制，请使用分页正文读取")
		return
	}
	w.Buffer.WriteString(value)
}
func escape(value string) string { return html.EscapeString(value) }
func anchorText(value string) string {
	var out strings.Builder
	hyphen := false
	for _, r := range strings.ToLower(value) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			out.WriteRune(r)
			hyphen = false
		} else if out.Len() > 0 && !hyphen {
			out.WriteByte('-')
			hyphen = true
		}
	}
	result := strings.Trim(out.String(), "-")
	if result == "" {
		return "section"
	}
	return result
}

type heading struct {
	ID, Title string
	Level     int
}

func headings(blocks []publicview.Block) ([]heading, map[string]string) {
	items := []heading{}
	ids := map[string]string{}
	counts := map[string]int{}
	var visit func([]publicview.Block)
	visit = func(blocks []publicview.Block) {
		for _, b := range blocks {
			if b.Type == "heading" {
				text := ""
				for _, run := range b.Content {
					text += run.Text
				}
				base := anchorText(text)
				counts[base]++
				id := base
				if counts[base] > 1 {
					id += "-" + strconv.Itoa(counts[base])
				}
				level := 1
				if n, ok := b.Props["level"].(float64); ok {
					level = int(n)
				}
				items = append(items, heading{ID: id, Title: text, Level: level})
				ids[b.ID] = id
			}
			visit(b.Children)
		}
	}
	visit(blocks)
	return items, ids
}
func style(props map[string]any) string {
	styles := []string{}
	if value, ok := props["text_alignment"].(string); ok {
		switch value {
		case "left", "center", "right", "justify":
			styles = append(styles, "text-align:"+value)
		}
	}
	palette := map[string]string{"gray": "#64748b", "brown": "#92400e", "red": "#dc2626", "orange": "#ea580c", "yellow": "#ca8a04", "green": "#16a34a", "blue": "#2563eb", "purple": "#9333ea", "pink": "#db2777", "transparent": "transparent"}
	for _, entry := range []struct{ key, property string }{{"text_color", "color"}, {"background_color", "background-color"}} {
		property := entry.property
		value, ok := props[entry.key].(string)
		if !ok || value == "default" {
			continue
		}
		color := palette[value]
		if strings.HasPrefix(value, "#") {
			valid := len(value) == 4 || len(value) == 5 || len(value) == 7 || len(value) == 9
			for _, digit := range value[1:] {
				if !strings.ContainsRune("0123456789abcdefABCDEF", digit) {
					valid = false
					break
				}
			}
			if valid {
				color = value
			}
		}
		if color != "" {
			styles = append(styles, property+":"+color)
		}
	}
	if len(styles) == 0 {
		return ""
	}
	return ` style="` + escape(strings.Join(styles, ";")) + `"`
}
func inline(runs []document.TextRun) string {
	var out strings.Builder
	for _, run := range runs {
		value := strings.ReplaceAll(escape(run.Text), "\n", "<br>")
		for _, mark := range run.Marks {
			tag := map[string]string{"bold": "strong", "italic": "em", "strike": "s", "underline": "u", "code": "code"}[mark]
			if tag != "" {
				value = "<" + tag + ">" + value + "</" + tag + ">"
			}
		}
		props := map[string]any{}
		if run.TextColor != nil {
			props["text_color"] = *run.TextColor
		}
		if run.BackgroundColor != nil {
			props["background_color"] = *run.BackgroundColor
		}
		if attr := style(props); attr != "" {
			value = "<span" + attr + ">" + value + "</span>"
		}
		if run.Href != nil {
			value = `<a href="` + escape(*run.Href) + `" rel="noopener noreferrer">` + value + `</a>`
		}
		out.WriteString(value)
	}
	return out.String()
}
func blocks(w *writer, items []publicview.Block, anchors map[string]string) {
	listKind := ""
	closeList := func() {
		if listKind != "" {
			w.emit("</" + listKind + ">")
			listKind = ""
		}
	}
	for _, b := range items {
		desired := ""
		switch b.Type {
		case "bullet_list_item", "check_list_item":
			desired = "ul"
		case "numbered_list_item":
			desired = "ol"
		}
		if desired != listKind {
			closeList()
			if desired != "" {
				attrs := ""
				if desired == "ol" {
					if start, ok := b.Props["start"].(float64); ok {
						attrs = ` start="` + strconv.Itoa(int(start)) + `"`
					}
				}
				w.emit("<" + desired + attrs + ">")
				listKind = desired
			}
		}
		body := inline(b.Content)
		attrs := ` id="block-` + escape(b.ID) + `"` + style(b.Props)
		switch b.Type {
		case "paragraph":
			w.emit("<p" + attrs + ">" + body + "</p>")
			blocks(w, b.Children, anchors)
		case "heading":
			if publicPositionID.MatchString(b.ID) {
				w.emit(`<span id="heading-` + escape(strings.TrimPrefix(b.ID, "public-")) + `" aria-hidden="true"></span>`)
			}
			level := 1
			if n, ok := b.Props["level"].(float64); ok {
				level = int(n)
			}
			tag := "h" + strconv.Itoa(level)
			w.emit(`<span id="block-` + escape(b.ID) + `"></span><` + tag + ` id="` + escape(anchors[b.ID]) + `"` + style(b.Props) + `>` + body + `</` + tag + `>`)
		case "code_block":
			var code strings.Builder
			for _, run := range b.Content {
				code.WriteString(run.Text)
			}
			value := code.String()
			w.emit("<pre" + attrs + "><code>" + escape(value) + "</code></pre>")
		case "quote", "callout":
			w.emit("<blockquote" + attrs + ">")
			if title, ok := b.Props["title"].(string); ok && title != "" {
				w.emit("<strong>" + escape(title) + "</strong>")
			}
			w.emit("<p>" + body + "</p>")
			blocks(w, b.Children, anchors)
			w.emit("</blockquote>")
		case "bullet_list_item", "numbered_list_item", "check_list_item":
			class := ""
			if b.Type == "check_list_item" {
				class = ` class="task"`
			}
			if b.Type == "numbered_list_item" {
				if value, ok := b.Props["start"].(float64); ok {
					attrs += ` value="` + strconv.Itoa(int(value)) + `"`
				}
			}
			w.emit("<li" + attrs + class + ">")
			if b.Type == "check_list_item" {
				checked := ""
				if b.Props["checked"] == true {
					checked = " checked"
				}
				w.emit(`<input type="checkbox" disabled` + checked + ` aria-label="任务状态">`)
			}
			w.emit(body)
			blocks(w, b.Children, anchors)
			w.emit("</li>")
		case "toggle_list_item", "tab":
			w.emit("<details" + attrs + "><summary>")
			if b.Type == "tab" {
				title, _ := b.Props["title"].(string)
				w.emit(escape(title))
			} else {
				w.emit(body)
			}
			w.emit("</summary>")
			blocks(w, b.Children, anchors)
			w.emit("</details>")
		case "divider":
			w.emit("<hr" + attrs + ">")
		case "image", "drawing", "file", "audio", "video":
			media(w, b, attrs)
		case "board":
			if b.Board != nil && !b.Board.Restricted {
				w.emit(`<figure class="native-board"` + attrs + ` aria-label="` + escape(b.Board.Title) + `">`)
				// SVG is generated from validated primitives and escaped labels by the board projector.
				w.emit(b.Board.SVG)
				w.emit("<figcaption>" + escape(b.Board.Title) + "</figcaption></figure>")
			} else {
				w.emit(`<p class="muted">画板需要工作空间访问权限</p>`)
			}
		case "table":
			grid(w, b.Table)
		case "data_table":
			if b.DataTable != nil {
				publicTable(w, *b.DataTable)
			} else {
				w.emit(`<p class="muted">数据表尚未初始化</p>`)
			}
		case "card", "step":
			class := b.Type
			w.emit(`<section class="` + class + `"` + attrs + `>`)
			title, _ := b.Props["title"].(string)
			w.emit("<h3>")
			if href, ok := b.Props["href"].(string); ok && href != "" {
				w.emit(`<a href="` + escape(href) + `">` + escape(title) + `</a>`)
			} else {
				w.emit(escape(title))
			}
			w.emit("</h3>")
			blocks(w, b.Children, anchors)
			w.emit("</section>")
		default:
			class := ""
			if b.Type == "card_group" {
				class = "cards"
				if columns, ok := b.Props["columns"].(float64); ok && columns == 3 {
					class += " cards-three"
				}
			}
			if b.Type == "steps" {
				class = "steps"
			}
			w.emit(`<div class="` + class + `"` + attrs + `>`)
			w.emit(body)
			blocks(w, b.Children, anchors)
			w.emit("</div>")
		}
	}
	closeList()
}
func media(w *writer, b publicview.Block, attrs string) {
	source, ok := b.Props["source"].(map[string]any)
	if !ok {
		return
	}
	target, _ := source["url"].(string)
	if target == "" {
		return
	}
	label := b.Type
	for _, key := range []string{"alt", "name", "caption"} {
		if text, ok := b.Props[key].(string); ok && text != "" {
			label = text
			break
		}
	}
	w.emit(`<figure class="media"` + attrs + `>`)
	switch b.Type {
	case "image", "drawing":
		w.emit(`<img src="` + escape(target) + `" alt="` + escape(label) + `" loading="lazy" decoding="async" referrerpolicy="no-referrer">`)
	case "audio", "video":
		w.emit(`<` + b.Type + ` controls preload="metadata" src="` + escape(target) + `"><a href="` + escape(target) + `">` + escape(label) + `</a></` + b.Type + `>`)
	default:
		w.emit(`<a href="` + escape(target) + `" rel="noopener noreferrer">` + escape(label) + `</a>`)
	}
	if caption, ok := b.Props["caption"].(string); ok && caption != "" {
		w.emit("<figcaption>" + escape(caption) + "</figcaption>")
	}
	w.emit("</figure>")
}
func grid(w *writer, g *document.Grid) {
	if g == nil {
		return
	}
	w.emit(`<div class="table-scroll"><table class="regular-grid"><colgroup>`)
	for _, width := range g.ColumnWidths {
		if width == nil {
			w.emit(`<col>`)
		} else {
			w.emit(`<col style="width:` + strconv.Itoa(*width) + `px">`)
		}
	}
	w.emit(`</colgroup>`)
	used := make([][]bool, len(g.Rows))
	for i := range used {
		used[i] = make([]bool, len(g.ColumnWidths))
	}
	for y, row := range g.Rows {
		w.emit("<tr>")
		x := 0
		for _, cell := range row {
			for x < len(g.ColumnWidths) && used[y][x] {
				x++
			}
			tag := "td"
			if y < g.HeaderRows || x < g.HeaderColumns {
				tag = "th"
			}
			props := map[string]any{"text_alignment": cell.Alignment}
			if cell.TextColor != nil {
				props["text_color"] = *cell.TextColor
			}
			if cell.BackgroundColor != nil {
				props["background_color"] = *cell.BackgroundColor
			}
			scope := ""
			if tag == "th" {
				value := "row"
				if y < g.HeaderRows {
					value = "col"
				}
				scope = ` scope="` + value + `"`
			}
			w.emit("<" + tag + scope + ` rowspan="` + strconv.Itoa(cell.RowSpan) + `" colspan="` + strconv.Itoa(cell.ColumnSpan) + `"` + style(props) + ">" + inline(cell.Content) + "</" + tag + ">")
			for yy := y; yy < y+cell.RowSpan; yy++ {
				for xx := x; xx < x+cell.ColumnSpan; xx++ {
					used[yy][xx] = true
				}
			}
			x += cell.ColumnSpan
		}
		w.emit("</tr>")
	}
	w.emit("</table></div>")
}
func publicTable(w *writer, data publicview.TableRef) {
	w.emit(`<section data-table-url="` + escape(data.RecordsURL) + `" data-page="1"><h3>` + escape(data.Title) + `</h3>`)
	tableRecords(w, data)
	parsed, err := url.Parse(data.RecordsURL)
	if err == nil && parsed.Host == "" && strings.HasSuffix(parsed.Path, "/records") {
		parsed.Path = strings.TrimSuffix(parsed.Path, "/records") + "/html"
		w.emit(`<noscript><p><a href="` + escape(parsed.String()) + `">分页阅读完整表格</a></p></noscript>`)
	}

	disabled := ""
	if int64(len(data.Items)) >= data.Total {
		disabled = " disabled"
	}
	w.emit(`<div class="table-pager"><button type="button" data-table-page="-1" disabled>上一页</button><span class="table-status" data-table-status aria-live="polite">第 1 页，共 ` + strconv.FormatInt(data.Total, 10) + ` 条</span><button type="button" data-table-page="1"` + disabled + `>下一页</button></div></section>`)
}
func tableRecords(w *writer, data publicview.TableRef) {
	if data.View.Kind == "kanban" && data.View.GroupFieldID != nil {
		w.emit(`<div data-records class="board">`)
		groupID := *data.View.GroupFieldID
		for _, group := range data.Groups {
			key := ""
			if group.OptionID != nil {
				key = *group.OptionID
			}
			w.emit(`<section class="board-column"><h4>` + escape(group.Name) + ` (` + strconv.FormatInt(group.Count, 10) + `)</h4>`)
			for _, record := range data.Items {
				value, _ := record.Values[groupID].(string)
				if value != key {
					continue
				}
				w.emit(`<div class="record-card">`)
				for _, field := range data.Fields {
					w.emit(`<div class="record-field">` + escape(field.Name) + `</div><div>` + escape(table.Display(field, record.Values[field.ID])) + `</div>`)
				}
				w.emit(`</div>`)
			}
			w.emit(`</section>`)
		}
		w.emit(`</div>`)
	} else {
		w.emit(`<div data-records class="table-scroll"><table><thead><tr>`)
		for _, field := range data.Fields {
			width := ""
			if value, exists := data.View.Widths[field.ID]; exists {
				width = ` style="width:` + strconv.Itoa(value) + `px"`
			}
			w.emit(`<th scope="col"` + width + `>` + escape(field.Name) + `</th>`)
		}
		w.emit(`</tr></thead><tbody>`)
		for _, record := range data.Items {
			w.emit(`<tr>`)
			for _, field := range data.Fields {
				value := table.Display(field, record.Values[field.ID])
				if field.Kind == "url" && value != "" {
					w.emit(`<td><a href="` + escape(value) + `" rel="noopener noreferrer">` + escape(value) + `</a></td>`)
				} else {
					w.emit(`<td>` + escape(value) + `</td>`)
				}
			}
			w.emit(`</tr>`)
		}
		w.emit(`</tbody></table></div>`)
	}
}

// TableHTML provides bounded server-rendered pagination without requiring JavaScript.
func TableHTML(page publishing.TablePage, number int, basePath string) ([]byte, error) {
	var w writer
	w.emit(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>` + escape(page.Title) + `</title>` + brandIcons + `<link rel="stylesheet" href="/api/v1/public/reader.css"></head><body><main class="article"><h1>` + escape(page.Title) + `</h1>`)
	tableRecords(&w, publicview.TableRef{Title: page.Title, Fields: page.Fields, View: page.View, Items: page.Items, Groups: page.Groups, Total: page.Total})
	w.emit(`<nav aria-label="表格分页">`)
	link := func(target int, label string) {
		u := url.URL{Path: basePath}
		q := url.Values{}
		q.Set("page", strconv.Itoa(target))
		q.Set("release_id", page.ReleaseID)
		u.RawQuery = q.Encode()
		w.emit(`<a rel="nofollow" href="` + escape(u.String()) + `">` + label + `</a> `)
	}
	if number > 1 {
		link(number-1, "上一页")
	}
	w.emit(`第 ` + strconv.Itoa(number) + ` 页，共 ` + strconv.FormatInt(page.Total, 10) + ` 条 `)
	if int64(number)*pagination.MaxSize < page.Total {
		link(number+1, "下一页")
	}
	w.emit(`</nav></main></body></html>`)
	return w.Bytes(), w.err
}
func HTML(snapshot publishing.Snapshot, page publishing.Page, base string, search []publishing.SearchEntry, query string) ([]byte, error) {
	var w writer
	canonical := strings.TrimRight(base, "/") + "/s/" + snapshot.Slug + "/" + page.Slug
	title := page.Title + " · " + snapshot.Name
	description := page.Description
	if description == "" {
		description = snapshot.Description
	}
	w.emit(`<!doctype html><html lang="zh-CN"`)
	if snapshot.Branding.Theme != "system" {
		w.emit(` data-theme="` + escape(snapshot.Branding.Theme) + `"`)
	}
	w.emit(`><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>` + escape(title) + `</title>` + brandIcons + `<meta name="description" content="` + escape(description) + `"><link rel="canonical" href="` + escape(canonical) + `"><meta property="og:title" content="` + escape(title) + `"><meta property="og:description" content="` + escape(description) + `"><meta property="og:url" content="` + escape(canonical) + `"><meta property="og:type" content="article"><link rel="stylesheet" href="/api/v1/public/reader.css"><script defer src="/api/v1/public/reader.js"></script></head><body style="--accent:` + escape(snapshot.AccentColor) + `"><a class="skip" href="#content">跳到正文</a><header><button type="button" class="site-menu" data-menu-toggle aria-controls="site-navigation" aria-expanded="false">目录</button><a class="brand" href="/s/` + escape(snapshot.Slug) + `">`)
	if snapshot.Branding.LogoURL != nil {
		w.emit(`<img src="` + escape(*snapshot.Branding.LogoURL) + `" alt="">`)
	}
	w.emit(escape(snapshot.Name) + "</a>")
	for _, link := range snapshot.Branding.Links {
		w.emit(`<a class="header-link" href="` + escape(link.URL) + `" rel="noopener noreferrer">` + escape(link.Label) + `</a>`)
	}
	w.emit(`<form role="search" action="/s/` + escape(snapshot.Slug) + `"><label><span class="muted">搜索 </span><input type="search" name="q" value="` + escape(query) + `" placeholder="搜索站点文档" maxlength="240"></label></form><button type="button" data-theme-toggle aria-label="切换明暗主题">明暗</button>`)
	if snapshot.Branding.CTA != nil {
		w.emit(`<a class="cta" href="` + escape(snapshot.Branding.CTA.URL) + `">` + escape(snapshot.Branding.CTA.Label) + `</a>`)
	}
	w.emit(`</header><div class="layout"><nav id="site-navigation" aria-label="站点目录">`)
	section := ""
	for _, entry := range snapshot.Pages {
		label := ""
		if entry.Section != nil {
			label = *entry.Section
		} else if entry.Group != nil {
			label = *entry.Group
		}
		if label != "" && label != section {
			w.emit(`<div class="section-label">` + escape(label) + `</div>`)
			section = label
		}
		current := ""
		if entry.Slug == page.Slug {
			current = ` aria-current="page"`
		}
		indent := ""
		if entry.ParentSlug != nil {
			indent = ` style="padding-left:24px"`
		}
		w.emit(`<a href="/s/` + escape(snapshot.Slug) + `/` + escape(entry.Slug) + `"` + current + indent + `>` + escape(entry.Title) + `</a>`)
	}
	w.emit(`</nav><main id="content"><article>`)
	outline, anchors := headings(page.Blocks)
	if query != "" {
		w.emit("<h1>搜索结果</h1>")
		for _, entry := range search {
			w.emit(`<section class="search-result"><h2><a href="/s/` + escape(snapshot.Slug) + `/` + escape(entry.Slug) + `">` + escape(entry.Title) + `</a></h2><p>` + escape(entry.PlainText) + `</p></section>`)
		}
		if len(search) == 0 {
			w.emit("<p>没有匹配的文档</p>")
		}
	} else {
		w.emit("<h1>" + escape(page.Title) + "</h1>")
		if page.Description != "" {
			w.emit(`<p class="description">` + escape(page.Description) + `</p>`)
		}
		if page.UpdatedAtMS != nil {
			w.emit(`<p class="updated">更新于 ` + time.UnixMilli(*page.UpdatedAtMS).In(time.FixedZone("UTC+8", 8*60*60)).Format("2006-01-02") + `</p>`)
		}
		blocks(&w, page.Blocks, anchors)
	}
	w.emit(`</article><div class="page-links">`)
	for i, entry := range snapshot.Pages {
		if entry.Slug == page.Slug {
			if i > 0 {
				prev := snapshot.Pages[i-1]
				w.emit(`<a rel="prev" href="/s/` + escape(snapshot.Slug) + `/` + escape(prev.Slug) + `">← ` + escape(prev.Title) + `</a>`)
			}
			if i+1 < len(snapshot.Pages) {
				next := snapshot.Pages[i+1]
				w.emit(`<a rel="next" href="/s/` + escape(snapshot.Slug) + `/` + escape(next.Slug) + `">` + escape(next.Title) + ` →</a>`)
			}
		}
	}
	w.emit(`</div></main><aside aria-label="正文目录"><strong>本页内容</strong>`)
	for _, heading := range outline {
		w.emit(`<a href="#` + escape(url.PathEscape(heading.ID)) + `">` + escape(heading.Title) + `</a>`)
	}
	w.emit(`</aside></div><footer>`)
	for _, link := range snapshot.Branding.FooterLinks {
		w.emit(`<a href="` + escape(link.URL) + `" rel="noopener noreferrer">` + escape(link.Label) + `</a>`)
	}
	w.emit(brandAttribution() + `</footer></body></html>`)
	return w.Bytes(), w.err
}
func Error(code, message string) []byte {
	return []byte(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>` + escape(message) + `</title>` + brandIcons + `<link rel="stylesheet" href="/api/v1/public/reader.css"><main class="error"><h1>` + escape(message) + `</h1><p>` + escape(code) + `</p></main></html>`)
}
func Sitemap(snapshot publishing.Snapshot, base string) ([]byte, error) {
	type entry struct {
		Location string `xml:"loc"`
		Modified string `xml:"lastmod,omitempty"`
	}
	type urlSet struct {
		XMLName   xml.Name `xml:"urlset"`
		Namespace string   `xml:"xmlns,attr"`
		URLs      []entry  `xml:"url"`
	}
	set := urlSet{Namespace: "http://www.sitemaps.org/schemas/sitemap/0.9", URLs: []entry{}}
	for _, page := range snapshot.Pages {
		modified := ""
		if page.UpdatedAtMS != nil {
			modified = time.UnixMilli(*page.UpdatedAtMS).UTC().Format(time.RFC3339)
		}
		set.URLs = append(set.URLs, entry{Location: strings.TrimRight(base, "/") + "/s/" + snapshot.Slug + "/" + page.Slug, Modified: modified})
	}
	data, err := xml.Marshal(set)
	return append([]byte(xml.Header), data...), err
}
func Robots(snapshot publishing.Snapshot, base string) []byte {
	return []byte("User-agent: *\nAllow: /s/" + snapshot.Slug + "/\nSitemap: " + strings.TrimRight(base, "/") + "/s/" + snapshot.Slug + "/sitemap.xml\n")
}
func LLMs(snapshot publishing.Snapshot, base string) []byte {
	var out strings.Builder
	fmt.Fprintf(&out, "# %s\n\n%s\n\n", snapshot.Name, snapshot.Description)
	for _, page := range snapshot.Pages {
		fmt.Fprintf(&out, "- [%s](%s/s/%s/pages/%s.md)\n", strings.ReplaceAll(strings.ReplaceAll(page.Title, "[", "\\["), "]", "\\]"), strings.TrimRight(base, "/"), snapshot.Slug, page.Slug)
	}
	return []byte(out.String())
}
