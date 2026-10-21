// Package search defines workspace-scoped discovery of currently readable resources.
package search

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/workspace"
)

const MaxQueryLength = 240
const MaxSnippetLength = 240
const SnippetContext = 64

type Query struct {
	ActorID, WorkspaceID string
	Text, Type, Status   string
	ResourceID           *string
	Page                 pagination.Page
}
type Item struct {
	ID               string
	Type             string
	WorkspaceID      string
	Title            string
	Location         string
	Snippet          string
	Match            string
	MatchedCommentID *string
	Status           string
	UpdatedAtMS      int64
	CollectionID     *string
	GroupID          *string
}
type Result struct {
	Items []Item
	Total int64
}
type Repository interface {
	Search(context.Context, Query) (Result, error)
}
type Access interface {
	Require(context.Context, string, string, workspace.Permission) error
}
type Service struct {
	repo   Repository
	access Access
}

func New(repo Repository, access Access) *Service { return &Service{repo: repo, access: access} }
func (s *Service) Search(ctx context.Context, q Query) (Result, error) {
	if err := s.access.Require(ctx, q.ActorID, q.WorkspaceID, workspace.Read); err != nil {
		return Result{}, err
	}
	q.Text = strings.TrimSpace(q.Text)
	if !utf8.ValidString(q.Text) || utf8.RuneCountInString(q.Text) > MaxQueryLength || strings.ContainsRune(q.Text, 0) {
		return Result{}, fault.Field("query.q", "搜索内容最多 240 个字符，不能包含空字符")
	}
	switch q.Type {
	case "all", "document", "collection", "group", "file", "site":
	default:
		return Result{}, fault.Field("query.type", "搜索资源类型不正确")
	}
	switch q.Status {
	case "active", "archived", "all":
	default:
		return Result{}, fault.Field("query.status", "搜索状态不正确")
	}
	if q.ResourceID != nil {
		id, err := uuid.Parse(*q.ResourceID)
		if q.Type == "all" || err != nil || id == uuid.Nil || id.String() != *q.ResourceID {
			return Result{}, fault.Field("query.resource_id", "按资源 ID 定位须指定资源类型与标准 UUID")
		}
	}
	return s.repo.Search(ctx, q)
}

// Snippet returns bounded plain text; clients must render it as text, never HTML.
func Snippet(value, query string) string {
	value = strings.Join(strings.Fields(value), " ")
	text := []rune(value)
	if len(text) <= MaxSnippetLength {
		return value
	}
	normalized := strings.Join(strings.Fields(query), " ")
	position := strings.Index(strings.ToLower(value), strings.ToLower(normalized))
	start := 0
	if position >= 0 {
		start = max(0, utf8.RuneCountInString(strings.ToLower(value)[:position])-SnippetContext)
	}
	prefix := ""
	if start > 0 {
		prefix = "…"
	}
	end := min(len(text), start+MaxSnippetLength-utf8.RuneCountInString(prefix))
	suffix := ""
	if end < len(text) {
		end--
		suffix = "…"
	}
	return prefix + string(text[start:end]) + suffix
}
