// Package sheet owns independent structured records, views and collection forms.
package sheet

import "context"

const MaxFields = 128
const MaxViews = 24
const MaxBatch = 200
const PageSize = 100
const MaxText = 8192
const MaxRecordBytes = 64 << 10
const MaxDefinitionBytes = 1 << 20

type Scope struct{ WorkspaceID, ActorID, SheetID string }
type Option struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Color string `json:"color"`
}
type Field struct {
	CopyFrom    string   `json:"copy_from,omitempty"`
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Kind        string   `json:"kind"`
	Options     []Option `json:"options"`
	Default     any      `json:"default"`
	DateFormat  string   `json:"date_format,omitempty"`
	IncludeTime bool     `json:"include_time,omitempty"`
}
type Filter struct {
	FieldID  string `json:"field_id"`
	Operator string `json:"operator"`
	Value    any    `json:"value"`
}
type Sort struct {
	FieldID    string `json:"field_id"`
	Descending bool   `json:"descending"`
}
type View struct {
	TextColors          map[string]string `json:"text_colors,omitempty"`
	HighlightDuplicates []string          `json:"highlight_duplicates,omitempty"`
	ID                  string            `json:"id"`
	Name                string            `json:"name"`
	Kind                string            `json:"kind"`
	FieldIDs            []string          `json:"field_ids"`
	Widths              map[string]int    `json:"widths"`
	Filters             []Filter          `json:"filters"`
	Sorts               []Sort            `json:"sorts"`
	GroupFieldID        string            `json:"group_field_id"`
	RowHeight           int               `json:"row_height"`
}
type Definition struct {
	Fields []Field `json:"fields"`
	Views  []View  `json:"views"`
}
type Summary struct {
	ID           string `json:"id"`
	CollectionID string `json:"collection_id"`
	Title        string `json:"title"`
	CreatedAtMS  int64  `json:"created_at_ms"`
	UpdatedAtMS  int64  `json:"updated_at_ms"`
}
type ListPage struct {
	Items      []Summary `json:"items"`
	NextCursor string    `json:"next_cursor"`
}
type Sheet struct {
	SchemaVersion int64      `json:"schema_version"`
	DataRevision  int64      `json:"data_revision"`
	ID            string     `json:"id"`
	WorkspaceID   string     `json:"workspace_id"`
	CollectionID  string     `json:"collection_id"`
	Title         string     `json:"title"`
	Definition    Definition `json:"definition"`
	Version       int64      `json:"version"`
	CreatedAtMS   int64      `json:"created_at_ms"`
	UpdatedAtMS   int64      `json:"updated_at_ms"`
}
type Record struct {
	ID          string         `json:"id"`
	Version     int64          `json:"version"`
	Position    int64          `json:"position"`
	Values      map[string]any `json:"values"`
	CreatedBy   *string        `json:"created_by"`
	UpdatedBy   *string        `json:"updated_by"`
	CreatedAtMS int64          `json:"created_at_ms"`
	UpdatedAtMS int64          `json:"updated_at_ms"`
}
type Patch struct {
	ID      string         `json:"id"`
	Version int64          `json:"version"`
	Values  map[string]any `json:"values"`
	Delete  bool           `json:"delete,omitempty"`
}
type Changes struct {
	OperationID   string  `json:"operation_id"`
	SchemaVersion int64   `json:"schema_version"`
	Records       []Patch `json:"records"`
}
type ChangeResult struct {
	Records []Record `json:"records"`
	Deleted []string `json:"deleted"`
}
type Create struct {
	ID           string `json:"id"`
	CollectionID string `json:"collection_id"`
	Title        string `json:"title"`
	Template     string `json:"template"`
}
type Update struct {
	Version    int64      `json:"version"`
	Title      string     `json:"title"`
	Definition Definition `json:"definition"`
}
type Query struct {
	ViewID, Cursor, Search string
	Limit                  int
	Group                  *string
}
type Page struct {
	DuplicateIDs  map[string][]string `json:"duplicate_ids,omitempty"`
	Items         []Record            `json:"items"`
	NextCursor    string              `json:"next_cursor"`
	SchemaVersion int64               `json:"schema_version"`
}
type Group struct {
	Value string `json:"value"`
	Count int64  `json:"count"`
}
type Stats struct {
	Total  int64   `json:"total"`
	Groups []Group `json:"groups"`
}
type FormField struct {
	FieldID     string `json:"field_id"`
	Required    bool   `json:"required"`
	Description string `json:"description"`
}
type FormConfig struct {
	Title       string      `json:"title"`
	Description string      `json:"description"`
	Fields      []FormField `json:"fields"`
}
type Form struct {
	ID      string     `json:"id"`
	SheetID string     `json:"sheet_id"`
	Config  FormConfig `json:"config"`
	Enabled bool       `json:"enabled"`
	Version int64      `json:"version"`
	Token   string     `json:"token,omitempty"`
	Nonce   string     `json:"-"`
}
type PublicForm struct {
	ID      string     `json:"id"`
	Version int64      `json:"version"`
	Config  FormConfig `json:"config"`
	Fields  []Field    `json:"fields"`
}
type Submission struct {
	OperationID string         `json:"operation_id"`
	Version     int64          `json:"version"`
	Values      map[string]any `json:"values"`
}
type Repository interface {
	UploadScope(context.Context, string, string) (Scope, error)
	RegisterUpload(context.Context, string, string, string, int64) error
	List(context.Context, Scope, string, string) (ListPage, error)
	Create(context.Context, Scope, Create, int64) (Sheet, error)
	Get(context.Context, Scope) (Sheet, error)
	Update(context.Context, Scope, Update, int64) (Sheet, error)
	Records(context.Context, Scope, Query) (Page, error)
	Stats(context.Context, Scope, Query) (Stats, error)
	Change(context.Context, Scope, Changes, int64) (ChangeResult, error)
	Forms(context.Context, Scope) ([]Form, error)
	SaveForm(context.Context, Scope, Form, int64) (Form, error)
	PublicForm(context.Context, string) (Form, Sheet, error)
	Submit(context.Context, string, Submission, int64) error
}
