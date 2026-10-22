package board_test

import (
	"encoding/xml"
	"io"
	"math"
	"strings"
	"testing"

	"github.com/google/uuid"

	"orbis.local/orbis/api"
	"orbis.local/orbis/internal/board"
)

func TestSVGPreservesLabelsWithoutExecutingMarkup(t *testing.T) {
	catalog, err := board.ParseCatalog(api.BoardCatalog)
	if err != nil {
		t.Fatal(err)
	}
	renderer, err := board.NewRenderer(catalog, api.BoardIcons)
	if err != nil {
		t.Fatal(err)
	}
	node := element("architecture.service", uuid.NewString())
	node.Text = `</text><script>alert("private")</script>`
	node.Structure.IconID = "server"
	svg, err := renderer.SVG(t.Context(), []board.Element{node}, "#ffffff", nil)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(svg, "<script") || !strings.Contains(svg, "&lt;") {
		t.Fatal("authored markup was not escaped")
	}
	decoder := xml.NewDecoder(strings.NewReader(svg))
	for {
		_, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
	}
}
func TestFrameProjectionExcludesRotatedOutsideNodesAndEdges(t *testing.T) {
	page := uuid.NewString()
	frame := element("basic.frame", page)
	frame.Geometry = board.Geometry{Width: 100, Height: 100}
	inside := element("flow.process", page)
	inside.Geometry = board.Geometry{X: 20, Y: 20, Width: 20, Height: 20}
	rotated := element("flow.process", page)
	rotated.Geometry = board.Geometry{Width: 100, Height: 100, Rotation: math.Pi / 4}
	rotated.Text = "outside secret"
	edge := element("connector", page)
	edge.Structure.Start = &board.Endpoint{ElementID: &inside.ID, Port: "right"}
	edge.Structure.End = &board.Endpoint{ElementID: &rotated.ID, Port: "left"}
	result, err := board.SelectFrame([]board.Element{frame, inside, rotated, edge}, &frame.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(result) != 2 {
		t.Fatalf("outside geometry leaked: %d elements", len(result))
	}
	for _, e := range result {
		if e.ID == rotated.ID || e.ID == edge.ID {
			t.Fatal("outside element leaked")
		}
	}
}
func TestSVGAssetBindingDoesNotRewriteUserText(t *testing.T) {
	id := uuid.NewString()
	svg := `<svg><text>href=&quot;orbis-asset:` + id + `&quot;</text><image href="orbis-asset:` + id + `"/></svg>`
	result := board.BindSVGAssets(svg, func(value string) string {
		if value != id {
			t.Fatal("unexpected asset")
		}
		return "/public/a?x=1&y=2"
	})
	if !strings.Contains(result, "href=&quot;orbis-asset:"+id) || !strings.Contains(result, `href="/public/a?x=1&amp;y=2"`) {
		t.Fatal("asset binding changed text or failed to escape URL")
	}
}

func TestRenderBudgetAndCollapsedBranches(t *testing.T) {
	catalog, _ := board.ParseCatalog(api.BoardCatalog)
	renderer, err := board.NewRenderer(catalog, api.BoardIcons)
	if err != nil {
		t.Fatal(err)
	}
	releases := []func(){}
	for i := 0; i < board.MaxConcurrentPreviews; i++ {
		release, err := renderer.Acquire(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		releases = append(releases, release)
	}
	if _, err := renderer.Acquire(t.Context()); err == nil {
		t.Fatal("unbounded previews")
	}
	for _, release := range releases {
		release()
	}
	release, err := renderer.Acquire(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	release()
	root := element("mindmap.root", uuid.NewString())
	root.Structure.Collapsed = true
	root.Text = "Root"
	child := element("mindmap.topic", root.PageID)
	child.Structure.ParentID = &root.ID
	child.Text = "Collapsed child"
	svg, err := renderer.SVG(t.Context(), []board.Element{root, child}, "#ffffff", nil)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(svg, "Collapsed") {
		t.Fatal("collapsed subtree rendered")
	}
	root.Text = "Control  and tab	"
	svg, err = renderer.SVG(t.Context(), []board.Element{root}, "#ffffff", nil)
	if err != nil {
		t.Fatal(err)
	}
	decoder := xml.NewDecoder(strings.NewReader(svg))
	for {
		_, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
	}
}
