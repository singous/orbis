// Package table owns document-scoped table definitions and versioned record commands.
package table

import (
	"context"

	"orbis.local/orbis/internal/platform/pagination"
)

const MaxFields = 64
const MaxViews = 24
const MaxOptions = 100
const MaxFilters = 20
const MaxSorts = 8
const MaxBatchRecords = 200
const MaxCellText = 8192
const MaxRecordBytes = 64 << 10
const MaxDefinitionBytes = 1 << 20
const MaxTransferRecords = 50000
const MaxTransferBytes = 16 << 20
const MaxVersion int64 = 1<<53 - 1
const MinDatetime int64 = -62135596800000
const MaxDatetime int64 = 253402300799999
const MinColumnWidth = 100
const MaxColumnWidth = 600
const MaxNameLength = 120
const MaxTitleLength = 240

type Option struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Color string `json:"color"`
}
type Field struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Kind    string   `json:"kind"`
	Options []Option `json:"options"`
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
	ID           string         `json:"id"`
	Name         string         `json:"name"`
	Kind         string         `json:"kind"`
	FieldIDs     []string       `json:"field_ids"`
	Widths       map[string]int `json:"widths"`
	Filters      []Filter       `json:"filters"`
	Sorts        []Sort         `json:"sorts"`
	GroupFieldID *string        `json:"group_field_id"`
}
type Definition struct {
	Title          string   `json:"title"`
	Fields         []Field  `json:"fields"`
	Views          []View   `json:"views"`
	PublicViewID   string   `json:"public_view_id"`
	PublicFieldIDs []string `json:"public_field_ids"`
}
type Scope struct{ ActorID, WorkspaceID, DocumentID, TableID string }
type Source struct {
	WorkspaceID     string `json:"workspace_id"`
	DocumentID      string `json:"document_id"`
	TableID         string `json:"table_id"`
	DocumentVersion *int64 `json:"document_version"`
}
type CreateInput struct {
	OperationID             string      `json:"operation_id"`
	ExpectedDocumentVersion int64       `json:"expected_document_version"`
	BlockID                 string      `json:"block_id"`
	Definition              *Definition `json:"definition"`
	Source                  *Source     `json:"source"`
}
type Upsert struct {
	ID     string         `json:"id"`
	Values map[string]any `json:"values"`
}
type RecordRestore struct {
	ID           string `json:"id"`
	TableVersion int64  `json:"table_version"`
}

type Changes struct {
	Restores   []RecordRestore `json:"restores"`
	Definition *Definition     `json:"definition"`
	Upserts    []Upsert        `json:"upserts"`
	Deletes    []string        `json:"deletes"`
}
type MutationInput struct {
	OperationID             string `json:"operation_id"`
	ExpectedDocumentVersion int64  `json:"expected_document_version"`
	ExpectedTableVersion    int64  `json:"expected_table_version"`
	Changes
}
type CreateCommand struct {
	Scope     Scope
	Input     CreateInput
	Hash      string
	Timestamp int64
}
type MutationCommand struct {
	Scope     Scope
	Input     MutationInput
	Hash      string
	Timestamp int64
}
type Result struct {
	TableID        string   `json:"table_id"`
	BlockID        string   `json:"block_id"`
	TableVersion   int64    `json:"table_version"`
	ContentVersion int64    `json:"content_version"`
	Inverse        *Changes `json:"inverse"`
}
type Metadata struct {
	TableID                      string
	BlockID                      string
	TableVersion, ContentVersion int64
	Definition                   Definition
	CreatedAtMS, UpdatedAtMS     int64
}
type Record struct {
	ID          string         `json:"id"`
	Values      map[string]any `json:"values"`
	CreatedAtMS int64          `json:"created_at_ms"`
	UpdatedAtMS int64          `json:"updated_at_ms"`
}
type Group struct {
	OptionID *string `json:"option_id"`
	Name     string  `json:"name"`
	Count    int64   `json:"count"`
}
type Query struct {
	Scope           Scope
	DocumentVersion int64
	ViewID          string
	GroupSet        bool
	GroupID         *string
	Page            pagination.Page
}
type Page struct {
	Metadata Metadata
	ViewID   string
	Items    []Record
	Groups   []Group
	Total    int64
}
type Snapshot struct {
	Metadata Metadata
	Records  []Record
}
type Projection struct {
	Title, View string
	Version     int64
	Columns     []string
	Rows        [][]string
}
type Reference struct {
	BlockID, TableID string
	Version          int64
}
type Repository interface {
	PublicRecords(context.Context, Query) (PublicPage, error)
	Create(context.Context, CreateCommand) (Result, error)
	Mutate(context.Context, MutationCommand) (Result, error)
	Metadata(context.Context, Query) (Metadata, error)
	Records(context.Context, Query) (Page, error)
	Export(context.Context, Query) (Projection, error)
}
