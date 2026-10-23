package board_test

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"orbis.local/orbis/api"
	"orbis.local/orbis/internal/board"
)

func element(shape, page string) board.Element {
	return board.Element{ID: uuid.NewString(), PageID: page, ShapeType: shape, ShapeVersion: 1, Geometry: board.Geometry{Width: 180, Height: 80}, Style: board.Style{Fill: "#ffffff", Stroke: "#64748b", StrokeWidth: 1.5, FontSize: 14, TextColor: "#1e293b", Opacity: 1, Align: "center"}, Structure: board.Structure{Route: "orthogonal", StartMarker: "none", EndMarker: "arrow", Members: []board.Member{}, Points: []board.Point{}}, Versions: board.Versions{Geometry: 1, Style: 1, Text: 1, Structure: 1}, Version: 1}
}
func TestIndependentStylesDoNotConflictWithGeometry(t *testing.T) {
	e := element("flow.process", uuid.NewString())
	original := e.Versions
	moved := e.Geometry
	moved.X = 100
	e, err := board.ApplyPatch(e, board.Patch{ID: e.ID, Expected: original, Geometry: &moved})
	if err != nil {
		t.Fatal(err)
	}
	style := e.Style
	style.Fill = "#ff0000"
	e, err = board.ApplyPatch(e, board.Patch{ID: e.ID, Expected: original, Style: &style})
	if err != nil {
		t.Fatal(err)
	}
	if e.Geometry.X != 100 || e.Style.Fill != "#ff0000" {
		t.Fatal("independent changes were lost")
	}
	if _, err = board.ApplyPatch(e, board.Patch{ID: e.ID, Expected: original, Geometry: &moved}); err == nil {
		t.Fatal("stale geometry overwrote the accepted move")
	}
}
func TestParentCyclesAndMissingFieldPortsAreRejected(t *testing.T) {
	catalog, err := board.ParseCatalog(api.BoardCatalog)
	if err != nil {
		t.Fatal(err)
	}
	page := uuid.NewString()
	a, b := element("mindmap.topic", page), element("mindmap.topic", page)
	a.Structure.ParentID = &b.ID
	b.Structure.ParentID = &a.ID
	nodes := map[string]board.Element{a.ID: a, b.ID: b}
	get := func(id string) (board.Element, bool) { e, ok := nodes[id]; return e, ok }
	if catalog.ValidateRelations(a, get) == nil {
		t.Fatal("parent cycle accepted")
	}
	entity := element("er.entity", page)
	member := uuid.NewString()
	entity.Structure.Members = []board.Member{{ID: member, Name: "id", Type: "uuid", Key: "primary"}}
	nodes[entity.ID] = entity
	edge := element("connector", page)
	edge.Structure.Start = &board.Endpoint{ElementID: &entity.ID, Port: "right:" + member}
	edge.Structure.End = &board.Endpoint{X: 500, Y: 100}
	if err := catalog.ValidateRelations(edge, get); err != nil {
		t.Fatal(err)
	}
	entity.Structure.Members = []board.Member{}
	nodes[entity.ID] = entity
	if catalog.ValidateRelations(edge, get) == nil {
		t.Fatal("dangling field port accepted")
	}
}
func TestCatalogAndGeometryBudgets(t *testing.T) {
	catalog, err := board.ParseCatalog(api.BoardCatalog)
	if err != nil {
		t.Fatal(err)
	}
	e := element("flow.process", uuid.NewString())
	if err := catalog.Validate(&e); err != nil {
		t.Fatal(err)
	}
	e.Geometry.Width = -1
	if catalog.Validate(&e) == nil {
		t.Fatal("negative geometry accepted")
	}
	e = element("unknown.script", uuid.NewString())
	if catalog.Validate(&e) == nil {
		t.Fatal("unknown shape accepted")
	}
	raw, _ := json.Marshal(e)
	if len(raw) == 0 {
		t.Fatal("empty element serialization")
	}
}

func TestSharedTemplatesValidateCompleteRelationships(t *testing.T) {
	catalog, err := board.ParseCatalog(api.BoardCatalog)
	if err != nil {
		t.Fatal(err)
	}
	var data struct {
		Templates []struct {
			ID, Category string
			Elements     []board.Element
		}
	}
	if err := json.Unmarshal(api.BoardTemplates, &data); err != nil {
		t.Fatal(err)
	}
	categories := map[string]bool{}
	for _, template := range data.Templates {
		t.Run(template.ID, func(t *testing.T) {
			categories[template.Category] = true
			scene := map[string]board.Element{}
			for _, e := range template.Elements {
				if err := catalog.Validate(&e); err != nil {
					t.Fatal(err)
				}
				scene[e.ID] = e
			}
			for _, e := range template.Elements {
				if err := catalog.ValidateRelations(e, func(id string) (board.Element, bool) { e, ok := scene[id]; return e, ok }); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
	if len(categories) != 6 || len(data.Templates) != 24 {
		t.Fatal("incomplete launch catalog")
	}
}
