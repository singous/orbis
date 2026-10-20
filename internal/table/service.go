package table

import (
	"context"
	"encoding/json"

	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/internal/workspace"
)

type Access interface {
	Require(context.Context, string, string, workspace.Permission) error
}
type Service struct {
	repo   Repository
	access Access
	clock  clock.Clock
}

func New(repo Repository, access Access, clock clock.Clock) *Service {
	return &Service{repo: repo, access: access, clock: clock}
}
func operation(id string, version int64) error {
	if !ValidID(id) {
		return fault.Field("body.operation_id", "操作 ID 必须是标准 UUID")
	}
	if version < 1 || version >= MaxVersion {
		return fault.Field("body.expected_document_version", "文档版本号超出范围")
	}
	return nil
}
func fingerprint(kind string, scope Scope, input any) (string, error) {
	data, err := json.Marshal(struct {
		Kind, TableID string
		Input         any
	}{Kind: kind, TableID: scope.TableID, Input: input})
	if err != nil {
		return "", fault.Field("body", "表格操作不是有效 JSON")
	}
	return security.Digest(string(data)), nil
}
func (s *Service) Create(ctx context.Context, scope Scope, input CreateInput) (Result, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Edit); err != nil {
		return Result{}, err
	}
	if err := operation(input.OperationID, input.ExpectedDocumentVersion); err != nil {
		return Result{}, err
	}
	if !ValidID(input.BlockID) {
		return Result{}, fault.Field("body.block_id", "块 ID 必须是标准 UUID")
	}
	if input.Definition != nil && input.Source != nil {
		return Result{}, fault.Field("body", "definition 和 source 不能同时提供")
	}
	if input.Definition != nil {
		def, err := NormalizeDefinition(*input.Definition)
		if err != nil {
			return Result{}, err
		}
		input.Definition = &def
	}
	if source := input.Source; source != nil {
		if !ValidID(source.WorkspaceID) || !ValidID(source.DocumentID) || !ValidID(source.TableID) {
			return Result{}, fault.Field("body.source", "复制来源的资源 ID 不正确")
		}
		if source.DocumentVersion != nil && (*source.DocumentVersion < 1 || *source.DocumentVersion > MaxVersion) {
			return Result{}, fault.Field("body.source.document_version", "来源文档版本号超出范围")
		}
	}
	hash, err := fingerprint("table.create", scope, input)
	if err != nil {
		return Result{}, err
	}
	return s.repo.Create(ctx, CreateCommand{Scope: scope, Input: input, Hash: hash, Timestamp: s.clock.Now().UnixMilli()})
}
func (s *Service) Mutate(ctx context.Context, scope Scope, input MutationInput) (Result, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Edit); err != nil {
		return Result{}, err
	}
	if err := operation(input.OperationID, input.ExpectedDocumentVersion); err != nil {
		return Result{}, err
	}
	if input.ExpectedTableVersion < 1 || input.ExpectedTableVersion > MaxVersion {
		return Result{}, fault.Field("body.expected_table_version", "表格版本号超出范围")
	}
	changes, err := NormalizeChanges(input.Changes)
	if err != nil {
		return Result{}, err
	}
	input.Changes = changes
	hash, err := fingerprint("table.mutate", scope, input)
	if err != nil {
		return Result{}, err
	}
	return s.repo.Mutate(ctx, MutationCommand{Scope: scope, Input: input, Hash: hash, Timestamp: s.clock.Now().UnixMilli()})
}
func (s *Service) authorizeQuery(ctx context.Context, q Query) error {
	if err := s.access.Require(ctx, q.Scope.ActorID, q.Scope.WorkspaceID, workspace.Read); err != nil {
		return err
	}
	if q.DocumentVersion < 0 || q.DocumentVersion > MaxVersion {
		return fault.Field("query.document_version", "文档版本号超出范围")
	}
	if q.ViewID != "" && !ValidID(q.ViewID) {
		return fault.Field("query.view_id", "视图 ID 必须是标准 UUID")
	}
	if q.GroupID != nil && !ValidID(*q.GroupID) {
		return fault.Field("query.group_id", "分组值必须是标准 UUID 或 none")
	}
	return nil
}
func (s *Service) Metadata(ctx context.Context, q Query) (Metadata, error) {
	if err := s.authorizeQuery(ctx, q); err != nil {
		return Metadata{}, err
	}
	return s.repo.Metadata(ctx, q)
}
func (s *Service) Records(ctx context.Context, q Query) (Page, error) {
	if err := s.authorizeQuery(ctx, q); err != nil {
		return Page{}, err
	}
	return s.repo.Records(ctx, q)
}
func (s *Service) Export(ctx context.Context, q Query, format string) ([]byte, error) {
	if err := s.authorizeQuery(ctx, q); err != nil {
		return nil, err
	}
	if format != "csv" && format != "markdown" {
		return nil, fault.Field("query.format", "导出格式须为 csv 或 markdown")
	}
	data, err := s.repo.Export(ctx, q)
	if err != nil {
		return nil, err
	}
	return RenderExport(data, format)
}

func (s *Service) PublicRecords(ctx context.Context, query Query) (PublicPage, error) {
	if err := s.authorizeQuery(ctx, query); err != nil {
		return PublicPage{}, err
	}
	return s.repo.PublicRecords(ctx, query)
}
