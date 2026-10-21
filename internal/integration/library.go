package integration

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"orbis.local/orbis/internal/asset"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/internal/sharing"
)

type LibraryQuery struct {
	Format                string
	Principal             Principal
	Page                  pagination.Page
	DocumentID            string
	CollectionID          *string
	ParentSet             bool
	ParentID              *string
	Text                  string
	ExactTitle            *string
	Version, SinceVersion int64
	BlockID               string
	Limit                 int
	Cursor                string
}
type LibraryDocument struct {
	Document document.Document
	Content  *document.Content
}
type OperationRecord struct {
	OperationID string          `json:"operation_id"`
	Kind        string          `json:"kind"`
	DocumentID  *string         `json:"document_id"`
	State       string          `json:"state"`
	Result      json.RawMessage `json:"result"`
	CreatedAtMS int64           `json:"created_at_ms"`
	UpdatedAtMS int64           `json:"updated_at_ms"`
}
type LibraryRepository interface {
	Search(context.Context, LibraryQuery) ([]SearchHit, int64, error)
	CreateShare(context.Context, Principal, sharing.Created) (sharing.Created, error)
	Shares(context.Context, Principal, sharing.ListQuery) ([]sharing.Share, int64, error)
	RevokeShare(context.Context, Principal, string, int64) (sharing.Share, error)
	BeginUpload(context.Context, Principal, string, UploadInput, string, int64) (UploadState, error)
	PublishUpload(context.Context, Principal, string, UploadInput, string, UploadObject) (UploadedFile, error)
	File(context.Context, Principal, string, string) (asset.Record, error)
	Export(context.Context, LibraryQuery) (ExportSnapshot, error)
	Create(context.Context, CreateDocumentCommand) (CreatedDocument, error)
	Collections(context.Context, LibraryQuery) ([]document.Collection, int64, error)
	Documents(context.Context, LibraryQuery) ([]document.Document, int64, error)
	Document(context.Context, LibraryQuery) (document.Document, error)
	Content(context.Context, LibraryQuery) (document.Content, error)
	BlockWindow(context.Context, LibraryQuery, string) (document.WindowPage, error)
	Block(context.Context, LibraryQuery) (document.BlockRecord, int64, error)
	Outline(context.Context, LibraryQuery) (document.HeadingPage, error)
	Changes(context.Context, LibraryQuery) (document.ChangePage, error)
	Commands(context.Context, Principal, document.Command) (document.CommandResult, error)
	Preview(context.Context, Principal, document.Command) (document.CommandPreview, error)
	Operation(context.Context, Principal, string) (OperationRecord, error)
}
type Library struct {
	sharing        *sharing.Service
	maxUploadBytes int64
	objects        asset.Store
	repo           LibraryRepository
	clock          clock.Clock
	codecs         chan struct{}
}

func NewLibrary(repo LibraryRepository, c clock.Clock, objects asset.Store, maxUploadBytes int64, shares *sharing.Service) *Library {
	return &Library{sharing: shares, maxUploadBytes: min(maxUploadBytes, MaxAgentUploadBytes), objects: objects, repo: repo, clock: c, codecs: make(chan struct{}, 2)}
}
func (q LibraryQuery) Scope() document.DirectoryScope {
	return document.DirectoryScope{ActorID: q.Principal.UserID, WorkspaceID: q.Principal.Token.WorkspaceID, DocumentID: q.DocumentID}
}
func (l *Library) Collections(ctx context.Context, q LibraryQuery) ([]document.Collection, int64, error) {
	if err := q.Principal.Require(DocumentsRead); err != nil {
		return nil, 0, err
	}
	return l.repo.Collections(ctx, q)
}
func (l *Library) Documents(ctx context.Context, q LibraryQuery) ([]document.Document, int64, error) {
	if q.DocumentID != "" && !validResourceID(q.DocumentID) {
		return nil, 0, ScopeMissing()
	}
	q.Text = strings.TrimSpace(q.Text)
	if utf8.RuneCountInString(q.Text) > 240 || strings.ContainsRune(q.Text, 0) {
		return nil, 0, fault.Field("query.q", "搜索内容不能超过 240 字符")
	}
	if q.ExactTitle != nil {
		value := strings.TrimSpace(*q.ExactTitle)
		if n := utf8.RuneCountInString(value); n < 1 || n > 240 || strings.ContainsRune(value, 0) {
			return nil, 0, fault.Field("body.title", "标题格式或长度不正确")
		}
		q.ExactTitle = &value
	}

	if err := q.Principal.Require(DocumentsRead); err != nil {
		return nil, 0, err
	}
	if q.CollectionID != nil && !validResourceID(*q.CollectionID) {
		return nil, 0, fault.Field("query.collection_id", "文集 ID 不正确")
	}
	return l.repo.Documents(ctx, q)
}
func (l *Library) Document(ctx context.Context, q LibraryQuery) (document.Document, error) {
	if err := q.Principal.Require(DocumentsRead); err != nil {
		return document.Document{}, err
	}
	if !validResourceID(q.DocumentID) {
		return document.Document{}, ScopeMissing()
	}
	return l.repo.Document(ctx, q)
}
func (l *Library) Content(ctx context.Context, q LibraryQuery) (document.Content, error) {
	if err := q.Principal.Require(DocumentsRead); err != nil {
		return document.Content{}, err
	}
	if !validResourceID(q.DocumentID) {
		return document.Content{}, ScopeMissing()
	}
	return l.repo.Content(ctx, q)
}
func (l *Library) BlockWindow(ctx context.Context, q LibraryQuery, kind string) (document.WindowPage, error) {
	if err := q.Principal.Require(DocumentsRead); err != nil {
		return document.WindowPage{}, err
	}
	if !validResourceID(q.DocumentID) {
		return document.WindowPage{}, ScopeMissing()
	}
	return l.repo.BlockWindow(ctx, q, kind)
}
func (l *Library) Block(ctx context.Context, q LibraryQuery) (document.BlockRecord, int64, error) {
	if err := q.Principal.Require(DocumentsRead); err != nil {
		return document.BlockRecord{}, 0, err
	}
	if !validResourceID(q.DocumentID) || !validResourceID(q.BlockID) {
		return document.BlockRecord{}, 0, ScopeMissing()
	}
	return l.repo.Block(ctx, q)
}
func (l *Library) Outline(ctx context.Context, q LibraryQuery) (document.HeadingPage, error) {
	if err := q.Principal.Require(DocumentsRead); err != nil {
		return document.HeadingPage{}, err
	}
	return l.repo.Outline(ctx, q)
}
func (l *Library) Changes(ctx context.Context, q LibraryQuery) (document.ChangePage, error) {
	if err := q.Principal.Require(DocumentsRead); err != nil {
		return document.ChangePage{}, err
	}
	return l.repo.Changes(ctx, q)
}
func (l *Library) acquire(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case l.codecs <- struct{}{}:
		return nil
	default:
		return fault.New(fault.Unavailable, "INTEGRATION_BUSY", "集成写入或预览繁忙，请稍后重试")
	}
}
func (l *Library) Apply(ctx context.Context, p Principal, did string, input document.CommandsInput) (document.CommandResult, error) {
	if err := p.Require(DocumentsWrite); err != nil {
		return document.CommandResult{}, err
	}
	if !validResourceID(did) {
		return document.CommandResult{}, ScopeMissing()
	}
	if err := l.acquire(ctx); err != nil {
		return document.CommandResult{}, err
	}
	defer func() { <-l.codecs }()
	command, err := document.PrepareCommand(document.DirectoryScope{ActorID: p.UserID, WorkspaceID: p.Token.WorkspaceID, DocumentID: did}, input, p.Token.ID, l.clock.Now().UnixMilli())
	if err != nil {
		return document.CommandResult{}, err
	}
	return l.repo.Commands(ctx, p, command)
}
func (l *Library) Preview(ctx context.Context, p Principal, did string, input document.CommandsInput) (document.CommandPreview, error) {
	if err := p.Require(DocumentsWrite); err != nil {
		return document.CommandPreview{}, err
	}
	if !validResourceID(did) {
		return document.CommandPreview{}, ScopeMissing()
	}
	if err := l.acquire(ctx); err != nil {
		return document.CommandPreview{}, err
	}
	defer func() { <-l.codecs }()
	command, err := document.PrepareCommand(document.DirectoryScope{ActorID: p.UserID, WorkspaceID: p.Token.WorkspaceID, DocumentID: did}, input, p.Token.ID, l.clock.Now().UnixMilli())
	if err != nil {
		return document.CommandPreview{}, err
	}
	return l.repo.Preview(ctx, p, command)
}
func (l *Library) Operation(ctx context.Context, p Principal, id string) (OperationRecord, error) {
	if err := p.Require(DocumentsRead); err != nil {
		return OperationRecord{}, err
	}
	if !validResourceID(id) {
		return OperationRecord{}, fault.Field("path.operation_id", "操作 ID 不正确")
	}
	return l.repo.Operation(ctx, p, id)
}
func RequestHash(kind, did string, input any) (string, error) {
	encoded, err := json.Marshal(struct {
		Kind, DocumentID string
		Input            any
	}{kind, did, input})
	if err != nil {
		return "", err
	}
	return security.Digest(string(encoded)), nil
}
