// Package board owns native diagram elements, bounded commands and revision contracts.
package board

import (
	"context"

	"orbis.local/orbis/internal/platform/pagination"
)

type Summary struct {
	ID           string `json:"id"`
	DocumentID   string `json:"document_id"`
	CollectionID string `json:"collection_id"`
	Title        string `json:"title"`
	UpdatedAtMS  int64  `json:"updated_at_ms"`
}

const (
	SchemaVersion             = 1
	MaxPageElements           = 10000
	MaxBoardElements          = 50000
	MaxPages                  = 20
	MaxBatch                  = 500
	MaxCommands               = 100
	MaxText                   = 8192
	MaxMembers                = 128
	MaxDepth                  = 32
	MaxPoints                 = 20000
	MaxPageBytes              = 20 << 20
	MaxSnapshotBytes          = 32 << 20
	MaxElementBytes           = 256 << 10
	MaxCommandBytes           = 1 << 20
	MaxChangeBytes            = 4 << 20
	MaxCoordinate             = 1000000
	MaxVersion          int64 = 1<<53 - 1
	ElementPageSize           = 500
	MaxElementPageBytes       = 4 << 20
	ChangePageSize            = 50
)

type Scope struct{ ActorID, WorkspaceID, BoardID, OwnerDocumentID string }
type Geometry struct {
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Width    float64 `json:"width"`
	Height   float64 `json:"height"`
	Rotation float64 `json:"rotation_rad"`
}
type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}
type Style struct {
	Fill        string  `json:"fill"`
	Stroke      string  `json:"stroke"`
	StrokeWidth float64 `json:"stroke_width"`
	FontSize    float64 `json:"font_size"`
	TextColor   string  `json:"text_color"`
	Opacity     float64 `json:"opacity"`
	Dashed      bool    `json:"dashed"`
	Bold        bool    `json:"bold"`
	Align       string  `json:"align"`
}
type Member struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
	Key  string `json:"key"`
}
type Endpoint struct {
	ElementID *string `json:"element_id"`
	Port      string  `json:"port"`
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
}
type Structure struct {
	ParentID    *string   `json:"parent_id"`
	Order       int64     `json:"order"`
	Members     []Member  `json:"members"`
	Start       *Endpoint `json:"start"`
	End         *Endpoint `json:"end"`
	Points      []Point   `json:"points"`
	Route       string    `json:"route"`
	StartMarker string    `json:"start_marker"`
	EndMarker   string    `json:"end_marker"`
	IconID      string    `json:"icon_id"`
	AssetID     *string   `json:"asset_id"`
	Collapsed   bool      `json:"collapsed"`
}
type Versions struct {
	Geometry  int64 `json:"geometry"`
	Style     int64 `json:"style"`
	Text      int64 `json:"text"`
	Structure int64 `json:"structure"`
}
type Element struct {
	ID           string    `json:"id"`
	PageID       string    `json:"page_id"`
	ShapeType    string    `json:"shape_type"`
	ShapeVersion int       `json:"shape_version"`
	Geometry     Geometry  `json:"geometry"`
	Style        Style     `json:"style"`
	Text         string    `json:"text"`
	Structure    Structure `json:"structure"`
	Versions     Versions  `json:"versions"`
	Version      int64     `json:"version"`
}
type Page struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Background string `json:"background"`
	Position   int    `json:"position"`
	Version    int64  `json:"version"`
}
type Board struct {
	ID            string `json:"id"`
	WorkspaceID   string `json:"workspace_id"`
	DocumentID    string `json:"document_id"`
	CollectionID  string `json:"collection_id"`
	Title         string `json:"title"`
	SchemaVersion int    `json:"schema_version"`
	Revision      int64  `json:"revision"`
	Pages         []Page `json:"pages"`
	CreatedAtMS   int64  `json:"created_at_ms"`
	UpdatedAtMS   int64  `json:"updated_at_ms"`
}
type Create struct {
	ID           string    `json:"id"`
	OperationID  string    `json:"operation_id"`
	CollectionID string    `json:"collection_id"`
	ParentID     *string   `json:"parent_id"`
	Title        string    `json:"title"`
	PageID       string    `json:"page_id"`
	Elements     []Element `json:"elements"`
}
type Patch struct {
	ID        string     `json:"id"`
	Expected  Versions   `json:"expected"`
	Geometry  *Geometry  `json:"geometry,omitempty"`
	Style     *Style     `json:"style,omitempty"`
	Text      *string    `json:"text,omitempty"`
	Structure *Structure `json:"structure,omitempty"`
}
type Target struct {
	ID      string `json:"id"`
	Version int64  `json:"version"`
}
type Command struct {
	Type     string    `json:"type"`
	Elements []Element `json:"elements,omitempty"`
	Patches  []Patch   `json:"patches,omitempty"`
	Targets  []Target  `json:"targets,omitempty"`
	Page     *Page     `json:"page,omitempty"`
}
type Mutation struct {
	OperationID   string    `json:"operation_id"`
	SchemaVersion int       `json:"schema_version"`
	Commands      []Command `json:"commands"`
}
type Change struct {
	OperationID  string    `json:"operation_id"`
	Revision     int64     `json:"revision"`
	Elements     []Element `json:"elements"`
	Deleted      []string  `json:"deleted"`
	Pages        []Page    `json:"pages"`
	DeletedPages []string  `json:"deleted_pages"`
	UpdatedAtMS  int64     `json:"updated_at_ms"`
}
type ElementQuery struct {
	PageID   string
	Revision int64
	Cursor   string
}
type ElementPage struct {
	Items      []Element `json:"items"`
	Revision   int64     `json:"revision"`
	NextCursor *string   `json:"next_cursor"`
	HasMore    bool      `json:"has_more"`
}
type ChangePage struct {
	Items    []Change `json:"items"`
	Revision int64    `json:"revision"`
	HasMore  bool     `json:"has_more"`
}
type HistoryItem struct {
	Revision    int64   `json:"revision"`
	ActorID     *string `json:"actor_id"`
	CreatedAtMS int64   `json:"created_at_ms"`
}
type Snapshot struct {
	Board    Board     `json:"board"`
	Elements []Element `json:"elements"`
}
type Repository interface {
	List(context.Context, Scope, string, pagination.Page) ([]Summary, int64, error)
	Create(context.Context, Scope, Create, string, int64) (Board, error)
	Get(context.Context, Scope, int64) (Board, error)
	Elements(context.Context, Scope, ElementQuery) (ElementPage, error)
	Mutate(context.Context, Scope, Mutation, string, int64) (Change, error)
	Changes(context.Context, Scope, int64) (ChangePage, error)
	Receipt(context.Context, Scope, string) (Change, error)
	Snapshot(context.Context, Scope, int64) (Snapshot, error)
	PageSnapshot(context.Context, Scope, string, int64) (Snapshot, error)
	History(context.Context, Scope, int64) ([]HistoryItem, error)
}
