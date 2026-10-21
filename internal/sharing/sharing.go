// Package sharing owns revocable live access to a collection or document subtree.
package sharing

import (
	"context"

	"orbis.local/orbis/internal/asset"
	"orbis.local/orbis/internal/document/publicview"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/table"
	"orbis.local/orbis/internal/workspace"
)

const MaxVersion int64 = 1<<53 - 1
const MaxPageBytes = 8 << 20
const MaxReadConcurrency = 4
const MaxWindowPayloadBytes = 128 << 10
const MaxLifetimeMS int64 = 365 * 24 * 60 * 60 * 1000

type Scope struct{ ActorID, WorkspaceID, ShareID string }
type Share struct {
	ID, WorkspaceID, CollectionID, CreatedBy, Digest string
	RootDocumentID                                   *string
	Version                                          int64
	ExpiresAtMS, RevokedAtMS                         *int64
	CreatedAtMS, UpdatedAtMS                         int64
}
type CreateInput struct {
	CollectionID           string  `json:"collection_id"`
	RootDocumentID         *string `json:"root_document_id"`
	AcknowledgePublicScope bool    `json:"acknowledge_public_scope"`
	ExpiresAtMS            *int64  `json:"expires_at_ms"`
}
type Created struct {
	Share       Share
	Token, Path string
}
type Managed struct {
	Share Share
	Path  *string
}
type ListQuery struct {
	Scope          Scope
	CollectionID   *string
	RootSet        bool
	RootDocumentID *string
	Page           pagination.Page
}
type PublicQuery struct {
	Token, Digest, LegacyDigest, DocumentID, BlockID, TableID, AssetID, After string
	AfterPosition                                                             int
	ParentID                                                                  *string
	Version, DirectoryVersion                                                 int64
	Limit                                                                     int
	Page                                                                      pagination.Page
	ShareID                                                                   string
}
type Node struct {
	ID             string  `json:"id"`
	ParentID       *string `json:"parent_id"`
	Title          string  `json:"title"`
	Position       int     `json:"position"`
	ContentVersion int64   `json:"content_version"`
	UpdatedAtMS    int64   `json:"updated_at_ms"`
}
type Directory struct {
	Title            string
	RootDocumentID   *string
	DirectoryVersion int64
	Items            []Node
	Total            int64
}
type Document struct {
	ID             string `json:"id"`
	Title          string `json:"title"`
	ContentVersion int64  `json:"content_version"`
	UpdatedAtMS    int64  `json:"updated_at_ms"`
}
type Content struct {
	Document Document
	Blocks   []publicview.Block
}
type Block struct {
	ID       string           `json:"id"`
	ParentID *string          `json:"parent_id"`
	Position int              `json:"position"`
	Block    publicview.Block `json:"block"`
}
type ChildBlock struct {
	ID            string            `json:"id"`
	ParentID      *string           `json:"parent_id"`
	Position      int               `json:"position"`
	BlockType     string            `json:"block_type"`
	ChildCount    int               `json:"child_count"`
	PayloadBytes  int               `json:"payload_bytes"`
	PayloadLoaded bool              `json:"payload_loaded"`
	Block         *publicview.Block `json:"block"`
}
type ChildPage struct {
	HasMore  bool
	Document Document
	ShareID  string
	Items    []ChildBlock
}
type BlockPage struct {
	HasMore  bool
	Document Document
	ShareID  string
	Items    []Block
}
type PublicTablePage struct {
	Document Document
	Title    string
	Fields   []table.Field
	View     table.PublicView
	Groups   []table.Group
	Items    []table.PublicRecord
	Total    int64
}
type Repository interface {
	Create(context.Context, Scope, Share) (Share, error)
	List(context.Context, ListQuery) ([]Share, int64, error)
	Revoke(context.Context, Scope, int64, int64) (Share, error)
	Directory(context.Context, PublicQuery) (Directory, error)
	Document(context.Context, PublicQuery) (Document, error)
	Content(context.Context, PublicQuery) (Content, error)
	Children(context.Context, PublicQuery) (ChildPage, error)
	Blocks(context.Context, PublicQuery) (BlockPage, error)
	Block(context.Context, PublicQuery) (Block, error)
	Asset(context.Context, PublicQuery) (asset.Record, error)
	Table(context.Context, PublicQuery) (PublicTablePage, error)
}
type Access interface {
	Require(context.Context, string, string, workspace.Permission) error
}
