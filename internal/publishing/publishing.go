// Package publishing owns site configuration, immutable releases and public delivery.
package publishing

import (
	"context"

	"orbis.local/orbis/internal/asset"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/document/publicview"
	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/table"
	"orbis.local/orbis/internal/workspace"
)

const DefaultPublicBaseURL = "http://localhost:9202"
const MaxPages = 200
const MaxSourceRules = 10000
const MaxPageSlug = 100
const MaxSiteSlug = 80
const MaxLinks = 20
const MaxConfigBytes = 2 << 20
const MaxSnapshotBytes = 32 << 20
const MaxSiteTables = 400
const MaxSiteRecords = 100000
const DefaultAccent = "#0f766e"
const MaxVersion int64 = 1<<53 - 1

type Scope struct{ ActorID, WorkspaceID, SiteID string }
type Navigation struct {
	DocumentID string  `json:"document_id"`
	Slug       string  `json:"slug"`
	Title      string  `json:"title"`
	Group      *string `json:"group"`
}
type CollectionBinding struct {
	CollectionID   string  `json:"collection_id"`
	RootDocumentID *string `json:"root_document_id"`
	Label          *string `json:"label"`
}
type Override struct {
	DocumentID  string  `json:"document_id"`
	Title       *string `json:"title"`
	Slug        *string `json:"slug"`
	Description *string `json:"description"`
}
type Source struct {
	Kind                string              `json:"kind"`
	Collections         []CollectionBinding `json:"collections"`
	ExcludedDocumentIDs []string            `json:"excluded_document_ids"`
	PageOverrides       []Override          `json:"page_overrides"`
}
type MediaSource struct {
	Type    string `json:"type"`
	AssetID string `json:"asset_id,omitempty"`
	URL     string `json:"url,omitempty"`
}
type Link struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}
type Branding struct {
	Logo        *MediaSource `json:"logo"`
	Links       []Link       `json:"links"`
	FooterLinks []Link       `json:"footer_links"`
	CTA         *Link        `json:"cta"`
	Theme       string       `json:"theme"`
}
type Config struct {
	Name        string       `json:"name"`
	Slug        string       `json:"slug"`
	Description string       `json:"description"`
	SiteKind    string       `json:"site_kind"`
	AccentColor string       `json:"accent_color"`
	Navigation  []Navigation `json:"navigation"`
	Source      Source       `json:"source"`
	Branding    Branding     `json:"branding"`
}
type Site struct {
	ID, WorkspaceID                   string
	Config                            Config
	Version                           int64
	PublishedReleaseID, PublishedSlug *string
	CreatedAtMS, UpdatedAtMS          int64
}
type PathEntry struct {
	Slug    string   `json:"slug"`
	Aliases []string `json:"aliases"`
}
type Registry map[string]PathEntry
type PageSource struct {
	DocumentID     string  `json:"document_id"`
	Slug           string  `json:"slug"`
	Title          string  `json:"title"`
	Group          *string `json:"group"`
	ParentSlug     *string `json:"parent_slug"`
	Section        *string `json:"section"`
	Description    string  `json:"description"`
	UpdatedAtMS    *int64  `json:"updated_at_ms"`
	ContentVersion int64   `json:"content_version"`
}
type Page struct {
	Slug        string             `json:"slug"`
	Title       string             `json:"title"`
	Group       *string            `json:"group"`
	ParentSlug  *string            `json:"parent_slug"`
	Section     *string            `json:"section"`
	Description string             `json:"description"`
	UpdatedAtMS *int64             `json:"updated_at_ms"`
	Blocks      []publicview.Block `json:"blocks"`
	PlainText   string             `json:"plain_text"`
}
type PageMetadata struct {
	Slug        string  `json:"slug"`
	Title       string  `json:"title"`
	Group       *string `json:"group"`
	ParentSlug  *string `json:"parent_slug"`
	Section     *string `json:"section"`
	Description string  `json:"description"`
	UpdatedAtMS *int64  `json:"updated_at_ms"`
}

func (p Page) Metadata() PageMetadata {
	return PageMetadata{Slug: p.Slug, Title: p.Title, Group: p.Group, ParentSlug: p.ParentSlug, Section: p.Section, Description: p.Description, UpdatedAtMS: p.UpdatedAtMS}
}

type PublicBranding struct {
	LogoURL     *string `json:"logo_url"`
	Links       []Link  `json:"links"`
	FooterLinks []Link  `json:"footer_links"`
	CTA         *Link   `json:"cta"`
	Theme       string  `json:"theme"`
}
type Snapshot struct {
	Name          string            `json:"name"`
	Slug          string            `json:"slug"`
	Description   string            `json:"description"`
	SiteKind      string            `json:"site_kind"`
	AccentColor   string            `json:"accent_color"`
	Branding      PublicBranding    `json:"branding"`
	Pages         []PageMetadata    `json:"pages"`
	Redirects     map[string]string `json:"redirects"`
	ReleaseID     *string           `json:"release_id"`
	ReleaseNumber *int64            `json:"release_number"`
	PublishedAtMS *int64            `json:"published_at_ms"`
}
type Preview struct {
	Snapshot          Snapshot `json:"snapshot"`
	Pages             []Page   `json:"pages"`
	SourceFingerprint string   `json:"source_fingerprint"`
}
type Changes struct {
	Added    []PageSource `json:"added"`
	Modified []PageSource `json:"modified"`
	Removed  []PageSource `json:"removed"`
}
type Sources struct {
	Pages             []PageSource `json:"pages"`
	ExcludedCount     int64        `json:"excluded_count"`
	SourceFingerprint string       `json:"source_fingerprint"`
	Changes           Changes      `json:"changes"`
}
type Release struct {
	ID            string `json:"id"`
	Number        int64  `json:"release_number"`
	PublishedAtMS int64  `json:"published_at_ms"`
	IsActive      bool   `json:"is_active"`
}
type PublishInput struct {
	OperationID               string `json:"operation_id"`
	ExpectedVersion           int64  `json:"expected_version"`
	ExpectedSourceFingerprint string `json:"expected_source_fingerprint"`
}
type ActivateInput struct {
	OperationID     string  `json:"operation_id"`
	ExpectedVersion int64   `json:"expected_version"`
	ReleaseID       *string `json:"release_id"`
}
type Mutation struct {
	Site    Site
	Release *Release
}
type PublicQuery struct {
	Slug              string
	PageSlug          string
	ExpectedReleaseID *string
}
type TableQuery struct {
	PublicQuery
	TableID string
	Page    pagination.Page
}
type TablePage struct {
	Groups    []table.Group
	ReleaseID string
	TableID   string
	Title     string
	Fields    []table.Field
	View      table.PublicView
	Items     []table.PublicRecord
	Total     int64
}
type SearchEntry struct {
	Slug      string `json:"slug"`
	Title     string `json:"title"`
	PlainText string `json:"plain_text"`
}
type SearchResult struct {
	ReleaseID string
	Items     []SearchEntry
	Total     int64
}
type DocumentSource struct {
	Metadata PageSource
	Document document.Document
	Blocks   []document.Block
}
type Repository interface {
	AssetByDigest(context.Context, PublicQuery, string) (asset.Record, error)
	Create(context.Context, Scope, Config, int64) (Site, error)
	Get(context.Context, Scope) (Site, error)
	List(context.Context, Scope, pagination.Page) ([]Site, int64, error)
	Update(context.Context, Scope, Config, int64, int64) (Site, error)
	Sources(context.Context, Scope) (Sources, error)
	Preview(context.Context, Scope) (Preview, error)
	Publish(context.Context, Scope, PublishInput, string, int64) (Mutation, error)
	Activate(context.Context, Scope, ActivateInput, string, int64) (Mutation, error)
	Releases(context.Context, Scope, pagination.Page) ([]Release, int64, error)
	Manifest(context.Context, PublicQuery) (Snapshot, error)
	Page(context.Context, PublicQuery) (Page, error)
	Search(context.Context, PublicQuery, string, pagination.Page) (SearchResult, error)
	Table(context.Context, TableQuery) (TablePage, error)
	Asset(context.Context, PublicQuery, string) (asset.Record, error)
	HydrateTables(context.Context, PublicQuery, []publicview.Block) ([]publicview.Block, error)
}
type Access interface {
	Require(context.Context, string, string, workspace.Permission) error
}
type Service struct {
	repo     Repository
	access   Access
	clock    clock.Clock
	building chan struct{}
}

func New(repo Repository, access Access, c clock.Clock) *Service {
	return &Service{repo: repo, access: access, clock: c, building: make(chan struct{}, MaxConcurrentBuilds)}
}
