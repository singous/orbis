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

const DefaultGroupName = "默认分组"
const MaxGroupNameLength = 160
const MaxCollectionTitleLength = 160

type Group struct {
	IsArchived               bool
	ID, WorkspaceID, Name    string
	IsDefault                bool
	SortOrder                int
	Version                  int64
	ArchivedAtMS             *int64
	CreatedAtMS, UpdatedAtMS int64
}
type GroupChange struct {
	Scope           DirectoryScope
	GroupID         string
	ExpectedVersion int64
	Name            *string
	SortOrder       *int
	Archived        *bool
	Timestamp       int64
}
type CollectionChange struct {
	IconSet         bool
	Icon            *CollectionIcon
	Scope           DirectoryScope
	ExpectedVersion int64
	Title           *string
	GroupSet        bool
	GroupID         *string
	SortOrder       *int
	Timestamp       int64
}
type CollectionInput struct {
	Icon      *CollectionIcon
	Scope     DirectoryScope
	Title     string
	GroupID   *string
	SortOrder int
}
type CatalogRepository interface {
	Groups(context.Context, DirectoryScope, pagination.Page, bool) ([]Group, int64, error)
	Group(context.Context, DirectoryScope, string) (Group, error)
	CreateGroup(context.Context, GroupChange) (Group, error)
	UpdateGroup(context.Context, GroupChange) (Group, error)
	UpdateCollection(context.Context, CollectionChange) (Collection, error)
}
type Catalog struct {
	repo   CatalogRepository
	access Access
	clock  clock.Clock
}

func NewCatalog(repo CatalogRepository, access Access, clock clock.Clock) *Catalog {
	return &Catalog{repo: repo, access: access, clock: clock}
}
func (s *Catalog) Groups(ctx context.Context, scope DirectoryScope, page pagination.Page, archived bool) ([]Group, int64, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Read); err != nil {
		return nil, 0, err
	}
	return s.repo.Groups(ctx, scope, page, archived)
}
func (s *Catalog) Group(ctx context.Context, scope DirectoryScope, id string) (Group, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Read); err != nil {
		return Group{}, err
	}
	return s.repo.Group(ctx, scope, id)
}
func validSortOrder(value int) error {
	if value < 0 || value > MaxPosition {
		return fault.Field("body.sort_order", "排序值超出范围")
	}
	return nil
}
func validateGroup(change *GroupChange) error {
	if change.Name != nil {
		name := strings.TrimSpace(*change.Name)
		if n := utf8.RuneCountInString(name); n < 1 || n > MaxGroupNameLength || strings.ContainsRune(name, 0) {
			return fault.Field("body.name", "分组名称须为 1 至 160 个字符且不能包含空字符")
		}
		change.Name = &name
	}
	if change.SortOrder != nil {
		return validSortOrder(*change.SortOrder)
	}
	return nil
}
func validExpectedVersion(version int64) error {
	if version < 1 || version > MaxVersion {
		return fault.Field("body.expected_version", "版本号超出范围")
	}
	return nil
}
func (s *Catalog) CreateGroup(ctx context.Context, change GroupChange) (Group, error) {
	if err := s.access.Require(ctx, change.Scope.ActorID, change.Scope.WorkspaceID, workspace.Edit); err != nil {
		return Group{}, err
	}
	if change.Name == nil {
		return Group{}, fault.Field("body.name", "分组名称为必填项")
	}
	if err := validateGroup(&change); err != nil {
		return Group{}, err
	}
	change.Timestamp = s.clock.Now().UnixMilli()
	return s.repo.CreateGroup(ctx, change)
}
func (s *Catalog) UpdateGroup(ctx context.Context, change GroupChange) (Group, error) {
	if err := s.access.Require(ctx, change.Scope.ActorID, change.Scope.WorkspaceID, workspace.Edit); err != nil {
		return Group{}, err
	}
	if err := validExpectedVersion(change.ExpectedVersion); err != nil {
		return Group{}, err
	}
	if change.Name == nil && change.SortOrder == nil && change.Archived == nil {
		return Group{}, fault.Field("body", "至少提供一个分组字段")
	}
	if err := validateGroup(&change); err != nil {
		return Group{}, err
	}
	change.Timestamp = s.clock.Now().UnixMilli()
	return s.repo.UpdateGroup(ctx, change)
}
func (s *Catalog) UpdateCollection(ctx context.Context, change CollectionChange) (Collection, error) {
	if err := s.access.Require(ctx, change.Scope.ActorID, change.Scope.WorkspaceID, workspace.Edit); err != nil {
		return Collection{}, err
	}
	if err := validExpectedVersion(change.ExpectedVersion); err != nil {
		return Collection{}, err
	}
	if change.Title == nil && !change.GroupSet && change.SortOrder == nil && !change.IconSet {
		return Collection{}, fault.Field("body", "至少提供一个文集字段")
	}
	if change.Title != nil {
		value, err := title(*change.Title, MaxCollectionTitleLength)
		if err != nil {
			return Collection{}, err
		}
		change.Title = &value
	}
	if err := validGroupID(change.GroupID); err != nil {
		return Collection{}, err
	}
	if change.SortOrder != nil {
		if err := validSortOrder(*change.SortOrder); err != nil {
			return Collection{}, err
		}
	}
	if err := ValidateCollectionIcon(change.Icon); err != nil {
		return Collection{}, err
	}
	change.Timestamp = s.clock.Now().UnixMilli()
	return s.repo.UpdateCollection(ctx, change)
}

func validGroupID(value *string) error {
	if value == nil {
		return nil
	}
	id, err := uuid.Parse(*value)
	if err != nil || id == uuid.Nil || id.String() != *value {
		return fault.Field("body.group_id", "分组 ID 必须是标准 UUID")
	}
	return nil
}
