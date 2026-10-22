package document

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/internal/table"
	"orbis.local/orbis/internal/workspace"
)

type Collection struct {
	IsArchived               bool
	Icon                     *CollectionIcon
	ID, WorkspaceID, Title   string
	GroupID                  string
	SortOrder                int
	MetadataVersion          int64
	CreatedAtMS, UpdatedAtMS int64
	DirectoryVersion         int64
	ArchivedAtMS             *int64
}
type Document struct {
	SheetID                              *string
	IsArchived                           bool
	ID, WorkspaceID, CollectionID, Title string
	ContentVersion                       int64
	ArchivedAtMS                         *int64
	CreatedAtMS, UpdatedAtMS             int64
	ParentID                             *string
	Position                             int
}
type Revision struct {
	DocumentID, Title, AuthorName string
	AuthorID                      *string
	TitleRecorded                 bool
	Version                       int64
	RestoredFromVersion           *int64
	CreatedAtMS                   int64
}
type Content struct {
	Revision Revision
	Blocks   []Block
}
type Change struct {
	OperationID     string
	ExpectedVersion int64
	Title           string
	Blocks          []Block
	RestoreVersion  *int64
}

const MaxVersion int64 = 1<<53 - 1

type Commit struct {
	TableReferences                                                   []table.Reference
	AssetReferences                                                   []AssetReference
	ActorID, WorkspaceID, DocumentID, OperationID, RequestHash, Title string
	ExpectedVersion, Timestamp                                        int64
	RestoreVersion                                                    *int64
	Blocks                                                            []BlockRecord
}
type Access interface {
	Require(context.Context, string, string, workspace.Permission) error
}
type Repository interface {
	ChildrenBlocks(context.Context, ReadQuery) ([]BlockRecord, int64, error)
	ReadBlock(context.Context, ReadQuery) (BlockRecord, int64, error)
	Outline(context.Context, ReadQuery) ([]Heading, int64, error)
	Changes(context.Context, ReadQuery) ([]BlockChange, int64, error)
	ApplyCommands(context.Context, Command) (CommandResult, error)
	PreviewCommands(context.Context, Command) (CommandPreview, error)
	CommandReceipt(context.Context, DirectoryScope, string) (CommandResult, error)
	CreateCollection(context.Context, string, Collection) (Collection, error)
	ListCollections(context.Context, CollectionQuery) ([]Collection, int64, error)
	Create(context.Context, string, Document) error
	List(context.Context, string, string, pagination.Page) ([]Document, int64, error)
	Get(context.Context, string, string) (Document, error)
	Read(context.Context, string, string, int64) (Revision, []BlockRecord, error)
	Commit(context.Context, Commit) (int64, error)
	Revisions(context.Context, string, string, pagination.Page) ([]Revision, int64, error)
	BlockPage(context.Context, string, string, int64, string, int) ([]BlockRecord, error)
	Collection(context.Context, DirectoryScope) (Collection, error)
	Children(context.Context, ChildrenQuery) (DirectoryPage, error)
	Browse(context.Context, DirectoryScope, pagination.Page, bool) ([]DocumentOverview, int64, error)
	Move(context.Context, LocationChange) (DirectoryMutation, error)
	Reorder(context.Context, ReorderChange) (Collection, error)
	Archive(context.Context, ArchiveChange) (DirectoryMutation, error)
	ArchiveCollection(context.Context, ArchiveChange) (Collection, error)
}

const CommandConcurrency = 2

type Service struct {
	commands chan struct{}
	repo     Repository
	access   Access
	clock    clock.Clock
	cursors  *security.CursorSigner
}

// New binds document use cases to authorization, storage, time, and cursor signing.
func New(repo Repository, access Access, c clock.Clock, cursors *security.CursorSigner) *Service {
	return &Service{repo: repo, access: access, clock: c, cursors: cursors, commands: make(chan struct{}, CommandConcurrency)}
}
func title(value string, max int) (string, error) {
	value = strings.TrimSpace(value)
	if n := utf8.RuneCountInString(value); n < 1 || n > max || strings.ContainsRune(value, 0) {
		return "", fault.Field("body.title", "标题长度不正确")
	}
	return value, nil
}

// CreateCollection requires workspace edit permission before creating a collection.
func (s *Service) CreateCollection(ctx context.Context, input CollectionInput) (Collection, error) {
	actor, wid, name := input.Scope.ActorID, input.Scope.WorkspaceID, input.Title
	if err := validGroupID(input.GroupID); err != nil {
		return Collection{}, err
	}
	if err := validSortOrder(input.SortOrder); err != nil {
		return Collection{}, err
	}
	if err := s.access.Require(
		ctx,
		actor,
		wid,
		workspace.Edit,
	); err != nil {
		return Collection{}, err
	}
	if err := ValidateCollectionIcon(input.Icon); err != nil {
		return Collection{}, err
	}
	name, err := title(name, MaxCollectionTitleLength)
	if err != nil {
		return Collection{}, err
	}
	now := s.clock.Now().UnixMilli()
	c := Collection{
		ID:               uuid.NewString(),
		WorkspaceID:      wid,
		Title:            name,
		CreatedAtMS:      now,
		UpdatedAtMS:      now,
		DirectoryVersion: 1,
	}
	c.Icon = input.Icon
	c.MetadataVersion, c.SortOrder = 1, input.SortOrder
	if input.GroupID != nil {
		c.GroupID = *input.GroupID
	}
	return s.repo.CreateCollection(ctx, actor, c)
}

// Collections lists active or explicitly archived collections within an authorized workspace.
func (s *Service) Collections(ctx context.Context, query CollectionQuery) ([]Collection, int64, error) {
	if err := s.access.Require(
		ctx,
		query.Scope.ActorID,
		query.Scope.WorkspaceID,
		workspace.Read,
	); err != nil {
		return nil, 0, err
	}
	return s.repo.ListCollections(ctx, query)
}

// Create appends a document below an active parent and commits its initial content revision.
func (s *Service) Create(ctx context.Context, input CreateInput) (Document, error) {
	if err := s.access.Require(
		ctx,
		input.Scope.ActorID,
		input.Scope.WorkspaceID,
		workspace.Edit,
	); err != nil {
		return Document{}, err
	}
	name, err := title(input.Title, 240)
	if err != nil {
		return Document{}, err
	}
	if err := validParentID(input.ParentID); err != nil {
		return Document{}, err
	}
	now := s.clock.Now().UnixMilli()
	d := Document{
		ID: uuid.NewString(), WorkspaceID: input.Scope.WorkspaceID, CollectionID: input.Scope.CollectionID,
		Title: name, ContentVersion: 1, ParentID: input.ParentID, CreatedAtMS: now, UpdatedAtMS: now,
	}
	if err := s.repo.Create(ctx, input.Scope.ActorID, d); err != nil {
		return Document{}, err
	}
	return s.repo.Get(ctx, d.WorkspaceID, d.ID)
}

// List scopes document pagination to an authorized collection.
func (s *Service) List(
	ctx context.Context,
	actor, wid, cid string,
	p pagination.Page,
) ([]Document, int64, error) {
	if err := s.access.Require(
		ctx,
		actor,
		wid,
		workspace.Read,
	); err != nil {
		return nil, 0, err
	}
	return s.repo.List(
		ctx,
		wid,
		cid,
		p,
	)
}

// Get resolves metadata only after checking workspace access.
func (s *Service) Get(ctx context.Context, actor, wid, did string) (Document, error) {
	if err := s.access.Require(
		ctx,
		actor,
		wid,
		workspace.Read,
	); err != nil {
		return Document{}, err
	}
	return s.repo.Get(ctx, wid, did)
}

// Read reconstructs a fixed revision; version zero resolves the current head.
func (s *Service) Read(ctx context.Context, actor, wid, did string, version int64) (Content, error) {
	if err := s.access.Require(
		ctx,
		actor,
		wid,
		workspace.Read,
	); err != nil {
		return Content{}, err
	}
	r, records, err := s.repo.Read(
		ctx,
		wid,
		did,
		version,
	)
	if err != nil {
		return Content{}, err
	}
	blocks, err := Expand(records)
	return Content{Revision: r, Blocks: blocks}, err
}

// Write commits validated content and an idempotent receipt at the expected version.
func (s *Service) Write(ctx context.Context, actor, wid, did string, change Change) (Content, error) {
	if err := s.access.Require(
		ctx,
		actor,
		wid,
		workspace.Edit,
	); err != nil {
		return Content{}, err
	}
	id, err := uuid.Parse(change.OperationID)
	if err != nil || id == uuid.Nil || id.String() != change.OperationID {
		return Content{}, fault.Field("body.operation_id", "操作 ID 必须是标准 UUID")
	}
	if change.ExpectedVersion < 1 || change.ExpectedVersion >= MaxVersion {
		return Content{}, fault.Field("body.expected_version", "版本号不正确")
	}
	change.Title, err = title(change.Title, 240)
	if err != nil {
		return Content{}, err
	}
	change.Blocks, err = Normalize(change.Blocks)
	if err != nil {
		return Content{}, err
	}
	encoded, err := json.Marshal(change)
	if err != nil {
		return Content{}, err
	}
	records, err := Flatten(change.Blocks)
	if err != nil {
		return Content{}, err
	}
	version, err := s.repo.Commit(ctx, Commit{
		ActorID:         actor,
		WorkspaceID:     wid,
		DocumentID:      did,
		OperationID:     change.OperationID,
		RequestHash:     security.Digest(string(encoded)),
		Title:           change.Title,
		ExpectedVersion: change.ExpectedVersion,
		Timestamp:       s.clock.Now().UnixMilli(),
		RestoreVersion:  change.RestoreVersion,
		Blocks:          records,
		AssetReferences: MediaReferences(change.Blocks),
		TableReferences: TableReferences(change.Blocks),
	})
	if err != nil {
		return Content{}, err
	}
	return s.Read(
		ctx,
		actor,
		wid,
		did,
		version,
	)
}

// Restore creates a new revision from immutable history rather than overwriting history.
func (s *Service) Restore(
	ctx context.Context,
	actor, wid, did, operation string,
	expected, source int64,
) (Content, error) {
	if source < 1 || source > MaxVersion {
		return Content{}, fault.Field("body.source_version", "历史版本号不正确")
	}
	if err := s.access.Require(
		ctx,
		actor,
		wid,
		workspace.Edit,
	); err != nil {
		return Content{}, err
	}
	content, err := s.Read(
		ctx,
		actor,
		wid,
		did,
		source,
	)
	if err != nil {
		return Content{}, err
	}
	restoreTitle := content.Revision.Title
	if !content.Revision.TitleRecorded {
		current, err := s.repo.Get(ctx, wid, did)
		if err != nil {
			return Content{}, err
		}
		restoreTitle = current.Title
	}
	return s.Write(
		ctx,
		actor,
		wid,
		did,
		Change{
			OperationID:     operation,
			ExpectedVersion: expected,
			Title:           restoreTitle,
			Blocks:          content.Blocks,
			RestoreVersion:  &source,
		},
	)
}

// Revisions returns bounded history within the authorized workspace.
func (s *Service) Revisions(
	ctx context.Context,
	actor, wid, did string,
	p pagination.Page,
) ([]Revision, int64, error) {
	if err := s.access.Require(
		ctx,
		actor,
		wid,
		workspace.Read,
	); err != nil {
		return nil, 0, err
	}
	return s.repo.Revisions(
		ctx,
		wid,
		did,
		p,
	)
}

type blockCursor struct {
	WorkspaceID string `json:"w"`
	DocumentID  string `json:"d"`
	Version     int64  `json:"v"`
	After       string `json:"a"`
}

// Blocks binds pagination to a document version so concurrent edits cannot shift later pages.
func (s *Service) Blocks(
	ctx context.Context,
	actor, wid, did string,
	version int64,
	cursor string,
	limit int,
) ([]BlockRecord, *string, bool, int64, error) {
	if err := s.access.Require(
		ctx,
		actor,
		wid,
		workspace.Read,
	); err != nil {
		return nil, nil, false, 0, err
	}
	if limit < 1 || limit > pagination.MaxSize {
		return nil, nil, false, 0, fault.Field("query.page_size", "每页数量必须在 1 至 100 之间")
	}
	after := ""
	if cursor != "" {
		var c blockCursor
		if err := s.cursors.Decode(cursor, &c); err != nil || c.WorkspaceID != wid || c.DocumentID != did || (version != 0 && version != c.Version) {
			return nil, nil, false, 0, fault.Field("query.cursor", "游标无效或与查询范围不匹配")
		}
		version = c.Version
		after = c.After
	}
	d, err := s.repo.Get(ctx, wid, did)
	if err != nil {
		return nil, nil, false, 0, err
	}
	if version == 0 {
		version = d.ContentVersion
	}
	if version < 1 || version > d.ContentVersion {
		return nil, nil, false, 0, fault.Missing()
	}
	rows, err := s.repo.BlockPage(
		ctx,
		wid,
		did,
		version,
		after,
		limit+1,
	)
	if err != nil {
		return nil, nil, false, 0, err
	}
	hasMore := len(rows) > limit
	var next *string
	if hasMore {
		rows = rows[:limit]
		token, err := s.cursors.Encode(
			blockCursor{WorkspaceID: wid, DocumentID: did, Version: version, After: rows[len(rows)-1].ID},
		)
		if err != nil {
			return nil, nil, false, 0, err
		}
		next = &token
	}
	return rows, next, hasMore, version, nil
}

// Browse lists currently visible documents across the authorized workspace.
func (s *Service) Browse(ctx context.Context, scope DirectoryScope, page pagination.Page) ([]DocumentOverview, int64, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Read); err != nil {
		return nil, 0, err
	}
	return s.repo.Browse(ctx, scope, page, false)
}

const MaxOverviewSummaryRunes = 240

// DocumentOverview is a bounded current-content projection for library browsing.
type DocumentOverview struct {
	Document Document
	Summary  string
}
