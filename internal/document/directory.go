package document

import (
	"context"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/workspace"
)

const MaxDirectoryDepth = 64
const MaxReorderItems = 10000
const MaxPosition = 1<<31 - 1

type DirectoryScope struct {
	ActorID      string
	WorkspaceID  string
	CollectionID string
	DocumentID   string
}

type CreateInput struct {
	Scope    DirectoryScope
	Title    string
	ParentID *string
}

type CollectionQuery struct {
	GroupID  *string
	Scope    DirectoryScope
	Page     pagination.Page
	Archived bool
}

type ChildrenQuery struct {
	Scope    DirectoryScope
	ParentID *string
	Page     pagination.Page
}

type DirectoryPage struct {
	Items            []Document
	Total            int64
	DirectoryVersion int64
}

type DirectoryMutation struct {
	Document         Document
	DirectoryVersion int64
}

type LocationChange struct {
	Scope                    DirectoryScope
	ExpectedDirectoryVersion int64
	ParentSet                bool
	ParentID                 *string
	Position                 *int
	Timestamp                int64
}

type ReorderChange struct {
	Scope                    DirectoryScope
	ParentID                 *string
	DocumentIDs              []string
	ExpectedDirectoryVersion int64
	Timestamp                int64
}

type ArchiveChange struct {
	Scope                    DirectoryScope
	Archived                 bool
	ExpectedDirectoryVersion int64
	Timestamp                int64
}

func validParentID(parent *string) error {
	if parent == nil {
		return nil
	}
	id, err := uuid.Parse(*parent)
	if err != nil || id == uuid.Nil || id.String() != *parent {
		return fault.Field("body.parent_id", "父文档 ID 必须是标准 UUID 或 null")
	}
	return nil
}

func validDirectoryVersion(version int64) error {
	if version < 1 || version >= MaxVersion {
		return fault.Field("body.expected_directory_version", "目录版本号不正确")
	}
	return nil
}

// Collection exposes its structural version, including for an archived collection.
func (s *Service) Collection(ctx context.Context, scope DirectoryScope) (Collection, error) {
	if err := s.access.Require(
		ctx,
		scope.ActorID,
		scope.WorkspaceID,
		workspace.Read,
	); err != nil {
		return Collection{}, err
	}
	return s.repo.Collection(ctx, scope)
}

// Children returns a bounded sibling page and the directory version from the same snapshot.
func (s *Service) Children(ctx context.Context, query ChildrenQuery) (DirectoryPage, error) {
	if err := s.access.Require(
		ctx,
		query.Scope.ActorID,
		query.Scope.WorkspaceID,
		workspace.Read,
	); err != nil {
		return DirectoryPage{}, err
	}
	if err := validParentID(query.ParentID); err != nil {
		return DirectoryPage{}, err
	}
	return s.repo.Children(ctx, query)
}

// Archived lists explicit archives without changing descendant archive states.
func (s *Service) Archived(
	ctx context.Context,
	scope DirectoryScope,
	page pagination.Page,
) ([]Document, int64, error) {
	if err := s.access.Require(
		ctx,
		scope.ActorID,
		scope.WorkspaceID,
		workspace.Read,
	); err != nil {
		return nil, 0, err
	}
	rows, total, err := s.repo.Browse(ctx, scope, page, true)
	if err != nil {
		return nil, 0, err
	}
	items := make([]Document, 0, len(rows))
	for _, row := range rows {
		items = append(items, row.Document)
	}
	return items, total, nil
}

// Move preserves omitted parent fields and treats an explicit nil parent as the collection root.
func (s *Service) Move(ctx context.Context, change LocationChange) (DirectoryMutation, error) {
	if err := s.access.Require(
		ctx,
		change.Scope.ActorID,
		change.Scope.WorkspaceID,
		workspace.Edit,
	); err != nil {
		return DirectoryMutation{}, err
	}
	if err := validDirectoryVersion(change.ExpectedDirectoryVersion); err != nil {
		return DirectoryMutation{}, err
	}
	if !change.ParentSet && change.Position == nil {
		return DirectoryMutation{}, fault.Field("body", "需要提供 parent_id 或 position")
	}
	if err := validParentID(change.ParentID); err != nil {
		return DirectoryMutation{}, err
	}
	if change.Position != nil && (*change.Position < 0 || *change.Position > MaxPosition) {
		return DirectoryMutation{}, fault.Field("body.position", "目录位置超出范围")
	}
	change.Timestamp = s.clock.Now().UnixMilli()
	return s.repo.Move(ctx, change)
}

// Reorder requires a complete, unique sibling set and a fresh structural version.
func (s *Service) Reorder(ctx context.Context, change ReorderChange) (Collection, error) {
	if err := s.access.Require(
		ctx,
		change.Scope.ActorID,
		change.Scope.WorkspaceID,
		workspace.Edit,
	); err != nil {
		return Collection{}, err
	}
	if err := validDirectoryVersion(change.ExpectedDirectoryVersion); err != nil {
		return Collection{}, err
	}
	if err := validParentID(change.ParentID); err != nil {
		return Collection{}, err
	}
	if len(change.DocumentIDs) > MaxReorderItems {
		return Collection{}, fault.Field("body.document_ids", "目录重排数量超出限制")
	}
	seen := map[string]bool{}
	for _, id := range change.DocumentIDs {
		if err := validParentID(&id); err != nil {
			return Collection{}, fault.Field("body.document_ids", "文档 ID 格式不正确")
		}
		if seen[id] {
			return Collection{}, fault.New(fault.Conflict, "DIRECTORY_ORDER_CONFLICT", "文档列表不能重复")
		}
		seen[id] = true
	}
	change.Timestamp = s.clock.Now().UnixMilli()
	return s.repo.Reorder(ctx, change)
}

// Archive changes only the requested document's archive marker.
func (s *Service) Archive(ctx context.Context, change ArchiveChange) (DirectoryMutation, error) {
	if err := s.access.Require(
		ctx,
		change.Scope.ActorID,
		change.Scope.WorkspaceID,
		workspace.Edit,
	); err != nil {
		return DirectoryMutation{}, err
	}
	if err := validDirectoryVersion(change.ExpectedDirectoryVersion); err != nil {
		return DirectoryMutation{}, err
	}
	change.Timestamp = s.clock.Now().UnixMilli()
	return s.repo.Archive(ctx, change)
}

// ArchiveCollection hides or restores the collection without rewriting individual document archives.
func (s *Service) ArchiveCollection(ctx context.Context, change ArchiveChange) (Collection, error) {
	if err := s.access.Require(
		ctx,
		change.Scope.ActorID,
		change.Scope.WorkspaceID,
		workspace.Edit,
	); err != nil {
		return Collection{}, err
	}
	if err := validDirectoryVersion(change.ExpectedDirectoryVersion); err != nil {
		return Collection{}, err
	}
	change.Timestamp = s.clock.Now().UnixMilli()
	return s.repo.ArchiveCollection(ctx, change)
}
