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

func TestMindmapPortsFollowBranchUnderlines(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name     string
		shape    string
		rotation float64
		want     board.Point
	}{
		{name: "root center", shape: "mindmap.root", want: board.Point{X: 180, Y: 60}},
		{name: "topic underline", shape: "mindmap.topic", want: board.Point{X: 180, Y: 80}},
		{name: "subtopic underline", shape: "mindmap.subtopic", want: board.Point{X: 180, Y: 80}},
		{name: "rotated topic", shape: "mindmap.topic", rotation: math.Pi / 2, want: board.Point{X: 80, Y: 140}},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			node := element(tt.shape, uuid.NewString())
			node.Geometry = board.Geometry{X: 20, Y: 40, Width: 160, Height: 40, Rotation: tt.rotation}
			got := board.Port(node, "right")
			if math.Abs(got.X-tt.want.X) > .001 || math.Abs(got.Y-tt.want.Y) > .001 {
				t.Fatalf("right port = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestSVGPreservesMindmapCardsUnderlinesAndCustomColors(t *testing.T) {
	t.Parallel()
	catalog, err := board.ParseCatalog(api.BoardCatalog)
	if err != nil {
		t.Fatal(err)
	}
	renderer, err := board.NewRenderer(catalog, api.BoardIcons)
	if err != nil {
		t.Fatal(err)
	}
	root := element("mindmap.root", uuid.NewString())
	root.Style.Fill = "#7162b6"
	root.Style.TextColor = "#ffffff"
	root.Text = "Root"
	branch := element("mindmap.topic", root.PageID)
	branch.Geometry.X = 250
	branch.Text = "Branch"
	custom := element("mindmap.subtopic", root.PageID)
	custom.Geometry.X = 500
	custom.Style.Fill = "#dbeafe"
	custom.Style.TextColor = "#5b21b6"
	custom.Text = "Custom"
	svg, err := renderer.SVG(t.Context(), []board.Element{root, branch, custom}, "#ffffff", nil)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(svg, `d="M0 100H100"`) != 2 {
		t.Fatal("mindmap branches did not render as underlines")
	}
	for _, expected := range []string{
		`stroke-linejoin="round"`,
		`fill="#7162b6"`,
		`<rect width="180.000" height="80.000" rx="6" fill="#dbeafe"/>`,
		`fill="#5b21b6"`,
	} {
		if !strings.Contains(svg, expected) {
			t.Fatalf("SVG is missing %s", expected)
		}
	}
	if strings.Contains(svg, `fill="#ffffff" stroke=`) {
		t.Fatal("legacy default white branch cards should be transparent")
	}
	if branch.Style.Fill != "#ffffff" {
		t.Fatal("rendering changed authored branch data")
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
