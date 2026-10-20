package document

import (
	"encoding/json"
	"math"
	"strings"
	"unicode/utf8"

	"orbis.local/orbis/internal/platform/fault"
)

const DrawingVersion = 1
const MaxDrawingBytes = 1 << 20
const MaxDrawingElements = 2000
const MaxDrawingPoints = 20000
const MaxDrawingCoordinate = 1000000
const MaxDrawingCaption = 200
const MaxDrawingElementID = 200
const emptyDrawing = `{"version":1,"elements":[],"appState":{"viewBackgroundColor":"#ffffff"}}`

func coordinate(value any) bool {
	number, ok := value.(float64)
	return ok && !math.IsNaN(number) && !math.IsInf(number, 0) && math.Abs(number) <= MaxDrawingCoordinate
}
func drawingID(value any) bool {
	text, ok := value.(string)
	return ok && text != "" && utf8.RuneCountInString(text) <= MaxDrawingElementID && !strings.ContainsRune(text, 0)
}
func drawingFailure() error {
	return fault.Field("body.blocks", "绘图场景格式不正确或超出限制")
}

// normalizeDrawing retains the versioned editor scene as opaque JSON text, separate from its renderable preview.
func normalizeDrawing(block *Block) error {
	for key := range block.Props {
		if key != "scene" && key != "caption" && key != "source" {
			return drawingFailure()
		}
	}
	raw, exists := block.Props["scene"]
	if !exists {
		raw = ""
	}
	scene, ok := raw.(string)
	if !ok || len(scene) > MaxDrawingBytes {
		return drawingFailure()
	}
	if scene == "" {
		scene = emptyDrawing
	}
	var value map[string]any
	if json.Unmarshal([]byte(scene), &value) != nil || value["version"] != float64(DrawingVersion) {
		return drawingFailure()
	}
	elements, ok := value["elements"].([]any)
	if !ok || len(elements) > MaxDrawingElements {
		return drawingFailure()
	}
	seen := map[string]bool{}
	for _, raw := range elements {
		element, ok := raw.(map[string]any)
		if !ok || !drawingID(element["id"]) {
			return drawingFailure()
		}
		id := element["id"].(string)
		if seen[id] {
			return drawingFailure()
		}
		seen[id] = true
		if err := validateDrawingElement(element); err != nil {
			return err
		}
	}
	state, ok := value["appState"].(map[string]any)
	if !ok {
		return drawingFailure()
	}
	background, ok := state["viewBackgroundColor"].(string)
	if !ok || !validColor(background) || (background != "transparent" && !strings.HasPrefix(background, "#")) {
		return drawingFailure()
	}
	caption := ""
	if raw, exists := block.Props["caption"]; exists {
		var ok bool
		caption, ok = raw.(string)
		if !ok {
			return drawingFailure()
		}
	}
	if utf8.RuneCountInString(caption) > MaxDrawingCaption || strings.ContainsRune(caption, 0) {
		return drawingFailure()
	}
	preview := Block{Type: "image", Props: map[string]any{"source": block.Props["source"]}}
	if err := normalizeMedia(&preview); err != nil {
		return err
	}
	if len(elements) > 0 && preview.Props["source"] == nil {
		return fault.Field("body.blocks", "非空绘图必须提供预览图片")
	}
	block.Props = map[string]any{"scene": scene, "caption": caption, "source": preview.Props["source"]}
	return nil
}
func validateDrawingElement(element map[string]any) error {
	kind, ok := element["type"].(string)
	if !ok {
		return drawingFailure()
	}
	switch kind {
	case "rectangle", "diamond", "ellipse", "line", "arrow", "freedraw", "text":
	default:
		return drawingFailure()
	}
	for _, field := range []string{"x", "y", "width", "height"} {
		if !coordinate(element[field]) {
			return drawingFailure()
		}
	}
	if element["width"].(float64) < 0 || element["height"].(float64) < 0 {
		return drawingFailure()
	}
	for _, key := range []string{"isDeleted", "customData", "link"} {
		if value, exists := element[key]; exists && value != nil {
			encoded, _ := json.Marshal(value)
			if string(encoded) != "false" && string(encoded) != "{}" && string(encoded) != `""` {
				return drawingFailure()
			}
		}
	}
	rawPoints, present := element["points"]
	if present || kind == "line" || kind == "arrow" || kind == "freedraw" {
		points, ok := rawPoints.([]any)
		if !ok || len(points) == 0 || len(points) > MaxDrawingPoints {
			return drawingFailure()
		}
		for _, raw := range points {
			point, ok := raw.([]any)
			if !ok || len(point) != 2 || !coordinate(point[0]) || !coordinate(point[1]) {
				return drawingFailure()
			}
		}
	}
	for _, field := range []string{"strokeColor", "backgroundColor", "text", "originalText"} {
		if value, exists := element[field]; exists {
			if text, ok := value.(string); !ok || strings.ContainsRune(text, 0) {
				return drawingFailure()
			}
		}
	}
	if kind == "text" {
		if _, ok := element["text"].(string); !ok {
			return drawingFailure()
		}
	}
	if raw, exists := element["groupIds"]; exists {
		groups, ok := raw.([]any)
		if !ok {
			return drawingFailure()
		}
		for _, id := range groups {
			if !drawingID(id) {
				return drawingFailure()
			}
		}
	}
	if raw := element["boundElements"]; raw != nil {
		bindings, ok := raw.([]any)
		if !ok {
			return drawingFailure()
		}
		for _, raw := range bindings {
			binding, ok := raw.(map[string]any)
			if !ok || !drawingID(binding["id"]) || (binding["type"] != "arrow" && binding["type"] != "text") {
				return drawingFailure()
			}
		}
	}
	for _, field := range []string{"startBinding", "endBinding"} {
		if raw := element[field]; raw != nil {
			binding, ok := raw.(map[string]any)
			if !ok || !drawingID(binding["elementId"]) || !coordinate(binding["focus"]) || !coordinate(binding["gap"]) {
				return drawingFailure()
			}
		}
	}
	return nil
}
