package document

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/internal/workspace"
)

const (
	VersionNameLimit         = 120
	VersionDescriptionLimit  = 2000
	VersionIdleInterval      = time.Minute
	VersionMaximumInterval   = 5 * time.Minute
	VersionContentSchema     = "orbis.document-version.v1"
	VersionKindAutomatic     = "automatic"
	VersionKindNamed         = "named"
	VersionKindBeforeRestore = "before_restore"
	VersionKindRestored      = "restored"
)

// Version identifies a fixed content boundary. Metadata edits never move that boundary.
type Version struct {
	ID              string              `json:"id"`
	DocumentID      string              `json:"document_id"`
	SourceRevision  int64               `json:"source_revision"`
	Kind            string              `json:"kind"`
	Name            *string             `json:"name"`
	Description     string              `json:"description"`
	Title           string              `json:"title"`
	TitleRecorded   bool                `json:"title_recorded"`
	ContentHash     string              `json:"content_hash"`
	ContentSchema   string              `json:"content_schema"`
	Dependencies    []VersionDependency `json:"-"`
	AuthorID        *string             `json:"author_id"`
	AuthorName      string              `json:"author_name"`
	MetadataVersion int64               `json:"metadata_version"`
	Sequence        int64               `json:"-"`
	CapturedAtMS    int64               `json:"captured_at_ms"`
	CreatedAtMS     int64               `json:"created_at_ms"`
	UpdatedAtMS     int64               `json:"updated_at_ms"`
}

// Shared sheets and external URLs explicitly retain link semantics.
type VersionDependency struct {
	Kind     string `json:"kind"`
	ID       string `json:"id"`
	Revision *int64 `json:"revision"`
}

type CreateVersion struct {
	OperationID    string `json:"operation_id"`
	SourceRevision int64  `json:"source_revision"`
	Name           string `json:"name"`
	Description    string `json:"description"`
}

type EditVersion struct {
	OperationID             string  `json:"operation_id"`
	ExpectedMetadataVersion int64   `json:"expected_metadata_version"`
	Name                    *string `json:"name"`
	Description             string  `json:"description"`
}

type VersionQuery struct {
	Scope                         DirectoryScope
	BeforeSequence, UpperSequence int64
	Limit                         int
}

type VersionPage struct {
	Items      []Version  `json:"items"`
	Pagination CursorPage `json:"pagination"`
}

type CursorPage struct {
	NextCursor *string `json:"next_cursor"`
	HasMore    bool    `json:"has_more"`
}

type VersionDifference struct {
	BlockID         string  `json:"block_id"`
	Change          string  `json:"change"`
	ContentChanged  bool    `json:"content_changed"`
	PositionChanged bool    `json:"position_changed"`
	BeforeText      *string `json:"before_text"`
	AfterText       *string `json:"after_text"`
}

type VersionComparison struct {
	From       Version             `json:"from"`
	To         Version             `json:"to"`
	Items      []VersionDifference `json:"items"`
	Pagination CursorPage          `json:"pagination"`
}

type VersionRepository interface {
	ListVersions(context.Context, VersionQuery) ([]Version, int64, error)
	GetVersion(context.Context, DirectoryScope, string) (Version, error)
	ReadVersionContent(context.Context, DirectoryScope, string) (Version, Content, error)
	CreateVersion(context.Context, DirectoryScope, CreateVersion, string, int64) (Version, error)
	EditVersion(context.Context, DirectoryScope, string, EditVersion, string, int64) (Version, error)
	CompareVersions(context.Context, DirectoryScope, string, string, string, int) (VersionComparison, error)
}

type Versions struct {
	repo      VersionRepository
	documents *Service
	access    Access
	clock     clock.Clock
	cursors   *security.CursorSigner
}

func NewVersions(repo VersionRepository, documents *Service, access Access, c clock.Clock, cursors *security.CursorSigner) *Versions {
	return &Versions{repo: repo, documents: documents, access: access, clock: c, cursors: cursors}
}

type versionCursor struct {
	Kind, WorkspaceID, DocumentID, FromID, ToID, AfterID string
	BeforeSequence, UpperSequence                        int64
}

func (s *Versions) List(ctx context.Context, q VersionQuery, cursor string) (VersionPage, error) {
	if err := s.access.Require(ctx, q.Scope.ActorID, q.Scope.WorkspaceID, workspace.Read); err != nil {
		return VersionPage{}, err
	}
	if q.Limit < 1 || q.Limit > pagination.MaxSize {
		return VersionPage{}, fault.Field("query.page_size", "每页数量必须在 1 至 100 之间")
	}
	if cursor != "" {
		var value versionCursor
		if err := s.cursors.Decode(cursor, &value); err != nil || value.Kind != "versions" || value.WorkspaceID != q.Scope.WorkspaceID || value.DocumentID != q.Scope.DocumentID {
			return VersionPage{}, fault.Field("query.cursor", "游标无效或与文档不匹配")
		}
		q.BeforeSequence, q.UpperSequence = value.BeforeSequence, value.UpperSequence
	}
	size := q.Limit
	q.Limit++
	items, upper, err := s.repo.ListVersions(ctx, q)
	if err != nil {
		return VersionPage{}, err
	}
	result := VersionPage{Items: items, Pagination: CursorPage{HasMore: len(items) > size}}
	if result.Pagination.HasMore {
		result.Items = items[:size]
		value, err := s.cursors.Encode(versionCursor{Kind: "versions", WorkspaceID: q.Scope.WorkspaceID, DocumentID: q.Scope.DocumentID, UpperSequence: upper, BeforeSequence: items[size-1].Sequence})
		if err != nil {
			return VersionPage{}, err
		}
		result.Pagination.NextCursor = &value
	}
	return result, nil
}

func (s *Versions) Get(ctx context.Context, scope DirectoryScope, id string) (Version, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Read); err != nil {
		return Version{}, err
	}
	if !validBlockID(id) {
		return Version{}, fault.Field("path.version_id", "版本标识无效")
	}
	return s.repo.GetVersion(ctx, scope, id)
}

func validVersionMetadata(name *string, description string) error {
	if name != nil && (utf8.RuneCountInString(*name) < 1 || utf8.RuneCountInString(*name) > VersionNameLimit || strings.ContainsRune(*name, 0)) {
		return fault.Field("body.name", "版本名称须为 1 至 120 个字符")
	}
	if utf8.RuneCountInString(description) > VersionDescriptionLimit || strings.ContainsRune(description, 0) {
		return fault.Field("body.description", "版本说明不能超过 2000 个字符")
	}
	return nil
}

func (s *Versions) Create(ctx context.Context, scope DirectoryScope, input CreateVersion) (Version, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Edit); err != nil {
		return Version{}, err
	}
	if !validBlockID(input.OperationID) {
		return Version{}, fault.Field("body.operation_id", "操作标识无效")
	}
	if input.SourceRevision < 1 || input.SourceRevision > MaxVersion {
		return Version{}, fault.Field("body.source_revision", "需要指定已保存的内容")
	}
	input.Name = strings.TrimSpace(input.Name)
	input.Description = strings.TrimSpace(input.Description)
	if err := validVersionMetadata(&input.Name, input.Description); err != nil {
		return Version{}, err
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return Version{}, err
	}
	return s.repo.CreateVersion(ctx, scope, input, security.Digest("document.version.create:"+string(raw)), s.clock.Now().UnixMilli())
}

func (s *Versions) Edit(ctx context.Context, scope DirectoryScope, id string, input EditVersion) (Version, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Edit); err != nil {
		return Version{}, err
	}
	if !validBlockID(id) || !validBlockID(input.OperationID) {
		return Version{}, fault.Field("body.operation_id", "版本或操作标识无效")
	}
	if input.ExpectedMetadataVersion < 1 || input.ExpectedMetadataVersion >= MaxVersion {
		return Version{}, fault.Field("body.expected_metadata_version", "版本信息已变化，请重新载入")
	}
	if input.Name != nil {
		value := strings.TrimSpace(*input.Name)
		input.Name = &value
	}
	input.Description = strings.TrimSpace(input.Description)
	if err := validVersionMetadata(input.Name, input.Description); err != nil {
		return Version{}, err
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return Version{}, err
	}
	return s.repo.EditVersion(ctx, scope, id, input, security.Digest("document.version.edit:"+id+":"+string(raw)), s.clock.Now().UnixMilli())
}

func (s *Versions) Content(ctx context.Context, scope DirectoryScope, id string) (Version, Content, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Read); err != nil {
		return Version{}, Content{}, err
	}
	if !validBlockID(id) {
		return Version{}, Content{}, fault.Field("path.version_id", "版本标识无效")
	}
	version, content, err := s.repo.ReadVersionContent(ctx, scope, id)
	if err != nil {
		return Version{}, Content{}, err
	}
	digest, err := VersionContentHash(content)
	if err != nil {
		return Version{}, Content{}, err
	}
	if version.ContentSchema != VersionContentSchema || digest != version.ContentHash {
		return Version{}, Content{}, errors.New("document version content integrity verification failed")
	}
	return version, content, nil
}

// VersionContentHash hashes a JSON-lines header and each native root block.
// Streaming roots bounds hashing buffers to one subtree and excludes mutable metadata.
func VersionContentHash(content Content) (string, error) {
	digest := sha256.New()
	encoder := json.NewEncoder(digest)
	err := encoder.Encode(struct {
		Schema        string `json:"schema"`
		Title         string `json:"title"`
		TitleRecorded bool   `json:"title_recorded"`
		RootBlocks    int    `json:"root_blocks"`
	}{VersionContentSchema, content.Revision.Title, content.Revision.TitleRecorded, len(content.Blocks)})
	if err != nil {
		return "", err
	}
	for _, block := range content.Blocks {
		if err := encoder.Encode(block); err != nil {
			return "", err
		}
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

func (s *Versions) Restore(ctx context.Context, scope DirectoryScope, id, operation string, expected int64) (Content, error) {
	version, _, err := s.Content(ctx, scope, id)
	if err != nil {
		return Content{}, err
	}
	return s.documents.restore(ctx, scope.ActorID, scope.WorkspaceID, scope.DocumentID, operation, expected, version.SourceRevision, id)
}

func (s *Versions) Compare(ctx context.Context, scope DirectoryScope, from, to, cursor string, limit int) (VersionComparison, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Read); err != nil {
		return VersionComparison{}, err
	}
	if !validBlockID(from) || !validBlockID(to) {
		return VersionComparison{}, fault.Field("query.from_id", "需要选择两个文档版本")
	}
	if limit < 1 || limit > pagination.MaxSize {
		return VersionComparison{}, fault.Field("query.page_size", "每页数量必须在 1 至 100 之间")
	}
	after := ""
	if cursor != "" {
		var value versionCursor
		if err := s.cursors.Decode(cursor, &value); err != nil || value.Kind != "version-diff" || value.WorkspaceID != scope.WorkspaceID || value.DocumentID != scope.DocumentID || value.FromID != from || value.ToID != to {
			return VersionComparison{}, fault.Field("query.cursor", "游标无效或与比较范围不匹配")
		}
		after = value.AfterID
	}
	result, err := s.repo.CompareVersions(ctx, scope, from, to, after, limit+1)
	if err != nil {
		return result, err
	}
	result.Pagination.HasMore = len(result.Items) > limit
	if result.Pagination.HasMore {
		result.Items = result.Items[:limit]
		value, err := s.cursors.Encode(versionCursor{Kind: "version-diff", WorkspaceID: scope.WorkspaceID, DocumentID: scope.DocumentID, FromID: from, ToID: to, AfterID: result.Items[limit-1].BlockID})
		if err != nil {
			return VersionComparison{}, err
		}
		result.Pagination.NextCursor = &value
	}
	return result, nil
}
