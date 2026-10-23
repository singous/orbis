package board

import (
	"context"
	"encoding/json"
	"strings"

	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/internal/workspace"
)

type Access interface {
	Require(context.Context, string, string, workspace.Permission) error
}
type Service struct {
	repo     Repository
	access   Access
	clock    clock.Clock
	catalog  Catalog
	renderer *Renderer
}

func (s *Service) List(ctx context.Context, sc Scope, collection string, page pagination.Page) ([]Summary, int64, error) {
	if err := s.require(ctx, sc, false); err != nil {
		return nil, 0, err
	}
	if collection != "" && !ValidID(collection) {
		return nil, 0, Invalid("文集标识无效")
	}
	return s.repo.List(ctx, sc, collection, page)
}

func New(repo Repository, access Access, clock clock.Clock, catalog Catalog, renderer *Renderer) *Service {
	return &Service{repo: repo, access: access, clock: clock, catalog: catalog, renderer: renderer}
}
func (s *Service) Preview(ctx context.Context, sc Scope, pageID string, revision int64, frameID *string, assets func(string) (string, error)) (View, error) {
	if err := s.require(ctx, sc, false); err != nil {
		return View{}, err
	}
	if !ValidID(pageID) || revision < 0 || revision > MaxVersion || (frameID != nil && !ValidID(*frameID)) {
		return View{}, Invalid("画板预览范围无效")
	}
	release, err := s.renderer.Acquire(ctx)
	if err != nil {
		return View{}, err
	}
	defer release()
	snapshot, err := s.repo.PageSnapshot(ctx, sc, pageID, revision)
	if err != nil {
		return View{}, err
	}
	selected, err := SelectFrame(snapshot.Elements, frameID)
	if err != nil {
		return View{}, err
	}
	background := "#ffffff"
	for _, page := range snapshot.Board.Pages {
		if page.ID == pageID {
			background = page.Background
		}
	}
	svg, err := s.renderer.SVG(ctx, selected, background, assets)
	return View{Title: snapshot.Board.Title, Revision: snapshot.Board.Revision, SVG: svg}, err
}
func (s *Service) require(ctx context.Context, sc Scope, edit bool) error {
	permission := workspace.Read
	if edit {
		permission = workspace.Edit
	}
	return s.access.Require(ctx, sc.ActorID, sc.WorkspaceID, permission)
}
func fingerprint(input any) (string, error) {
	data, err := json.Marshal(input)
	if err != nil {
		return "", Invalid("画板操作不是有效 JSON")
	}
	if len(data) > MaxCommandBytes {
		return "", Limit()
	}
	return security.Digest(string(data)), nil
}
func (s *Service) Create(ctx context.Context, sc Scope, in Create) (Board, error) {
	if err := s.require(ctx, sc, true); err != nil {
		return Board{}, err
	}
	hash, err := ValidateCreate(s.catalog, in)
	if err != nil {
		return Board{}, err
	}
	return s.repo.Create(ctx, sc, in, hash, s.clock.Now().UnixMilli())
}

// ValidateCreate checks input before any SQL or idempotency reservation.
func ValidateCreate(catalog Catalog, in Create) (string, error) {
	if !ValidID(in.ID) || !ValidID(in.OperationID) || !ValidID(in.CollectionID) || !ValidID(in.PageID) || (in.ParentID != nil && !ValidID(*in.ParentID)) || !validText(in.Title, 240) || strings.TrimSpace(in.Title) == "" {
		return "", Invalid("画板名称或标识无效")
	}
	if len(in.Elements) > MaxBatch {
		return "", Limit()
	}
	for i := range in.Elements {
		if in.Elements[i].PageID != in.PageID {
			return "", Invalid("初始图元不属于创建页面")
		}
		if err := catalog.Validate(&in.Elements[i]); err != nil {
			return "", err
		}
	}
	return fingerprint(in)
}

func (s *Service) Get(ctx context.Context, sc Scope, revision int64) (Board, error) {
	if err := s.require(ctx, sc, false); err != nil {
		return Board{}, err
	}
	if revision < 0 || revision > MaxVersion {
		return Board{}, Invalid("画板版本无效")
	}
	return s.repo.Get(ctx, sc, revision)
}
func (s *Service) Elements(ctx context.Context, sc Scope, q ElementQuery) (ElementPage, error) {
	if err := s.require(ctx, sc, false); err != nil {
		return ElementPage{}, err
	}
	if !ValidID(q.PageID) || q.Revision < 1 || q.Revision > MaxVersion {
		return ElementPage{}, Invalid("页面或固定版本无效")
	}
	return s.repo.Elements(ctx, sc, q)
}
func (s *Service) Mutate(ctx context.Context, sc Scope, in Mutation) (Change, error) {
	if err := s.require(ctx, sc, true); err != nil {
		return Change{}, err
	}
	hash, err := ValidateMutation(s.catalog, in)
	if err != nil {
		return Change{}, err
	}
	return s.repo.Mutate(ctx, sc, in, hash, s.clock.Now().UnixMilli())
}

// ValidateMutation checks input before any SQL or idempotency reservation.
func ValidateMutation(catalog Catalog, in Mutation) (string, error) {
	if !ValidID(in.OperationID) || in.SchemaVersion != SchemaVersion {
		return "", Invalid("操作标识或画板格式版本无效")
	}
	if len(in.Commands) == 0 || len(in.Commands) > MaxCommands {
		return "", Limit()
	}
	affected := 0
	for i := range in.Commands {
		command := &in.Commands[i]
		switch command.Type {
		case "elements.create":
			if len(command.Elements) == 0 || len(command.Patches) != 0 || len(command.Targets) != 0 || command.Page != nil {
				return "", Invalid("创建图元命令格式无效")
			}
			for j := range command.Elements {
				if err := catalog.Validate(&command.Elements[j]); err != nil {
					return "", err
				}
			}
		case "elements.update", "layout.apply":
			if len(command.Patches) == 0 || len(command.Elements) != 0 || len(command.Targets) != 0 || command.Page != nil {
				return "", Invalid("更新图元命令格式无效")
			}
			for _, patch := range command.Patches {
				if !ValidID(patch.ID) {
					return "", Invalid("图元标识无效")
				}
			}
		case "elements.delete", "elements.restore":
			if len(command.Targets) == 0 || len(command.Elements) != 0 || len(command.Patches) != 0 || command.Page != nil {
				return "", Invalid("删除图元命令格式无效")
			}
			for _, target := range command.Targets {
				if !ValidID(target.ID) || target.Version < 1 || target.Version > MaxVersion {
					return "", Invalid("删除目标标识或版本无效")
				}
			}
		case "pages.create", "pages.update", "pages.delete", "pages.restore":
			if command.Page == nil || len(command.Elements)+len(command.Patches)+len(command.Targets) != 0 {
				return "", Invalid("页面命令格式无效")
			}
			if err := ValidatePage(*command.Page); err != nil {
				return "", err
			}
			affected++
		default:
			return "", Invalid("不支持的画板命令")
		}
		affected += len(command.Elements) + len(command.Patches) + len(command.Targets)
	}
	if affected > MaxBatch {
		return "", Limit()
	}
	return fingerprint(in)
}

func (s *Service) Changes(ctx context.Context, sc Scope, after int64) (ChangePage, error) {
	if err := s.require(ctx, sc, false); err != nil {
		return ChangePage{}, err
	}
	if after < 0 || after > MaxVersion {
		return ChangePage{}, Invalid("同步版本无效")
	}
	return s.repo.Changes(ctx, sc, after)
}
func (s *Service) Receipt(ctx context.Context, sc Scope, operation string) (Change, error) {
	if err := s.require(ctx, sc, false); err != nil {
		return Change{}, err
	}
	if !ValidID(operation) {
		return Change{}, Invalid("操作标识无效")
	}
	return s.repo.Receipt(ctx, sc, operation)
}
func (s *Service) Snapshot(ctx context.Context, sc Scope, revision int64) (Snapshot, error) {
	if _, err := s.Get(ctx, sc, revision); err != nil {
		return Snapshot{}, err
	}
	return s.repo.Snapshot(ctx, sc, revision)
}
func (s *Service) History(ctx context.Context, sc Scope, before int64) ([]HistoryItem, error) {
	if err := s.require(ctx, sc, false); err != nil {
		return nil, err
	}
	if before < 0 || before > MaxVersion {
		return nil, fault.Field("query.before", "历史版本无效")
	}
	return s.repo.History(ctx, sc, before)
}
