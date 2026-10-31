package sheet

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
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
	return &Service{repo, access, clock}
}
func (s *Service) require(ctx context.Context, sc Scope, edit bool) error {
	p := workspace.Read
	if edit {
		p = workspace.Edit
	}
	return s.access.Require(ctx, sc.ActorID, sc.WorkspaceID, p)
}
func (s *Service) List(ctx context.Context, sc Scope, collection, cursor string) (ListPage, error) {
	if err := s.require(ctx, sc, false); err != nil {
		return ListPage{}, err
	}
	if collection != "" && !ValidID(collection) || cursor != "" && !ValidID(cursor) {
		return ListPage{}, Invalid("查询标识无效")
	}
	return s.repo.List(ctx, sc, collection, cursor)
}

func (s *Service) Create(ctx context.Context, sc Scope, in Create) (Sheet, error) {
	if err := s.require(ctx, sc, true); err != nil {
		return Sheet{}, err
	}
	if !ValidID(in.ID) || !ValidID(in.CollectionID) || !validName(in.Title, 240) {
		return Sheet{}, Invalid("请填写有效的数据表名称和所属笔记本")
	}
	if in.DocumentID != "" && !ValidID(in.DocumentID) || in.ParentID != nil && !ValidID(*in.ParentID) {
		return Sheet{}, Invalid("文档标识无效")
	}
	switch in.Template {
	case "", "books", "tasks", "plan", "contacts":
	default:
		return Sheet{}, Invalid("模板不存在")
	}
	return s.repo.Create(ctx, sc, in, s.clock.Now().UnixMilli())
}
func (s *Service) Get(ctx context.Context, sc Scope) (Sheet, error) {
	if err := s.require(ctx, sc, false); err != nil {
		return Sheet{}, err
	}
	return s.repo.Get(ctx, sc)
}
func (s *Service) Update(ctx context.Context, sc Scope, in Update) (Sheet, error) {
	if err := s.require(ctx, sc, true); err != nil {
		return Sheet{}, err
	}
	if in.Version < 1 || !validName(in.Title, 240) {
		return Sheet{}, Invalid("名称或版本无效")
	}
	if err := ValidateDefinition(in.Definition); err != nil {
		return Sheet{}, err
	}
	return s.repo.Update(ctx, sc, in, s.clock.Now().UnixMilli())
}
func validateQuery(q *Query) error {
	if q.Limit == 0 {
		q.Limit = PageSize
	}
	if q.Limit < 1 || q.Limit > PageSize || len(q.Cursor) > 8192 || len(q.Search) > 200 {
		return Invalid("查询超出限制")
	}
	return nil
}
func (s *Service) Records(ctx context.Context, sc Scope, q Query) (Page, error) {
	if err := s.require(ctx, sc, false); err != nil {
		return Page{}, err
	}
	if err := validateQuery(&q); err != nil {
		return Page{}, err
	}
	return s.repo.Records(ctx, sc, q)
}
func (s *Service) Stats(ctx context.Context, sc Scope, q Query) (Stats, error) {
	if err := s.require(ctx, sc, false); err != nil {
		return Stats{}, err
	}
	if err := validateQuery(&q); err != nil {
		return Stats{}, err
	}
	return s.repo.Stats(ctx, sc, q)
}
func (s *Service) Change(ctx context.Context, sc Scope, in Changes) (ChangeResult, error) {
	if err := s.require(ctx, sc, true); err != nil {
		return ChangeResult{}, err
	}
	if !ValidID(in.OperationID) || in.SchemaVersion < 1 || len(in.Records) < 1 || len(in.Records) > MaxBatch {
		return ChangeResult{}, Invalid("修改请求无效或超过 200 条记录")
	}
	seen := map[string]bool{}
	for _, p := range in.Records {
		if !ValidID(p.ID) || p.Version < 0 || seen[p.ID] {
			return ChangeResult{}, Invalid("记录标识或版本无效")
		}
		seen[p.ID] = true
	}
	for _, p := range in.Records {
		anchor := p.BeforeID
		if anchor == "" {
			anchor = p.AfterID
		}
		if anchor != "" && (!ValidID(anchor) || seen[anchor] || p.Delete) || p.BeforeID != "" && p.AfterID != "" {
			return ChangeResult{}, Invalid("排序参照记录无效或与本次修改冲突")
		}
	}
	return s.repo.Change(ctx, sc, in, s.clock.Now().UnixMilli())
}
func (s *Service) Forms(ctx context.Context, sc Scope) ([]Form, error) {
	if err := s.require(ctx, sc, false); err != nil {
		return nil, err
	}
	return s.repo.Forms(ctx, sc)
}
func (s *Service) SaveForm(ctx context.Context, sc Scope, f Form) (Form, error) {
	if err := s.require(ctx, sc, true); err != nil {
		return Form{}, err
	}
	if !ValidID(f.ID) || f.Version < 0 || !validName(f.Config.Title, 240) || len(f.Config.Description) > MaxText || len(f.Config.Fields) < 1 || len(f.Config.Fields) > MaxFields {
		return Form{}, Invalid("表单配置无效")
	}
	return s.repo.SaveForm(ctx, sc, f, s.clock.Now().UnixMilli())
}
func (s *Service) PublicForm(ctx context.Context, token string) (PublicForm, error) {
	f, t, err := s.repo.PublicForm(ctx, token)
	if err != nil {
		return PublicForm{}, err
	}
	fields := []Field{}
	byID := Fields(t.Definition)
	for _, ff := range f.Config.Fields {
		field, ok := byID[ff.FieldID]
		if ok {
			field.Default = nil
			fields = append(fields, field)
		}
	}
	return PublicForm{f.ID, f.Version, f.Config, fields}, nil
}
func (s *Service) Submit(ctx context.Context, token string, in Submission) error {
	if !ValidID(in.OperationID) || in.Version < 1 || len(in.Values) > MaxFields {
		return Invalid("提交内容无效")
	}
	data, _ := json.Marshal(in.Values)
	if len(data) > MaxRecordBytes {
		return Invalid("提交内容过大")
	}
	return s.repo.Submit(ctx, token, in, s.clock.Now().UnixMilli())
}
func Invalid(message string) error { return fault.Field("body", message) }
func Conflict() error {
	return fault.New(fault.Conflict, "SHEET_VERSION_CONFLICT", "内容已被其他人修改，请刷新后重试；本地修改仍保留")
}
func ValidID(s string) bool {
	id, err := uuid.Parse(s)
	return err == nil && id != uuid.Nil && id.String() == s
}

func (s *Service) UploadScope(ctx context.Context, token, field string) (Scope, error) {
	if !ValidID(field) {
		return Scope{}, Invalid("字段无效")
	}
	return s.repo.UploadScope(ctx, token, field)
}
func (s *Service) RegisterUpload(ctx context.Context, token, field, asset string) error {
	return s.repo.RegisterUpload(ctx, token, field, asset, s.clock.Now().UnixMilli())
}
