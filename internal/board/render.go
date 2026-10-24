package board

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"orbis.local/orbis/internal/platform/fault"
)

const MaxConcurrentPreviews = 4
const MaxSVGBytes = 16 << 20
const BoardFont = "Inter, Noto Sans SC, system-ui, sans-serif"

type View struct {
	Title      string `json:"title"`
	Revision   int64  `json:"revision"`
	SVG        string `json:"svg"`
	Restricted bool   `json:"restricted"`
	Text       string `json:"text"`
}
type Icon struct {
	Body   string `json:"body"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}
type Renderer struct {
	catalog Catalog
	icons   map[string]Icon
	slots   chan struct{}
}

func NewRenderer(catalog Catalog, data []byte) (*Renderer, error) {
	var resources struct {
		Icons map[string]Icon `json:"icons"`
	}
	if err := json.Unmarshal(data, &resources); err != nil {
		return nil, err
	}
	return &Renderer{catalog: catalog, icons: resources.Icons, slots: make(chan struct{}, MaxConcurrentPreviews)}, nil
}

// Acquire bounds both snapshot materialization and rendering across private and public views.
func (r *Renderer) Acquire(ctx context.Context) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	select {
	case r.slots <- struct{}{}:
		return func() { <-r.slots }, nil
	default:
		return nil, fault.New(fault.Unavailable, "BOARD_RENDER_BUSY", "画板预览繁忙，请稍后重试")
	}
}
func (r *Renderer) Catalog() Catalog { return r.catalog }
func Port(e Element, port string) Point {
	g := e.Geometry
	p := Point{X: g.X + g.Width/2, Y: g.Y + g.Height/2}
	parts := strings.Split(port, ":")
	switch parts[0] {
	case "left":
		p.X = g.X
	case "right":
		p.X = g.X + g.Width
	case "top":
		p.Y = g.Y
	case "bottom":
		p.Y = g.Y + g.Height
	case "time":
		if len(parts) == 2 && e.ShapeType == "uml.lifeline" {
			value, err := strconv.ParseFloat(parts[1], 64)
			if err == nil {
				p.Y = g.Y + g.Height*value
			}
		}
	}
	if isMindmapBranch(e) && (parts[0] == "left" || parts[0] == "right") {
		p.Y = g.Y + g.Height
	}
	if len(parts) == 2 && parts[0] != "time" {
		for index, member := range e.Structure.Members {
			if member.ID == parts[1] {
				p.Y = g.Y + 36 + (float64(index)+.5)*24
				break
			}
		}
	}
	cx, cy := g.X+g.Width/2, g.Y+g.Height/2
	x, y := p.X-cx, p.Y-cy
	return Point{X: cx + x*math.Cos(g.Rotation) - y*math.Sin(g.Rotation), Y: cy + x*math.Sin(g.Rotation) + y*math.Cos(g.Rotation)}
}
func isMindmapBranch(e Element) bool {
	return e.ShapeType == "mindmap.topic" || e.ShapeType == "mindmap.subtopic"
}
func endpointPoint(endpoint *Endpoint, elements map[string]Element) Point {
	if endpoint == nil {
		return Point{}
	}
	if endpoint.ElementID != nil {
		if e, exists := elements[*endpoint.ElementID]; exists {
			return Port(e, endpoint.Port)
		}
	}
	return Point{X: endpoint.X, Y: endpoint.Y}
}
func EdgePoints(e Element, elements map[string]Element) []Point {
	start, end := endpointPoint(e.Structure.Start, elements), endpointPoint(e.Structure.End, elements)
	if len(e.Structure.Points) > 0 {
		return append(append([]Point{start}, e.Structure.Points...), end)
	}
	if e.Structure.Route != "orthogonal" {
		return []Point{start, end}
	}
	if e.Structure.Start != nil && (e.Structure.Start.Port == "top" || e.Structure.Start.Port == "bottom") {
		mid := (start.Y + end.Y) / 2
		return []Point{start, {X: start.X, Y: mid}, {X: end.X, Y: mid}, end}
	}
	mid := (start.X + end.X) / 2
	return []Point{start, {X: mid, Y: start.Y}, {X: mid, Y: end.Y}, end}
}
func coordinate(value float64) string { return strconv.FormatFloat(value, 'f', 3, 64) }
func pointPath(points []Point) string {
	var value strings.Builder
	for i, p := range points {
		if i == 0 {
			value.WriteString("M")
		} else {
			value.WriteString("L")
		}
		value.WriteString(coordinate(p.X))
		value.WriteByte(' ')
		value.WriteString(coordinate(p.Y))
	}
	return value.String()
}
func TextLines(text string, width, font float64) []string {
	result := []string{}
	for _, paragraph := range strings.Split(text, "\n") {
		var line strings.Builder
		used := 0.0
		for _, letter := range paragraph {
			advance := font * .6
			if unicode.Is(unicode.Han, letter) || letter >= 0x3000 {
				advance = font
			}
			if strings.ContainsRune(" ilI.,:;!'|", letter) {
				advance = font * .32
			}
			if line.Len() > 0 && used+advance > width {
				result = append(result, line.String())
				line.Reset()
				used = 0
			}
			line.WriteRune(letter)
			used += advance
		}
		result = append(result, line.String())
	}
	return result
}
func (r *Renderer) SVG(ctx context.Context, elements []Element, background string, assetURL func(string) (string, error)) (string, error) {
	elements = ExpandedElements(elements)
	scene := make(map[string]Element, len(elements))
	minX, minY, maxX, maxY := 0.0, 0.0, 1.0, 1.0
	for _, e := range elements {
		scene[e.ID] = e
	}
	first := true
	include := func(x, y float64) {
		if first {
			minX, maxX, minY, maxY = x, x, y, y
			first = false
		}
		minX = math.Min(minX, x)
		minY = math.Min(minY, y)
		maxX = math.Max(maxX, x)
		maxY = math.Max(maxY, y)
	}
	for _, e := range elements {
		if e.ShapeType == "connector" {
			for _, p := range EdgePoints(e, scene) {
				include(p.X, p.Y)
			}
		} else {
			g := e.Geometry
			w := math.Abs(g.Width*math.Cos(g.Rotation)) + math.Abs(g.Height*math.Sin(g.Rotation))
			h := math.Abs(g.Width*math.Sin(g.Rotation)) + math.Abs(g.Height*math.Cos(g.Rotation))
			include(g.X+g.Width/2-w/2, g.Y+g.Height/2-h/2)
			include(g.X+g.Width/2+w/2, g.Y+g.Height/2+h/2)
		}
	}
	width, height := math.Max(1, maxX-minX)+80, math.Max(1, maxY-minY)+80
	var out bytes.Buffer
	fmt.Fprintf(&out, `<svg xmlns="http://www.w3.org/2000/svg" role="img" width="%s" height="%s" viewBox="%s %s %s %s" font-family="%s" stroke-linejoin="round" stroke-linecap="round"><rect x="%s" y="%s" width="%s" height="%s" fill="%s"/>`, coordinate(width), coordinate(height), coordinate(minX-40), coordinate(minY-40), coordinate(width), coordinate(height), BoardFont, coordinate(minX-40), coordinate(minY-40), coordinate(width), coordinate(height), xmlText(background))
	ordered := append([]Element{}, elements...)
	sort.SliceStable(ordered, func(i, j int) bool {
		a, b := r.catalog.Shapes[ordered[i].ShapeType].Container, r.catalog.Shapes[ordered[j].ShapeType].Container
		if a != b {
			return a
		}
		if ordered[i].Structure.Order != ordered[j].Structure.Order {
			return ordered[i].Structure.Order < ordered[j].Structure.Order
		}
		return ordered[i].ID < ordered[j].ID
	})
	for index, e := range ordered {
		if index%100 == 0 {
			if err := ctx.Err(); err != nil {
				return "", err
			}
		}
		if out.Len() > MaxSVGBytes {
			return "", Limit()
		}
		s, g, shape := e.Style, e.Geometry, r.catalog.Shapes[e.ShapeType]
		branch := isMindmapBranch(e)
		if branch && strings.EqualFold(s.Fill, "#ffffff") {
			s.Fill = "transparent"
		}
		stroke := fmt.Sprintf(`stroke="%s" stroke-width="%s"`, xmlText(s.Stroke), coordinate(s.StrokeWidth))
		if s.Dashed {
			stroke += ` stroke-dasharray="6 4"`
		}
		if e.ShapeType == "connector" {
			points := EdgePoints(e, scene)
			path := pointPath(points)
			if e.Structure.Route == "curve" && len(points) == 2 {
				a, b := points[0], points[1]
				mid := (a.X + b.X) / 2
				path = fmt.Sprintf("M%s %sC%s %s %s %s %s %s", coordinate(a.X), coordinate(a.Y), coordinate(mid), coordinate(a.Y), coordinate(mid), coordinate(b.Y), coordinate(b.X), coordinate(b.Y))
			}
			fmt.Fprintf(&out, `<path d="%s" fill="none" %s/>`, path, stroke)
			marker(&out, e.Structure.StartMarker, points[0], points[1], s)
			marker(&out, e.Structure.EndMarker, points[len(points)-1], points[len(points)-2], s)
			if e.Text != "" {
				p := points[len(points)/2]
				fmt.Fprintf(&out, `<text x="%s" y="%s" text-anchor="middle" font-size="%s" fill="%s">%s</text>`, coordinate(p.X), coordinate(p.Y-10), coordinate(s.FontSize), xmlText(s.TextColor), xmlText(e.Text))
			}
			continue
		}
		fmt.Fprintf(&out, `<g opacity="%s" transform="translate(%s %s) rotate(%s) translate(%s %s)">`, coordinate(s.Opacity), coordinate(g.X+g.Width/2), coordinate(g.Y+g.Height/2), coordinate(g.Rotation*180/math.Pi), coordinate(-g.Width/2), coordinate(-g.Height/2))
		path := shape.Path
		if path == "" && e.ShapeType != "basic.text" && e.ShapeType != "basic.image" {
			path = "M0 0H100V100H0Z"
		}
		if shape.Primitive == "line" && len(e.Structure.Points) > 0 {
			path = pointPath(e.Structure.Points)
		}
		fill := s.Fill
		if branch {
			if fill != "transparent" {
				fmt.Fprintf(&out, `<rect width="%s" height="%s" rx="6" fill="%s"/>`,
					coordinate(g.Width), coordinate(g.Height), xmlText(fill))
			}
			fill = "none"
		}
		if shape.Primitive == "initial" || shape.Primitive == "fork" {
			fill = s.Stroke
		}
		switch shape.Primitive {
		case "actor", "annotation", "line", "search":
			fill = "none"
		}
		if path != "" {
			fmt.Fprintf(&out, `<path d="%s" transform="scale(%s %s)" vector-effect="non-scaling-stroke" fill="%s" %s/>`, xmlText(path), coordinate(g.Width/100), coordinate(g.Height/100), xmlText(fill), stroke)
		}
		if shape.Primitive == "final" {
			fmt.Fprintf(&out, `<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="%s"/>`, coordinate(g.Width/2), coordinate(g.Height/2), coordinate(g.Width*.3), coordinate(g.Height*.3), xmlText(s.Stroke))
		}
		if e.Structure.AssetID != nil && assetURL != nil {
			url, err := assetURL(*e.Structure.AssetID)
			if err != nil {
				return "", err
			}
			fmt.Fprintf(&out, `<image href="%s" width="%s" height="%s" preserveAspectRatio="xMidYMid meet"/>`, xmlText(url), coordinate(g.Width), coordinate(g.Height))
		}
		if e.Structure.IconID != "" {
			icon, ok := r.icons[e.Structure.IconID]
			if ok {
				size := math.Min(36, math.Min(g.Width-16, g.Height-16))
				fmt.Fprintf(&out, `<svg x="10" y="10" width="%s" height="%s" viewBox="0 0 %d %d" color="%s">%s</svg>`, coordinate(size), coordinate(size), icon.Width, icon.Height, xmlText(s.TextColor), icon.Body)
			}
		}
		memberShape := shape.Primitive == "entity" || shape.Primitive == "weak-entity" || shape.Primitive == "class"
		if memberShape {
			fmt.Fprintf(&out, `<path d="M0 36H%s" fill="none" %s/>`, coordinate(g.Width), stroke)
			for i, member := range e.Structure.Members {
				prefix := ""
				if member.Key == "primary" {
					prefix = "PK "
				} else if member.Key == "foreign" {
					prefix = "FK "
				}
				label := prefix + member.Name
				if member.Type != "" {
					label += " : " + member.Type
				}
				fmt.Fprintf(&out, `<text x="12" y="%s" font-size="%s" fill="%s">%s</text>`, coordinate(36+(float64(i)+.75)*24), coordinate(s.FontSize), xmlText(s.TextColor), xmlText(label))
			}
		}
		if shape.Primitive == "lane" || shape.Primitive == "pool" {
			fmt.Fprintf(&out, `<path d="M40 0V%s" fill="none" %s/>`, coordinate(g.Height), stroke)
		}
		if shape.Primitive == "vertical-lane" || shape.Primitive == "phase" {
			fmt.Fprintf(&out, `<path d="M0 36H%s" fill="none" %s/>`, coordinate(g.Width), stroke)
		}
		top := memberShape || shape.Container || shape.Primitive == "lifeline"
		x, anchor := g.Width/2, "middle"
		if top || s.Align == "left" {
			x, anchor = 10, "start"
		} else if s.Align == "right" {
			x, anchor = g.Width-10, "end"
		}
		lines := TextLines(e.Text, math.Max(1, g.Width-20), s.FontSize)
		y := math.Max(s.FontSize, (g.Height-float64(len(lines))*s.FontSize*1.2)/2+s.FontSize)
		if top {
			y = 22
		}
		if shape.Primitive == "actor" {
			y = g.Height + s.FontSize + 5
		}
		weight := 400
		if s.Bold || top {
			weight = 600
		}
		fmt.Fprintf(&out, `<text text-anchor="%s" font-size="%s" font-weight="%d" fill="%s">`, anchor, coordinate(s.FontSize), weight, xmlText(s.TextColor))
		for i, line := range lines {
			fmt.Fprintf(&out, `<tspan x="%s" y="%s">%s</tspan>`, coordinate(x), coordinate(y+float64(i)*s.FontSize*1.2), xmlText(line))
		}
		out.WriteString("</text></g>")
	}
	out.WriteString("</svg>")
	if out.Len() > MaxSVGBytes {
		return "", Limit()
	}
	return out.String(), nil
}
func marker(out *bytes.Buffer, kind string, tip, previous Point, s Style) {
	if kind == "none" || kind == "" {
		return
	}
	angle := math.Atan2(tip.Y-previous.Y, tip.X-previous.X) * 180 / math.Pi
	fmt.Fprintf(out, `<g transform="translate(%s %s) rotate(%s)">`, coordinate(tip.X), coordinate(tip.Y), coordinate(angle))
	path, fill := "M0 0L-11 -5V5Z", s.Stroke
	switch kind {
	case "triangle":
		fill = s.Fill
	case "diamond":
		path = "M0 0L-9 -5L-18 0L-9 5Z"
	case "one":
		path = "M-8 -7V7"
		fill = "none"
	case "many":
		path = "M0 -8L-12 0L0 8M-12 0H0"
		fill = "none"
	}
	if kind == "circle" {
		fmt.Fprintf(out, `<circle cx="-5" r="5" fill="%s" stroke="%s"/>`, xmlText(s.Fill), xmlText(s.Stroke))
	} else {
		fmt.Fprintf(out, `<path d="%s" fill="%s" stroke="%s" stroke-width="%s"/>`, path, xmlText(fill), xmlText(s.Stroke), coordinate(s.StrokeWidth))
	}
	out.WriteString("</g>")
}

func xmlText(value string) string {
	clean := strings.Map(func(r rune) rune {
		if r == 9 || r == 10 || r == 13 || (r >= 0x20 && r <= 0xD7FF) || (r >= 0xE000 && r <= 0xFFFD) || (r >= 0x10000 && r <= 0x10FFFF) {
			return r
		}
		return 0xFFFD
	}, value)
	return html.EscapeString(clean)
}
