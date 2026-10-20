package document

import (
	"context"

	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/workspace"
)

type ReadQuery struct {
	Scope                 DirectoryScope
	Version, SinceVersion int64
	ParentID              *string
	AfterID               string
	AfterPosition         int
	AfterPath             []int
	BlockID               string
	Limit                 int
}
type Heading struct {
	RootPosition  int     `json:"root_position"`
	ID            string  `json:"id"`
	ParentID      *string `json:"parent_id"`
	Level         int     `json:"level"`
	Text          string  `json:"text"`
	BlockRevision int64   `json:"block_revision"`
	Path          []int   `json:"-"`
}
type BlockChange struct {
	ParentID         *string `json:"parent_id"`
	PreviousParentID *string `json:"previous_parent_id"`
	Position         *int    `json:"position"`
	PreviousPosition *int    `json:"previous_position"`
	ID               string  `json:"id"`
	Change           string  `json:"change"`
	BlockRevision    *int64  `json:"block_revision"`
}
type WindowPage struct {
	Items      []BlockRecord
	Version    int64
	NextCursor *string
	HasMore    bool
}
type HeadingPage struct {
	Items      []Heading
	Version    int64
	NextCursor *string
	HasMore    bool
}
type ChangePage struct {
	Items                 []BlockChange
	Version, SinceVersion int64
	NextCursor            *string
	HasMore               bool
}
type readCursor struct {
	Kind, WorkspaceID, DocumentID string
	Version, SinceVersion         int64
	ParentID                      *string
	AfterID                       string
	AfterPosition                 int
	AfterPath                     []int
}

func (s *Service) readQuery(ctx context.Context, kind string, q ReadQuery, cursor string) (ReadQuery, error) {
	if err := s.access.Require(ctx, q.Scope.ActorID, q.Scope.WorkspaceID, workspace.Read); err != nil {
		return q, err
	}
	if q.Limit < 1 || q.Limit > pagination.MaxSize {
		return q, fault.Field("query.page_size", "每页数量必须在 1 至 100 之间")
	}
	if err := validParentID(q.ParentID); err != nil {
		return q, fault.Field("query.parent_id", "父块 ID 不正确")
	}
	if cursor != "" {
		var value readCursor
		if err := s.cursors.Decode(cursor, &value); err != nil || value.Kind != kind || value.WorkspaceID != q.Scope.WorkspaceID || value.DocumentID != q.Scope.DocumentID || (q.Version != 0 && q.Version != value.Version) || !sameParent(value.ParentID, q.ParentID) || value.SinceVersion != q.SinceVersion {
			return q, fault.Field("query.cursor", "游标无效或与读取范围不匹配")
		}
		q.Version = value.Version
		q.AfterID = value.AfterID
		q.AfterPosition = value.AfterPosition
		q.AfterPath = value.AfterPath
	}
	if q.Version < 0 || q.Version > MaxVersion {
		return q, fault.Field("query.version", "文档版本号不正确")
	}
	return q, nil
}
func (s *Service) nextRead(kind string, q ReadQuery, version int64, id string, position int, path []int) (*string, error) {
	value, err := s.cursors.Encode(readCursor{Kind: kind, WorkspaceID: q.Scope.WorkspaceID, DocumentID: q.Scope.DocumentID, Version: version, SinceVersion: q.SinceVersion, ParentID: q.ParentID, AfterID: id, AfterPosition: position, AfterPath: path})
	if err != nil {
		return nil, err
	}
	return &value, nil
}
func (s *Service) ChildrenBlocks(ctx context.Context, q ReadQuery, cursor string) (WindowPage, error) {
	q, err := s.readQuery(ctx, "children", q, cursor)
	if err != nil {
		return WindowPage{}, err
	}
	size := q.Limit
	q.Limit++
	items, version, err := s.repo.ChildrenBlocks(ctx, q)
	if err != nil {
		return WindowPage{}, err
	}
	result := WindowPage{Items: items, Version: version, HasMore: len(items) > size}
	if result.HasMore {
		result.Items = items[:size]
		last := result.Items[len(result.Items)-1]
		result.NextCursor, err = s.nextRead("children", q, version, last.ID, last.Position, nil)
	}
	return result, err
}
func (s *Service) ReadBlock(ctx context.Context, q ReadQuery) (BlockRecord, int64, error) {
	if err := s.access.Require(ctx, q.Scope.ActorID, q.Scope.WorkspaceID, workspace.Read); err != nil {
		return BlockRecord{}, 0, err
	}
	if !validBlockID(q.BlockID) || q.Version < 0 || q.Version > MaxVersion {
		return BlockRecord{}, 0, fault.Field("path.block_id", "块 ID 或版本不正确")
	}
	return s.repo.ReadBlock(ctx, q)
}
func (s *Service) Outline(ctx context.Context, q ReadQuery, cursor string) (HeadingPage, error) {
	q, err := s.readQuery(ctx, "outline", q, cursor)
	if err != nil {
		return HeadingPage{}, err
	}
	size := q.Limit
	q.Limit++
	items, version, err := s.repo.Outline(ctx, q)
	if err != nil {
		return HeadingPage{}, err
	}
	result := HeadingPage{Items: items, Version: version, HasMore: len(items) > size}
	if result.HasMore {
		result.Items = items[:size]
		last := result.Items[len(result.Items)-1]
		result.NextCursor, err = s.nextRead("outline", q, version, last.ID, 0, last.Path)
	}
	return result, err
}
func (s *Service) Changes(ctx context.Context, q ReadQuery, cursor string) (ChangePage, error) {
	if q.SinceVersion < 1 || q.SinceVersion > MaxVersion {
		return ChangePage{}, fault.Field("query.since_version", "来源版本号不正确")
	}
	q, err := s.readQuery(ctx, "changes", q, cursor)
	if err != nil {
		return ChangePage{}, err
	}
	size := q.Limit
	q.Limit++
	items, version, err := s.repo.Changes(ctx, q)
	if err != nil {
		return ChangePage{}, err
	}
	result := ChangePage{Items: items, Version: version, SinceVersion: q.SinceVersion, HasMore: len(items) > size}
	if result.HasMore {
		result.Items = items[:size]
		last := result.Items[len(result.Items)-1]
		result.NextCursor, err = s.nextRead("changes", q, version, last.ID, 0, nil)
	}
	return result, err
}
