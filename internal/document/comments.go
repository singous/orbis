package document

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/workspace"
)

const MaxCommentLength = 10000

type Comment struct {
	ID, WorkspaceID, DocumentID, AuthorID, AuthorName, Body string
	ParentID                                                *string
	IsResolved                                              bool
	ResolvedAtMS                                            *int64
	Version                                                 int64
	CreatedAtMS, UpdatedAtMS                                int64
}
type CommentInput struct {
	Scope     DirectoryScope
	ParentID  *string
	Body      string
	Timestamp int64
}
type CommentChange struct {
	Scope           DirectoryScope
	CommentID       string
	ExpectedVersion int64
	Body            *string
	IsResolved      *bool
	Timestamp       int64
}
type CommentRepository interface {
	Comments(context.Context, DirectoryScope, pagination.Page) ([]Comment, int64, error)
	CreateComment(context.Context, CommentInput) (Comment, error)
	UpdateComment(context.Context, CommentChange) (Comment, error)
}
type Comments struct {
	repo   CommentRepository
	access Access
	clock  clock.Clock
}

func NewComments(repo CommentRepository, access Access, clock clock.Clock) *Comments {
	return &Comments{repo: repo, access: access, clock: clock}
}
func commentBody(body string) (string, error) {
	body = strings.TrimSpace(body)
	if n := utf8.RuneCountInString(body); n < 1 || n > MaxCommentLength || strings.ContainsRune(body, 0) {
		return "", fault.Field("body.body", "评论须为 1 至 10000 个字符且不能包含空字符")
	}
	return body, nil
}
func (s *Comments) List(ctx context.Context, scope DirectoryScope, page pagination.Page) ([]Comment, int64, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Read); err != nil {
		return nil, 0, err
	}
	return s.repo.Comments(ctx, scope, page)
}
func (s *Comments) Create(ctx context.Context, input CommentInput) (Comment, error) {
	if err := s.access.Require(ctx, input.Scope.ActorID, input.Scope.WorkspaceID, workspace.Read); err != nil {
		return Comment{}, err
	}
	body, err := commentBody(input.Body)
	if err != nil {
		return Comment{}, err
	}
	if input.ParentID != nil {
		id, err := uuid.Parse(*input.ParentID)
		if err != nil || id == uuid.Nil || id.String() != *input.ParentID {
			return Comment{}, fault.Field("body.parent_id", "父评论 ID 必须是标准 UUID")
		}
	}
	input.Body, input.Timestamp = body, s.clock.Now().UnixMilli()
	return s.repo.CreateComment(ctx, input)
}
func (s *Comments) Update(ctx context.Context, change CommentChange) (Comment, error) {
	if err := s.access.Require(ctx, change.Scope.ActorID, change.Scope.WorkspaceID, workspace.Read); err != nil {
		return Comment{}, err
	}
	if err := validExpectedVersion(change.ExpectedVersion); err != nil {
		return Comment{}, err
	}
	if change.Body == nil && change.IsResolved == nil {
		return Comment{}, fault.Field("body", "至少提供一个评论字段")
	}
	if change.Body != nil {
		body, err := commentBody(*change.Body)
		if err != nil {
			return Comment{}, err
		}
		change.Body = &body
	}
	change.Timestamp = s.clock.Now().UnixMilli()
	return s.repo.UpdateComment(ctx, change)
}
