package integration

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/internal/workspace"
)

const IntegrationTokenPrefix = "orbis_it_"
const DefaultTokenDays = 90
const MaxTokenDays = 365
const TokenUsageInterval = time.Minute

type Permission string

const DocumentsRead Permission = "documents:read"
const DocumentsWrite Permission = "documents:write"
const AssetsRead Permission = "assets:read"
const AssetsWrite Permission = "assets:write"
const SharesManage Permission = "shares:manage"

type TokenScope struct{ ActorID, WorkspaceID, TokenID string }
type TokenInput struct {
	Name          string       `json:"name"`
	Permissions   []Permission `json:"permissions,omitempty"`
	CollectionID  *string      `json:"collection_id"`
	DocumentID    *string      `json:"document_id"`
	ExpiresInDays int          `json:"expires_in_days,omitempty"`
}
type Token struct {
	ID           string       `json:"id"`
	Name         string       `json:"name"`
	OwnerID      string       `json:"-"`
	WorkspaceID  string       `json:"workspace_id"`
	Permissions  []Permission `json:"permissions"`
	CollectionID *string      `json:"collection_id"`
	DocumentID   *string      `json:"document_id"`
	SecretHash   string       `json:"-"`
	SecretPrefix string       `json:"secret_prefix"`
	Version      int64        `json:"version"`
	ExpiresAtMS  *int64       `json:"expires_at_ms"`
	RevokedAtMS  *int64       `json:"revoked_at_ms"`
	LastUsedAtMS *int64       `json:"last_used_at_ms"`
	CreatedAtMS  int64        `json:"created_at_ms"`
	UpdatedAtMS  int64        `json:"updated_at_ms"`
}
type Principal struct {
	Token               Token
	UserID              string
	DisplayName         *string
	WorkspaceName, Role string
	Permissions         []Permission
}

func (p Principal) Has(permission Permission) bool {
	for _, value := range p.Permissions {
		if value == permission {
			return true
		}
	}
	return false
}
func (p Principal) Require(permission Permission) error {
	if !p.Has(permission) {
		return fault.New(fault.Forbidden, "INTEGRATION_PERMISSION_DENIED", "集成令牌没有执行此操作的权限")
	}
	return nil
}
func EffectivePermissions(permissions []Permission, role string) []Permission {
	result := []Permission{}
	for _, permission := range permissions {
		switch permission {
		case DocumentsRead, DocumentsWrite, AssetsRead, AssetsWrite, SharesManage:
		default:
			continue
		}
		required := workspace.Read
		if permission == DocumentsWrite || permission == AssetsWrite || permission == SharesManage {
			required = workspace.Edit
		}
		if workspace.Allowed(role, required) {
			result = append(result, permission)
		}
	}
	return result
}

type TokenRepository interface {
	CreateToken(context.Context, TokenScope, Token) (Token, error)
	ListTokens(context.Context, TokenScope, pagination.Page) ([]Token, int64, error)
	RevokeToken(context.Context, TokenScope, int64, int64) (Token, error)
	AuthenticateToken(context.Context, string, string, string) (Principal, error)
}
type Tokens struct {
	repo   TokenRepository
	access document.Access
	clock  clock.Clock
}

func NewTokens(repo TokenRepository, access document.Access, c clock.Clock) *Tokens {
	return &Tokens{repo: repo, access: access, clock: c}
}
func TokenHash(raw string) string { return security.Digest("orbis:integration:" + raw) }
func AuthRequired() error {
	return fault.New(fault.Unauthenticated, "INTEGRATION_AUTH_REQUIRED", "需要有效的集成令牌")
}
func TokenInvalid() error {
	return fault.New(fault.Unauthenticated, "INTEGRATION_TOKEN_INVALID", "集成令牌无效、已撤销或已过期")
}
func ScopeMissing() error {
	return fault.New(fault.NotFound, "INTEGRATION_SCOPE_NOT_FOUND", "资源不存在或不在集成令牌授权范围内")
}
func (t *Tokens) Create(ctx context.Context, scope TokenScope, input TokenInput) (Token, string, error) {
	if err := t.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Read); err != nil {
		return Token{}, "", err
	}
	input.Name = strings.TrimSpace(input.Name)
	if n := utf8.RuneCountInString(input.Name); n < 1 || n > 120 || strings.ContainsRune(input.Name, 0) {
		return Token{}, "", fault.Field("body.name", "令牌名称须为 1 至 120 个字符")
	}
	if input.Permissions == nil {
		input.Permissions = []Permission{DocumentsRead}
	}
	if len(input.Permissions) < 1 || len(input.Permissions) > 5 {
		return Token{}, "", fault.Field("body.permissions", "权限数量不正确")
	}
	permissions := []Permission{DocumentsRead}
	seen := map[Permission]bool{DocumentsRead: true}
	for _, permission := range input.Permissions {
		switch permission {
		case DocumentsRead, AssetsRead:
		case DocumentsWrite, AssetsWrite, SharesManage:
			if err := t.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Edit); err != nil {
				return Token{}, "", err
			}
		default:
			return Token{}, "", fault.Field("body.permissions", "权限不受支持")
		}
		if !seen[permission] {
			permissions = append(permissions, permission)
			seen[permission] = true
		}
	}
	for _, id := range []*string{input.CollectionID, input.DocumentID} {
		if id != nil && !validResourceID(*id) {
			return Token{}, "", fault.Field("body", "授权范围 ID 不正确")
		}
	}
	if input.ExpiresInDays == 0 {
		input.ExpiresInDays = DefaultTokenDays
	}
	if input.ExpiresInDays < 1 || input.ExpiresInDays > MaxTokenDays {
		return Token{}, "", fault.Field("body.expires_in_days", "有效期须为 1 至 365 天")
	}
	entropy, err := security.RandomToken()
	if err != nil {
		return Token{}, "", err
	}
	raw := IntegrationTokenPrefix + entropy
	now := t.clock.Now()
	expires := now.Add(time.Duration(input.ExpiresInDays) * 24 * time.Hour).UnixMilli()
	token := Token{ID: uuid.NewString(), Name: input.Name, OwnerID: scope.ActorID, WorkspaceID: scope.WorkspaceID, Permissions: permissions, CollectionID: input.CollectionID, DocumentID: input.DocumentID, SecretHash: TokenHash(raw), SecretPrefix: raw[:16], Version: 1, ExpiresAtMS: &expires, CreatedAtMS: now.UnixMilli(), UpdatedAtMS: now.UnixMilli()}
	token, err = t.repo.CreateToken(ctx, scope, token)
	return token, raw, err
}
func validResourceID(id string) bool {
	value, err := uuid.Parse(id)
	return err == nil && value != uuid.Nil && value.String() == id
}
func (t *Tokens) List(ctx context.Context, scope TokenScope, page pagination.Page) ([]Token, int64, error) {
	if err := t.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Read); err != nil {
		return nil, 0, err
	}
	return t.repo.ListTokens(ctx, scope, page)
}
func (t *Tokens) Revoke(ctx context.Context, scope TokenScope, expected int64) (Token, error) {
	if err := t.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Read); err != nil {
		return Token{}, err
	}
	if expected < 1 || expected >= 1<<53-1 {
		return Token{}, fault.Field("body.expected_version", "令牌版本号不正确")
	}
	return t.repo.RevokeToken(ctx, scope, expected, t.clock.Now().UnixMilli())
}
func (t *Tokens) Authenticate(ctx context.Context, raw, wid string) (Principal, error) {
	if !strings.HasPrefix(raw, IntegrationTokenPrefix) || len(raw) != len(IntegrationTokenPrefix)+43 {
		return Principal{}, AuthRequired()
	}
	if !validResourceID(wid) {
		return Principal{}, fault.Field("path.workspace_id", "工作空间 ID 不正确")
	}
	return t.repo.AuthenticateToken(ctx, wid, TokenHash(raw), security.Digest(raw))
}
