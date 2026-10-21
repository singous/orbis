package sharing

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/asset"
	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/internal/workspace"
)

type Service struct {
	repo      Repository
	access    Access
	clock     clock.Clock
	key       []byte
	legacyKey []byte
	cursors   *security.CursorSigner
	reads     chan struct{}
}

func New(repo Repository, access Access, c clock.Clock, key, legacyKey string) *Service {
	return &Service{repo: repo, access: access, clock: c, key: []byte(key), legacyKey: []byte(legacyKey), cursors: security.NewCursorSigner("live-share:" + key), reads: make(chan struct{}, MaxReadConcurrency)}
}
func validID(value string) bool {
	id, err := uuid.Parse(value)
	return err == nil && id != uuid.Nil && id.String() == value
}
func Missing() error {
	return fault.New(fault.NotFound, "SHARE_NOT_FOUND", "分享不存在、已撤销、已过期或资源不在分享范围内")
}
func ContentChanged() error {
	return fault.New(fault.Conflict, "SHARE_CONTENT_CHANGED", "在线文档已变化，请重新读取正文")
}
func (s *Service) token(share Share) string {
	root := "*"
	if share.RootDocumentID != nil {
		root = *share.RootDocumentID
	}
	mac := hmac.New(sha256.New, s.key)
	mac.Write([]byte("orbis:live-share:v1:" + share.ID + ":" + share.WorkspaceID + ":" + share.CollectionID + ":" + root))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func tokenDigest(value string) string { return security.Digest("orbis:live-share:" + value) }
func (s *Service) PrepareCreate(ctx context.Context, scope Scope, input CreateInput) (Created, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Edit); err != nil {
		return Created{}, err
	}
	if !input.AcknowledgePublicScope {
		return Created{}, fault.New(fault.Validation, "SHARE_SCOPE_ACKNOWLEDGEMENT_REQUIRED", "创建前请确认当前范围及未来新增文档将公开")
	}
	if !validID(input.CollectionID) || (input.RootDocumentID != nil && !validID(*input.RootDocumentID)) {
		return Created{}, fault.Field("body", "文集或根文档 ID 不正确")
	}
	now := s.clock.Now().UnixMilli()
	if input.ExpiresAtMS != nil && (*input.ExpiresAtMS <= now || *input.ExpiresAtMS > now+MaxLifetimeMS || *input.ExpiresAtMS > MaxVersion) {
		return Created{}, fault.Field("body.expires_at_ms", "有效期必须在未来 365 天内，或为 null")
	}
	share := Share{ID: uuid.NewString(), WorkspaceID: scope.WorkspaceID, CollectionID: input.CollectionID, RootDocumentID: input.RootDocumentID, CreatedBy: scope.ActorID, ExpiresAtMS: input.ExpiresAtMS, Version: 1, CreatedAtMS: now, UpdatedAtMS: now}
	token := s.token(share)
	share.Digest = tokenDigest(token)
	return Created{Share: share, Token: token, Path: "/share/" + token}, nil
}
func (s *Service) List(ctx context.Context, q ListQuery) ([]Managed, int64, error) {
	if err := s.access.Require(ctx, q.Scope.ActorID, q.Scope.WorkspaceID, workspace.Edit); err != nil {
		return nil, 0, err
	}
	if (q.CollectionID != nil && !validID(*q.CollectionID)) || (q.RootDocumentID != nil && !validID(*q.RootDocumentID)) {
		return nil, 0, fault.Field("query", "文集或根文档 ID 不正确")
	}
	shares, total, err := s.repo.List(ctx, q)
	if err != nil {
		return nil, 0, err
	}
	items := []Managed{}
	now := s.clock.Now().UnixMilli()
	for _, share := range shares {
		item := Managed{Share: share, Path: s.recoverPathAt(share, now)}
		items = append(items, item)
	}
	return items, total, nil
}
func (s *Service) Revoke(ctx context.Context, scope Scope, expected int64) (Share, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Edit); err != nil {
		return Share{}, err
	}
	if expected < 1 || expected >= MaxVersion {
		return Share{}, fault.Field("body.expected_version", "分享版本号不正确")
	}
	return s.repo.Revoke(ctx, scope, expected, s.clock.Now().UnixMilli())
}
func prepare(q PublicQuery) (PublicQuery, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(q.Token)
	if err != nil || len(decoded) != 32 || len(q.Token) != 43 {
		return q, Missing()
	}
	q.Digest = tokenDigest(q.Token)
	q.LegacyDigest = security.Digest(q.Token)
	for _, id := range []string{q.DocumentID, q.BlockID, q.TableID, q.AssetID} {
		if id != "" && !validID(id) {
			return q, Missing()
		}
	}
	if q.ParentID != nil && !validID(*q.ParentID) {
		return q, Missing()
	}
	if q.Version < 0 || q.Version > MaxVersion || q.DirectoryVersion < 0 || q.DirectoryVersion > MaxVersion {
		return q, fault.Field("query.version", "版本号不正确")
	}
	return q, nil
}
func (s *Service) acquire(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case s.reads <- struct{}{}:
		return nil
	default:
		return fault.New(fault.Unavailable, "SHARE_READ_BUSY", "分享读取繁忙，请稍后重试")
	}
}
func (s *Service) Directory(ctx context.Context, q PublicQuery) (Directory, error) {
	q, err := prepare(q)
	if err != nil {
		return Directory{}, err
	}
	return s.repo.Directory(ctx, q)
}
func (s *Service) Document(ctx context.Context, q PublicQuery) (Document, error) {
	q, err := prepare(q)
	if err != nil {
		return Document{}, err
	}
	return s.repo.Document(ctx, q)
}
func (s *Service) Content(ctx context.Context, q PublicQuery) (Content, error) {
	q, err := prepare(q)
	if err != nil {
		return Content{}, err
	}
	if err := s.acquire(ctx); err != nil {
		return Content{}, err
	}
	defer func() { <-s.reads }()
	result, err := s.repo.Content(ctx, q)
	if err != nil {
		return Content{}, err
	}
	encoded, err := json.Marshal(result.Blocks)
	if err != nil {
		return Content{}, err
	}
	if len(encoded) > MaxPageBytes {
		return Content{}, fault.New(fault.TooLarge, "SHARE_CONTENT_TOO_LARGE", "正文超过单次读取预算，请使用块分页")
	}
	return result, nil
}

type cursor struct {
	Kind                       string
	ParentID                   *string
	AfterPosition              int
	ShareID, DocumentID, After string
	Version                    int64
}

func (s *Service) Blocks(ctx context.Context, q PublicQuery, token string) (BlockPage, *string, bool, error) {
	q, err := prepare(q)
	if err != nil {
		return BlockPage{}, nil, false, err
	}
	if q.Limit < 1 || q.Limit > pagination.MaxSize {
		return BlockPage{}, nil, false, fault.Field("query.page_size", "每页数量必须在 1 至 100 之间")
	}
	if token != "" {
		var value cursor
		if err := s.cursors.Decode(token, &value); err != nil || (value.Kind != "" && value.Kind != "flat") || value.DocumentID != q.DocumentID || (q.Version != 0 && q.Version != value.Version) || value.Version < 1 || !validID(value.ShareID) || !validID(value.After) {
			return BlockPage{}, nil, false, fault.Field("query.cursor", "游标无效或与分享范围不匹配")
		}
		q.Version = value.Version
		q.After = value.After
		q.ShareID = value.ShareID
	}
	if err := s.acquire(ctx); err != nil {
		return BlockPage{}, nil, false, err
	}
	defer func() { <-s.reads }()
	result, err := s.repo.Blocks(ctx, q)
	if err != nil {
		return BlockPage{}, nil, false, err
	}
	hasMore := result.HasMore
	encoded, err := json.Marshal(result.Items)
	if err != nil {
		return BlockPage{}, nil, false, err
	}
	if len(encoded) > MaxPageBytes {
		return BlockPage{}, nil, false, fault.New(fault.TooLarge, "SHARE_CONTENT_TOO_LARGE", "块分页超出预算，请减小 page_size")
	}
	var next *string
	if hasMore {
		value, err := s.cursors.Encode(cursor{Kind: "flat", ShareID: result.ShareID, DocumentID: q.DocumentID, After: result.Items[len(result.Items)-1].ID, Version: result.Document.ContentVersion})
		if err != nil {
			return BlockPage{}, nil, false, err
		}
		next = &value
	}
	return result, next, hasMore, nil
}
func (s *Service) Block(ctx context.Context, q PublicQuery) (Block, error) {
	q, err := prepare(q)
	if err != nil {
		return Block{}, err
	}
	if err := s.acquire(ctx); err != nil {
		return Block{}, err
	}
	defer func() { <-s.reads }()
	return s.repo.Block(ctx, q)
}
func (s *Service) Asset(ctx context.Context, q PublicQuery) (asset.Record, error) {
	q, err := prepare(q)
	if err != nil {
		return asset.Record{}, err
	}
	return s.repo.Asset(ctx, q)
}
func (s *Service) Table(ctx context.Context, q PublicQuery) (PublicTablePage, error) {
	q, err := prepare(q)
	if err != nil {
		return PublicTablePage{}, err
	}
	if err := s.acquire(ctx); err != nil {
		return PublicTablePage{}, err
	}
	defer func() { <-s.reads }()
	return s.repo.Table(ctx, q)
}

func (s *Service) Create(ctx context.Context, scope Scope, input CreateInput) (Created, error) {
	ready, err := s.PrepareCreate(ctx, scope, input)
	if err != nil {
		return Created{}, err
	}
	ready.Share, err = s.repo.Create(ctx, scope, ready.Share)
	return ready, err
}
func (s *Service) RecoverPath(share Share) *string {
	return s.recoverPathAt(share, s.clock.Now().UnixMilli())
}
func (s *Service) recoverPathAt(share Share, now int64) *string {
	if share.RevokedAtMS != nil || (share.ExpiresAtMS != nil && *share.ExpiresAtMS <= now) {
		return nil
	}
	token := s.token(share)
	if !hmac.Equal([]byte(tokenDigest(token)), []byte(share.Digest)) {
		if len(s.legacyKey) == 0 {
			return nil
		}
		root := "*"
		if share.RootDocumentID != nil {
			root = *share.RootDocumentID
		}
		hash := hmac.New(sha256.New, s.legacyKey)
		_, _ = hash.Write([]byte("orbis:live-document-share:v1:" + share.ID + ":" + share.WorkspaceID + ":" + share.CollectionID + ":" + root))
		token = base64.RawURLEncoding.EncodeToString(hash.Sum(nil))
		if !hmac.Equal([]byte(security.Digest(token)), []byte(share.Digest)) {
			return nil
		}
	}
	path := "/share/" + token
	return &path
}

func (s *Service) Children(ctx context.Context, q PublicQuery, token string) (ChildPage, *string, bool, error) {
	q, err := prepare(q)
	if err != nil {
		return ChildPage{}, nil, false, err
	}
	if q.Limit < 1 || q.Limit > pagination.MaxSize {
		return ChildPage{}, nil, false, fault.Field("query.page_size", "每页数量必须在 1 至 100 之间")
	}
	if token != "" {
		var value cursor
		if err := s.cursors.Decode(token, &value); err != nil || value.Kind != "children" || value.DocumentID != q.DocumentID || (q.Version != 0 && q.Version != value.Version) || value.Version < 1 || value.Version > MaxVersion || !validID(value.ShareID) || !validID(value.After) || value.AfterPosition < 0 || !sameParent(value.ParentID, q.ParentID) {
			return ChildPage{}, nil, false, fault.Field("query.cursor", "游标无效或与分享范围不匹配")
		}
		q.Version = value.Version
		q.After = value.After
		q.AfterPosition = value.AfterPosition
		q.ShareID = value.ShareID
	}
	if err := s.acquire(ctx); err != nil {
		return ChildPage{}, nil, false, err
	}
	defer func() { <-s.reads }()
	result, err := s.repo.Children(ctx, q)
	if err != nil {
		return ChildPage{}, nil, false, err
	}
	var next *string
	if result.HasMore {
		last := result.Items[len(result.Items)-1]
		value, err := s.cursors.Encode(cursor{Kind: "children", ShareID: result.ShareID, DocumentID: q.DocumentID, ParentID: q.ParentID, After: last.ID, AfterPosition: last.Position, Version: result.Document.ContentVersion})
		if err != nil {
			return ChildPage{}, nil, false, err
		}
		next = &value
	}
	return result, next, result.HasMore, nil
}
func sameParent(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
