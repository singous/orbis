// Package quicknote owns personal capture, organization and recovery within a workspace.
package quicknote

import (
	"context"
	"encoding/json"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/internal/workspace"
)

const MaxContentBytes = 256 << 10
const MaxBlocks = 500
const MaxTagsPerNote = 20
const MaxTags = 100
const MaxTagName = 40
const MaxSearchLength = 200

type Scope struct{ ActorID, WorkspaceID string }
type Note struct {
	ID          string
	WorkspaceID string
	OwnerID     string
	Version     int64
	Blocks      []document.Block
	TagIDs      []string
	IsPinned    bool
	CreatedAtMS int64
	UpdatedAtMS int64
	DeletedAtMS *int64
}
type Tag struct {
	ID, Name                                 string
	Version, Count, CreatedAtMS, UpdatedAtMS int64
}
type Summary struct{ Total, Untagged, Deleted int64 }
type Query struct {
	Scope               Scope
	Page                pagination.Page
	Search, TagID, Sort string
	Untagged, Deleted   bool
}
type Change struct {
	OperationID     string            `json:"operation_id"`
	ExpectedVersion int64             `json:"expected_version"`
	Blocks          *[]document.Block `json:"blocks,omitempty"`
	TagIDs          *[]string         `json:"tag_ids,omitempty"`
	IsPinned        *bool             `json:"is_pinned,omitempty"`
	IsDeleted       *bool             `json:"is_deleted,omitempty"`
}
type Commit struct {
	Scope     Scope
	ID, Hash  string
	Change    Change
	Timestamp int64
}
type TagChange struct {
	Name, OperationID string
	ExpectedVersion   int64
	Delete            bool
}
type TagCommit struct {
	Scope     Scope
	ID, Hash  string
	Change    TagChange
	Timestamp int64
}
type Repository interface {
	List(context.Context, Query) ([]Note, int64, error)
	Get(context.Context, Scope, string) (Note, error)
	Summary(context.Context, Scope) (Summary, error)
	Tags(context.Context, Scope, pagination.Page) ([]Tag, int64, error)
	Save(context.Context, Commit) (Note, error)
	SaveTag(context.Context, TagCommit) (Tag, error)
}
type Access interface {
	Require(context.Context, string, string, workspace.Permission) error
}
type Service struct {
	repo   Repository
	access Access
	clock  clock.Clock
}

func New(repo Repository, access Access, wallClock clock.Clock) *Service {
	return &Service{repo: repo, access: access, clock: wallClock}
}
func (s *Service) require(ctx context.Context, scope Scope, permission workspace.Permission) error {
	return s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, permission)
}
func (s *Service) List(ctx context.Context, q Query) ([]Note, int64, error) {
	if err := s.require(ctx, q.Scope, workspace.Read); err != nil {
		return nil, 0, err
	}
	q.Search = strings.TrimSpace(q.Search)
	if utf8.RuneCountInString(q.Search) > MaxSearchLength || strings.ContainsRune(q.Search, 0) {
		return nil, 0, fault.Field("query.q", "搜索内容最多 200 个字符")
	}
	if q.Sort == "" {
		q.Sort = "updated"
	}
	if q.Sort != "updated" && q.Sort != "created" {
		return nil, 0, fault.Field("query.sort", "排序方式无效")
	}
	if q.TagID != "" && (!validID(q.TagID) || q.Untagged) {
		return nil, 0, fault.Field("query.tag_id", "标签筛选无效")
	}
	return s.repo.List(ctx, q)
}
func (s *Service) Get(ctx context.Context, scope Scope, id string) (Note, error) {
	if err := s.require(ctx, scope, workspace.Read); err != nil {
		return Note{}, err
	}
	return s.repo.Get(ctx, scope, id)
}
func (s *Service) Summary(ctx context.Context, scope Scope) (Summary, error) {
	if err := s.require(ctx, scope, workspace.Read); err != nil {
		return Summary{}, err
	}
	return s.repo.Summary(ctx, scope)
}
func (s *Service) Tags(ctx context.Context, scope Scope, page pagination.Page) ([]Tag, int64, error) {
	if err := s.require(ctx, scope, workspace.Read); err != nil {
		return nil, 0, err
	}
	return s.repo.Tags(ctx, scope, page)
}
func validID(value string) bool {
	id, err := uuid.Parse(value)
	return err == nil && id != uuid.Nil && id.String() == value
}
func (s *Service) Save(ctx context.Context, scope Scope, id string, input Change) (Note, error) {
	if err := s.require(ctx, scope, workspace.Edit); err != nil {
		return Note{}, err
	}
	if !validID(input.OperationID) {
		return Note{}, fault.Field("body.operation_id", "操作标识必须是标准 UUID")
	}
	if (id == "" && input.ExpectedVersion != 0) || (id != "" && (input.ExpectedVersion < 1 || input.ExpectedVersion >= document.MaxVersion)) {
		return Note{}, fault.Field("body.expected_version", "版本号无效")
	}
	if id == "" && (input.Blocks == nil || input.TagIDs == nil) {
		return Note{}, fault.Field("body.blocks", "正文和标签不能为空")
	}
	if input.Blocks == nil && input.TagIDs == nil && input.IsPinned == nil && input.IsDeleted == nil {
		return Note{}, fault.Field("body", "请提供要修改的内容")
	}
	if input.Blocks != nil {
		normalized, err := Normalize(*input.Blocks)
		if err != nil {
			return Note{}, err
		}
		input.Blocks = &normalized
	}
	if input.TagIDs != nil {
		if len(*input.TagIDs) > MaxTagsPerNote {
			return Note{}, fault.Field("body.tag_ids", "每条随手记最多 20 个标签")
		}
		seen := map[string]bool{}
		for _, tag := range *input.TagIDs {
			if !validID(tag) || seen[tag] {
				return Note{}, fault.Field("body.tag_ids", "标签标识无效或重复")
			}
			seen[tag] = true
		}
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return Note{}, err
	}
	return s.repo.Save(ctx, Commit{Scope: scope, ID: id, Change: input, Hash: security.Digest("quicknote:" + id + ":" + string(encoded)), Timestamp: s.clock.Now().UnixMilli()})
}
func (s *Service) SaveTag(ctx context.Context, scope Scope, id string, input TagChange) (Tag, error) {
	if err := s.require(ctx, scope, workspace.Edit); err != nil {
		return Tag{}, err
	}
	if !validID(input.OperationID) {
		return Tag{}, fault.Field("body.operation_id", "操作标识必须是标准 UUID")
	}
	if (id == "" && input.ExpectedVersion != 0) || (id != "" && (input.ExpectedVersion < 1 || input.ExpectedVersion >= document.MaxVersion)) {
		return Tag{}, fault.Field("body.expected_version", "版本号无效")
	}
	input.Name = strings.TrimSpace(input.Name)
	if !input.Delete && (input.Name == "" || utf8.RuneCountInString(input.Name) > MaxTagName || strings.ContainsFunc(input.Name, unicode.IsControl)) {
		return Tag{}, fault.Field("body.name", "标签名称须为 1 至 40 个字符")
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return Tag{}, err
	}
	return s.repo.SaveTag(ctx, TagCommit{Scope: scope, ID: id, Change: input, Hash: security.Digest("quicknote.tag:" + id + ":" + string(encoded)), Timestamp: s.clock.Now().UnixMilli()})
}

// Normalize limits capture content while sharing the document wire contract.
func Normalize(blocks []document.Block) ([]document.Block, error) {
	encoded, err := json.Marshal(blocks)
	if err != nil {
		return nil, fault.Field("body.blocks", "正文格式无效")
	}
	if len(encoded) > MaxContentBytes {
		return nil, fault.New(fault.TooLarge, "QUICK_NOTE_TOO_LARGE", "随手记正文超过 256 KiB 限制")
	}
	normalized, err := document.Normalize(blocks)
	if err != nil {
		return nil, err
	}
	count := 0
	hasContent := false
	var visit func([]document.Block) error
	visit = func(items []document.Block) error {
		for _, b := range items {
			count++
			if count > MaxBlocks {
				return fault.Field("body.blocks", "随手记最多 500 个内容块")
			}
			switch b.Type {
			case "paragraph", "heading", "quote", "bullet_list_item", "numbered_list_item", "check_list_item", "code_block", "divider", "image", "audio", "video", "file":
			default:
				return fault.Field("body.blocks", "随手记支持文字、列表、待办、代码和媒体附件")
			}
			for _, run := range b.Content {
				hasContent = hasContent || strings.TrimSpace(run.Text) != ""
			}
			if b.Props["source"] != nil {
				hasContent = true
			}
			if err := visit(b.Children); err != nil {
				return err
			}
		}
		return nil
	}
	if err := visit(normalized); err != nil {
		return nil, err
	}
	if !hasContent {
		return nil, fault.Field("body.blocks", "请写点内容或添加附件")
	}
	return normalized, nil
}
func SearchText(blocks []document.Block) string {
	var text strings.Builder
	var visit func([]document.Block)
	visit = func(items []document.Block) {
		for _, b := range items {
			for _, r := range b.Content {
				text.WriteString(r.Text)
			}
			for _, key := range []string{"name", "caption", "alt"} {
				if v, ok := b.Props[key].(string); ok {
					text.WriteString(" " + v)
				}
			}
			text.WriteByte('\n')
			visit(b.Children)
		}
	}
	visit(blocks)
	return text.String()
}
