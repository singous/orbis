// Package integration coordinates document interchange without exposing transport or persistence types.
package integration

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/document/markdown"
	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/internal/workspace"
)

const MaxConcurrentTransfers = 2

type ImportInput struct {
	OperationID string  `json:"operation_id"`
	Title       string  `json:"title"`
	ParentID    *string `json:"parent_id"`
	Markdown    string  `json:"markdown"`
}
type ImportResult struct {
	Document document.Document
	Warnings []markdown.Warning
}
type ImportCommand struct {
	Scope    document.DirectoryScope
	Input    ImportInput
	Hash     string
	Document document.Document
	Parsed   markdown.Parsed
}
type ExportQuery struct {
	Scope   document.DirectoryScope
	Version int64
}
type ExportSnapshot struct {
	Content document.Content
	Tables  map[string][]byte
}
type ExportResult struct {
	Title   string
	Version int64
	Content []byte
}
type TransferRepository interface {
	Import(context.Context, ImportCommand) (ImportResult, error)
	Export(context.Context, ExportQuery) (ExportSnapshot, error)
}
type Transfers struct {
	permits chan struct{}
	repo    TransferRepository
	access  document.Access
	clock   clock.Clock
}

func NewTransfers(repo TransferRepository, access document.Access, c clock.Clock) *Transfers {
	return &Transfers{repo: repo, access: access, clock: c, permits: make(chan struct{}, MaxConcurrentTransfers)}
}
func (s *Transfers) Import(ctx context.Context, scope document.DirectoryScope, input ImportInput) (ImportResult, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Edit); err != nil {
		return ImportResult{}, err
	}
	validID := func(value string) bool {
		id, err := uuid.Parse(value)
		return err == nil && id != uuid.Nil && id.String() == value
	}
	if !validID(input.OperationID) {
		return ImportResult{}, fault.Field("body.operation_id", "操作 ID 必须是标准 UUID")
	}
	if input.ParentID != nil && !validID(*input.ParentID) {
		return ImportResult{}, fault.Field("body.parent_id", "父文档 ID 必须是标准 UUID 或 null")
	}
	input.Title = strings.TrimSpace(input.Title)
	if n := utf8.RuneCountInString(input.Title); n < 1 || n > 240 || strings.ContainsRune(input.Title, 0) {
		return ImportResult{}, fault.Field("body.title", "标题长度必须在 1 至 240 个字符之间")
	}
	if err := s.acquire(ctx); err != nil {
		return ImportResult{}, err
	}
	defer s.release()
	parsed, err := markdown.Parse(ctx, input.Markdown, scope.WorkspaceID)
	if err != nil {
		return ImportResult{}, err
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return ImportResult{}, err
	}
	now := s.clock.Now().UnixMilli()
	doc := document.Document{
		ID:             uuid.NewString(),
		WorkspaceID:    scope.WorkspaceID,
		CollectionID:   scope.CollectionID,
		Title:          input.Title,
		ParentID:       input.ParentID,
		ContentVersion: 1,
		CreatedAtMS:    now,
		UpdatedAtMS:    now,
	}
	return s.repo.Import(ctx, ImportCommand{Scope: scope, Input: input, Hash: security.Digest(string(encoded)), Document: doc, Parsed: parsed})
}
func (s *Transfers) Export(ctx context.Context, q ExportQuery) (ExportResult, error) {
	if err := s.access.Require(ctx, q.Scope.ActorID, q.Scope.WorkspaceID, workspace.Read); err != nil {
		return ExportResult{}, err
	}
	if q.Version < 0 || q.Version > document.MaxVersion {
		return ExportResult{}, fault.Field("query.version", "文档版本号不正确")
	}
	if err := s.acquire(ctx); err != nil {
		return ExportResult{}, err
	}
	defer s.release()
	snapshot, err := s.repo.Export(ctx, q)
	if err != nil {
		return ExportResult{}, err
	}
	content, err := markdown.Render(ctx, snapshot.Content.Blocks, q.Scope.WorkspaceID, snapshot.Tables)
	return ExportResult{Title: snapshot.Content.Revision.Title, Version: snapshot.Content.Revision.Version, Content: content}, err
}

// Fail fast at capacity instead of keeping an unbounded queue of decoded documents.
func (s *Transfers) acquire(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case s.permits <- struct{}{}:
		return nil
	default:
		return fault.New(fault.Unavailable, "DOCUMENT_TRANSFER_BUSY", "文档导入导出繁忙，请稍后重试")
	}
}
func (s *Transfers) release() { <-s.permits }
