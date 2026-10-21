package publishing

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"strings"

	"orbis.local/orbis/internal/asset"
	"orbis.local/orbis/internal/document/publicview"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/internal/workspace"
)

const MaxConcurrentBuilds = 2

func (s *Service) require(ctx context.Context, scope Scope, permission workspace.Permission) error {
	return s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, permission)
}
func (s *Service) acquire(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case s.building <- struct{}{}:
		return nil
	default:
		return fault.New(fault.Unavailable, "SITE_BUILD_BUSY", "站点预览或发布繁忙，请稍后重试")
	}
}
func (s *Service) Create(ctx context.Context, scope Scope, input Config) (Site, error) {
	if err := s.require(ctx, scope, workspace.Edit); err != nil {
		return Site{}, err
	}
	config, err := Normalize(input)
	if err != nil {
		return Site{}, err
	}
	return s.repo.Create(ctx, scope, config, s.clock.Now().UnixMilli())
}
func (s *Service) Get(ctx context.Context, scope Scope) (Site, error) {
	if err := s.require(ctx, scope, workspace.Read); err != nil {
		return Site{}, err
	}
	return s.repo.Get(ctx, scope)
}
func (s *Service) List(ctx context.Context, scope Scope, page pagination.Page) ([]Site, int64, error) {
	if err := s.require(ctx, scope, workspace.Read); err != nil {
		return nil, 0, err
	}
	return s.repo.List(ctx, scope, page)
}
func validVersion(version int64) error {
	if version < 1 || version >= MaxVersion {
		return fault.Field("body.expected_version", "站点版本号不正确")
	}
	return nil
}
func (s *Service) Update(ctx context.Context, scope Scope, input Config, expected int64) (Site, error) {
	if err := s.require(ctx, scope, workspace.Edit); err != nil {
		return Site{}, err
	}
	if err := validVersion(expected); err != nil {
		return Site{}, err
	}
	config, err := Normalize(input)
	if err != nil {
		return Site{}, err
	}
	return s.repo.Update(ctx, scope, config, expected, s.clock.Now().UnixMilli())
}
func (s *Service) Sources(ctx context.Context, scope Scope) (Sources, error) {
	if err := s.require(ctx, scope, workspace.Read); err != nil {
		return Sources{}, err
	}
	return s.repo.Sources(ctx, scope)
}
func (s *Service) Preview(ctx context.Context, scope Scope) (Preview, error) {
	if err := s.require(ctx, scope, workspace.Read); err != nil {
		return Preview{}, err
	}
	if err := s.acquire(ctx); err != nil {
		return Preview{}, err
	}
	defer func() { <-s.building }()
	return s.repo.Preview(ctx, scope)
}
func commandHash(kind string, input any) (string, error) {
	encoded, err := json.Marshal(struct {
		Kind  string `json:"kind"`
		Input any    `json:"input"`
	}{kind, input})
	return security.Digest(string(encoded)), err
}
func (s *Service) Publish(ctx context.Context, scope Scope, input PublishInput) (Mutation, error) {
	if err := s.require(ctx, scope, workspace.Publish); err != nil {
		return Mutation{}, err
	}
	if !ValidID(input.OperationID) {
		return Mutation{}, fault.Field("body.operation_id", "操作 ID 必须是标准 UUID")
	}
	if err := validVersion(input.ExpectedVersion); err != nil {
		return Mutation{}, err
	}
	if !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(input.ExpectedSourceFingerprint) {
		return Mutation{}, fault.Field("body.expected_source_fingerprint", "请先预览来源变化并提供预览指纹")
	}
	hash, err := commandHash("publish", input)
	if err != nil {
		return Mutation{}, err
	}
	if err := s.acquire(ctx); err != nil {
		return Mutation{}, err
	}
	defer func() { <-s.building }()
	return s.repo.Publish(ctx, scope, input, hash, s.clock.Now().UnixMilli())
}
func (s *Service) Activate(ctx context.Context, scope Scope, input ActivateInput) (Mutation, error) {
	if err := s.require(ctx, scope, workspace.Publish); err != nil {
		return Mutation{}, err
	}
	if !ValidID(input.OperationID) || (input.ReleaseID != nil && !ValidID(*input.ReleaseID)) {
		return Mutation{}, fault.Field("body", "操作或发布版本 ID 不正确")
	}
	if err := validVersion(input.ExpectedVersion); err != nil {
		return Mutation{}, err
	}
	hash, err := commandHash("activate", input)
	if err != nil {
		return Mutation{}, err
	}
	return s.repo.Activate(ctx, scope, input, hash, s.clock.Now().UnixMilli())
}
func (s *Service) Releases(ctx context.Context, scope Scope, page pagination.Page) ([]Release, int64, error) {
	if err := s.require(ctx, scope, workspace.Read); err != nil {
		return nil, 0, err
	}
	return s.repo.Releases(ctx, scope, page)
}
func ValidatePublic(query PublicQuery) error {
	if !ValidSlug(query.Slug) {
		return MissingSite()
	}
	if query.ExpectedReleaseID != nil && !ValidID(*query.ExpectedReleaseID) {
		return fault.Field("query.release_id", "发布版本 ID 不正确")
	}
	return nil
}
func MissingSite() error {
	return fault.New(fault.NotFound, "SITE_NOT_FOUND", "站点不存在或尚未发布")
}
func MissingPage() error {
	return fault.New(fault.NotFound, "SITE_PAGE_NOT_FOUND", "公开页面不存在")
}
func (s *Service) Manifest(ctx context.Context, q PublicQuery) (Snapshot, error) {
	if err := ValidatePublic(q); err != nil {
		return Snapshot{}, err
	}
	return s.repo.Manifest(ctx, q)
}
func (s *Service) Page(ctx context.Context, q PublicQuery) (Page, error) {
	if err := ValidatePublic(q); err != nil {
		return Page{}, err
	}
	if q.PageSlug != "" && !ValidPageSlug(q.PageSlug) {
		return Page{}, MissingPage()
	}
	return s.repo.Page(ctx, q)
}
func (s *Service) Search(ctx context.Context, q PublicQuery, text string, page pagination.Page) (SearchResult, error) {
	if err := ValidatePublic(q); err != nil {
		return SearchResult{}, err
	}
	if !validText(text, 0, 240) {
		return SearchResult{}, fault.Field("query.q", "搜索内容不能超过 240 字符")
	}
	return s.repo.Search(ctx, q, text, page)
}
func (s *Service) Table(ctx context.Context, q TableQuery) (TablePage, error) {
	if err := ValidatePublic(q.PublicQuery); err != nil {
		return TablePage{}, err
	}
	if !ValidID(q.TableID) {
		return TablePage{}, MissingPage()
	}
	return s.repo.Table(ctx, q)
}
func (s *Service) Asset(ctx context.Context, q PublicQuery, id string) (asset.Record, error) {
	if err := ValidatePublic(q); err != nil {
		return asset.Record{}, err
	}
	if !ValidID(id) {
		return asset.Record{}, MissingPage()
	}
	return s.repo.Asset(ctx, q, id)
}
func (s *Service) HydrateTables(ctx context.Context, q PublicQuery, blocks []publicview.Block) ([]publicview.Block, error) {
	if err := ValidatePublic(q); err != nil {
		return nil, err
	}
	return s.repo.HydrateTables(ctx, q, blocks)
}

// AssetByDigest resolves only copies granted to the currently active release.
func (s *Service) AssetByDigest(ctx context.Context, q PublicQuery, digest string) (asset.Record, error) {
	if err := ValidatePublic(q); err != nil {
		return asset.Record{}, err
	}
	decoded, err := hex.DecodeString(digest)
	if err != nil || len(decoded) != 32 || strings.ToLower(digest) != digest {
		return asset.Record{}, MissingPage()
	}
	return s.repo.AssetByDigest(ctx, q, digest)
}
