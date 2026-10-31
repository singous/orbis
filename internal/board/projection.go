package board

import (
	"html"
	"math"
	"regexp"

	"orbis.local/orbis/internal/platform/fault"
)

var assetHref = regexp.MustCompile(`href="orbis-asset:([0-9a-f-]{36})"`)

func BindSVGAssets(svg string, resolve func(string) string) string {
	return assetHref.ReplaceAllStringFunc(svg, func(value string) string {
		match := assetHref.FindStringSubmatch(value)
		return `href="` + html.EscapeString(resolve(match[1])) + `"`
	})
}

// SelectFrame excludes outside endpoints and control points instead of leaking their data through clipping.
func SelectFrame(elements []Element, frameID *string) ([]Element, error) {
	if frameID == nil {
		return elements, nil
	}
	var frame *Element
	for i := range elements {
		if elements[i].ID == *frameID {
			frame = &elements[i]
			break
		}
	}
	if frame == nil || frame.ShapeType != "basic.frame" {
		return nil, fault.Missing()
	}
	g := frame.Geometry
	if g.Rotation != 0 {
		return nil, Invalid("公开画框暂不支持旋转，请先将画框角度设为零")
	}
	inside := func(p Point) bool { return p.X >= g.X && p.Y >= g.Y && p.X <= g.X+g.Width && p.Y <= g.Y+g.Height }
	visible := map[string]bool{}
	scene := map[string]Element{}
	for _, e := range elements {
		scene[e.ID] = e
		g := e.Geometry
		width := math.Abs(g.Width*math.Cos(g.Rotation)) + math.Abs(g.Height*math.Sin(g.Rotation))
		height := math.Abs(g.Width*math.Sin(g.Rotation)) + math.Abs(g.Height*math.Cos(g.Rotation))
		x, y := g.X+g.Width/2-width/2, g.Y+g.Height/2-height/2
		if e.ShapeType != "connector" && inside(Point{X: x, Y: y}) && inside(Point{X: x + width, Y: y + height}) {
			visible[e.ID] = true
		}
	}
	result := []Element{}
	for _, e := range elements {
		if e.ShapeType == "connector" {
			include := true
			for _, endpoint := range []*Endpoint{e.Structure.Start, e.Structure.End} {
				if endpoint != nil && endpoint.ElementID != nil && !visible[*endpoint.ElementID] {
					include = false
				}
			}
			for _, point := range EdgePoints(e, scene) {
				if !inside(point) {
					include = false
				}
			}
			if !include {
				continue
			}
		} else if !visible[e.ID] {
			continue
		}
		if e.Structure.ParentID != nil && !visible[*e.Structure.ParentID] {
			e.Structure.ParentID = nil
		}
		result = append(result, e)
	}
	return result, nil
}

// ExpandedElements retains data in storage while hiding collapsed descendants in rendered views.
func ExpandedElements(elements []Element) []Element {
	scene := make(map[string]Element, len(elements))
	for _, e := range elements {
		scene[e.ID] = e
	}
	hidden := map[string]bool{}
	for _, e := range elements {
		parent := e.Structure.ParentID
		for depth := 0; parent != nil && depth < MaxDepth; depth++ {
			p, ok := scene[*parent]
			if !ok {
				break
			}
			if p.Structure.Collapsed {
				hidden[e.ID] = true
				break
			}
			parent = p.Structure.ParentID
		}
	}
	result := make([]Element, 0, len(elements))
	for _, e := range elements {
		if hidden[e.ID] {
			continue
		}
		if e.ShapeType == "connector" {
			skip := false
			for _, endpoint := range []*Endpoint{e.Structure.Start, e.Structure.End} {
				if endpoint != nil && endpoint.ElementID != nil && hidden[*endpoint.ElementID] {
					skip = true
				}
			}
			if skip {
				continue
			}
		}
		result = append(result, e)
	}
	return result
}
