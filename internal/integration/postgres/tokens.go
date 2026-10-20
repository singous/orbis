// Package postgres persists scoped integration credentials and transactional operation records.
package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"orbis.local/orbis/internal/document"
	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/internal/identity"
	idstore "orbis.local/orbis/internal/identity/postgres"
	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
)

type Repository struct {
	db    *gorm.DB
	clock clock.Clock
}

func New(db *gorm.DB, c clock.Clock) *Repository { return &Repository{db: db, clock: c} }

type TokenRow struct {
	ID, OwnerID, WorkspaceID, Name, SecretHash, SecretPrefix string
	Permissions                                              json.RawMessage `gorm:"type:jsonb"`
	CollectionID, DocumentID                                 *string
	Version                                                  int64
	ExpiresAtMS, RevokedAtMS, LastUsedAtMS                   *int64
	CreatedAtMS, UpdatedAtMS                                 int64
}

func (TokenRow) TableName() string { return "integration_tokens" }
func (row TokenRow) Domain() (integration.Token, error) {
	permissions := []integration.Permission{}
	err := json.Unmarshal(row.Permissions, &permissions)
	return integration.Token{ID: row.ID, OwnerID: row.OwnerID, WorkspaceID: row.WorkspaceID, Name: row.Name, SecretHash: row.SecretHash, SecretPrefix: row.SecretPrefix, Permissions: permissions, CollectionID: row.CollectionID, DocumentID: row.DocumentID, Version: row.Version, ExpiresAtMS: row.ExpiresAtMS, RevokedAtMS: row.RevokedAtMS, LastUsedAtMS: row.LastUsedAtMS, CreatedAtMS: row.CreatedAtMS, UpdatedAtMS: row.UpdatedAtMS}, err
}
func tokenRow(token integration.Token) (TokenRow, error) {
	permissions, err := json.Marshal(token.Permissions)
	return TokenRow{ID: token.ID, OwnerID: token.OwnerID, WorkspaceID: token.WorkspaceID, Name: token.Name, SecretHash: token.SecretHash, SecretPrefix: token.SecretPrefix, Permissions: permissions, CollectionID: token.CollectionID, DocumentID: token.DocumentID, Version: token.Version, ExpiresAtMS: token.ExpiresAtMS, RevokedAtMS: token.RevokedAtMS, LastUsedAtMS: token.LastUsedAtMS, CreatedAtMS: token.CreatedAtMS, UpdatedAtMS: token.UpdatedAtMS}, err
}
func (r *Repository) CreateToken(ctx context.Context, scope integration.TokenScope, input integration.Token) (integration.Token, error) {
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		required := workspace.Read
		for _, permission := range input.Permissions {
			if permission == integration.DocumentsWrite || permission == integration.AssetsWrite || permission == integration.SharesManage {
				required = workspace.Edit
			}
		}
		if err := wsstore.RequireLocked(ctx, tx, scope.WorkspaceID, scope.ActorID, required); err != nil {
			return err
		}
		if input.DocumentID != nil {
			doc, err := docstore.New(tx).Get(ctx, scope.WorkspaceID, *input.DocumentID)
			if err != nil {
				return scopeNotFound(err)
			}
			if input.CollectionID != nil && *input.CollectionID != doc.CollectionID {
				return integration.ScopeMissing()
			}
			cid := doc.CollectionID
			input.CollectionID = &cid
		}
		if input.CollectionID != nil {
			if _, err := docstore.LockSnapshotCollection(ctx, tx, document.DirectoryScope{WorkspaceID: scope.WorkspaceID, CollectionID: *input.CollectionID}); err != nil {
				return scopeNotFound(err)
			}
		}
		if input.DocumentID != nil {
			if _, err := docstore.New(tx).Get(ctx, scope.WorkspaceID, *input.DocumentID); err != nil {
				return scopeNotFound(err)
			}
		}
		if input.ExpiresAtMS != nil && *input.ExpiresAtMS <= r.clock.Now().UnixMilli() {
			return fault.Field("body.expires_in_days", "令牌有效期已过")
		}
		row, err := tokenRow(input)
		if err != nil {
			return err
		}
		return tx.Create(&row).Error
	})
	return input, err
}
func (r *Repository) ListTokens(ctx context.Context, scope integration.TokenScope, page pagination.Page) ([]integration.Token, int64, error) {
	items := []integration.Token{}
	var total int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := wsstore.New(tx).Role(ctx, scope.WorkspaceID, scope.ActorID); err != nil {
			return err
		}
		q := tx.Model(&TokenRow{}).Where("owner_id=? AND workspace_id=?", scope.ActorID, scope.WorkspaceID)
		if err := q.Count(&total).Error; err != nil {
			return err
		}
		var rows []TokenRow
		if err := q.Order("created_at_ms DESC,id").Offset(page.Offset()).Limit(page.Size).Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			token, err := row.Domain()
			if err != nil {
				return err
			}
			items = append(items, token)
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return items, total, err
}
func (r *Repository) RevokeToken(ctx context.Context, scope integration.TokenScope, expected, timestamp int64) (integration.Token, error) {
	var row TokenRow
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := wsstore.RequireLocked(ctx, tx, scope.WorkspaceID, scope.ActorID, workspace.Read); err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "NO KEY UPDATE"}).Where("id=? AND owner_id=? AND workspace_id=?", scope.TokenID, scope.ActorID, scope.WorkspaceID).Take(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return fault.New(fault.NotFound, "INTEGRATION_TOKEN_NOT_FOUND", "集成令牌不存在")
			}
			return err
		}
		if row.RevokedAtMS != nil {
			return nil
		}
		if row.Version != expected {
			return fault.New(fault.Conflict, "INTEGRATION_TOKEN_VERSION_CONFLICT", "令牌已变化，请刷新后重试")
		}
		row.Version++
		row.RevokedAtMS = &timestamp
		row.UpdatedAtMS = timestamp
		return tx.Model(&TokenRow{}).Where("id=?", row.ID).Updates(map[string]any{"version": row.Version, "revoked_at_ms": timestamp, "updated_at_ms": timestamp}).Error
	})
	if err != nil {
		return integration.Token{}, err
	}
	return row.Domain()
}
func scopeNotFound(err error) error {
	var business *fault.Error
	if errors.Is(err, gorm.ErrRecordNotFound) || (errors.As(err, &business) && business.Kind == fault.NotFound) {
		return integration.ScopeMissing()
	}
	return err
}
func accessRevoked(err error) error {
	var business *fault.Error
	if errors.Is(err, identity.ErrNotFound) || (errors.As(err, &business) && business.Kind == fault.NotFound) {
		return fault.New(fault.Unauthenticated, "INTEGRATION_ACCESS_REVOKED", "当前账号或工作空间成员身份已失效")
	}
	return err
}
func (r *Repository) AuthenticateToken(ctx context.Context, wid, digest, legacy string) (integration.Principal, error) {
	var principal integration.Principal
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []TokenRow
		if err := tx.Where("secret_hash=? OR secret_hash=?", digest, legacy).Limit(2).Find(&rows).Error; err != nil {
			return err
		}
		if len(rows) != 1 {
			return integration.TokenInvalid()
		}
		row := rows[0]
		if row.WorkspaceID != wid {
			return fault.New(fault.Forbidden, "INTEGRATION_WORKSPACE_FORBIDDEN", "工作空间不在集成令牌授权范围内")
		}
		token, err := row.Domain()
		if err != nil {
			return err
		}
		role, err := wsstore.New(tx).Role(ctx, wid, row.OwnerID)
		if err != nil {
			return accessRevoked(err)
		}
		user, err := idstore.New(tx).FindUser(ctx, row.OwnerID)
		if err != nil {
			return accessRevoked(err)
		}
		if err := r.CheckTokenTime(token); err != nil {
			return err
		}
		var workspaceRow wsstore.WorkspaceRow
		if err := tx.Where("id=?", wid).Take(&workspaceRow).Error; err != nil {
			return accessRevoked(err)
		}
		principal = integration.Principal{Token: token, UserID: row.OwnerID, DisplayName: user.DisplayName, WorkspaceName: workspaceRow.Name, Role: role, Permissions: integration.EffectivePermissions(token.Permissions, role)}
		now := r.clock.Now().UnixMilli()
		if row.LastUsedAtMS == nil || now-*row.LastUsedAtMS >= integration.TokenUsageInterval.Milliseconds() {
			if err := tx.Model(&TokenRow{}).Where("id=? AND revoked_at_ms IS NULL AND (last_used_at_ms IS NULL OR last_used_at_ms<=?)", row.ID, now-integration.TokenUsageInterval.Milliseconds()).Update("last_used_at_ms", now).Error; err != nil {
				return err
			}
			principal.Token.LastUsedAtMS = &now
		}
		return nil
	})
	return principal, err
}
func (r *Repository) CheckTokenTime(token integration.Token) error {
	if token.RevokedAtMS != nil || (token.ExpiresAtMS != nil && *token.ExpiresAtMS <= r.clock.Now().UnixMilli()) {
		return integration.TokenInvalid()
	}
	return nil
}

// RequirePrincipal revalidates role, account/workspace state, permissions and token state in the caller transaction.
func (r *Repository) RequirePrincipal(ctx context.Context, tx *gorm.DB, claimed integration.Principal, permissions []integration.Permission, lock bool) (integration.Principal, error) {
	if lock {
		if err := wsstore.RequireLocked(ctx, tx, claimed.Token.WorkspaceID, claimed.UserID, workspace.Read); err != nil {
			return integration.Principal{}, accessRevoked(err)
		}
	}
	role, err := wsstore.New(tx).Role(ctx, claimed.Token.WorkspaceID, claimed.UserID)
	if err != nil {
		return integration.Principal{}, accessRevoked(err)
	}
	q := tx.WithContext(ctx).Where("id=? AND owner_id=? AND workspace_id=?", claimed.Token.ID, claimed.UserID, claimed.Token.WorkspaceID)
	if lock {
		q = q.Clauses(clause.Locking{Strength: "SHARE"})
	}
	var row TokenRow
	if err := q.Take(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return integration.Principal{}, integration.TokenInvalid()
		}
		return integration.Principal{}, err
	}
	token, err := row.Domain()
	if err != nil {
		return integration.Principal{}, err
	}
	if err := r.CheckTokenTime(token); err != nil {
		return integration.Principal{}, err
	}
	result := claimed
	result.Token = token
	result.Role = role
	result.Permissions = integration.EffectivePermissions(token.Permissions, role)
	for _, permission := range permissions {
		if err := result.Require(permission); err != nil {
			return integration.Principal{}, err
		}
	}
	return result, nil
}
func AllowedDocument(p integration.Principal, doc document.Document) bool {
	return doc.WorkspaceID == p.Token.WorkspaceID && (p.Token.CollectionID == nil || *p.Token.CollectionID == doc.CollectionID) && (p.Token.DocumentID == nil || *p.Token.DocumentID == doc.ID)
}
func (r *Repository) Document(ctx context.Context, tx *gorm.DB, p integration.Principal, did string, lock bool) (document.Document, error) {
	if p.Token.DocumentID != nil && *p.Token.DocumentID != did {
		return document.Document{}, integration.ScopeMissing()
	}
	if p.Token.CollectionID != nil {
		var count int64
		if err := tx.WithContext(ctx).Table("documents").Where("workspace_id=? AND collection_id=? AND id=?", p.Token.WorkspaceID, *p.Token.CollectionID, did).Count(&count).Error; err != nil {
			return document.Document{}, err
		}
		if count != 1 {
			return document.Document{}, integration.ScopeMissing()
		}
	}
	var doc document.Document
	var err error
	if lock {
		doc, err = docstore.LockContent(ctx, tx, document.DirectoryScope{ActorID: p.UserID, WorkspaceID: p.Token.WorkspaceID, DocumentID: did, CollectionID: func() string {
			if p.Token.CollectionID != nil {
				return *p.Token.CollectionID
			}
			return ""
		}()})
	} else {
		doc, err = docstore.New(tx).Get(ctx, p.Token.WorkspaceID, did)
	}
	if err != nil {
		return doc, scopeNotFound(err)
	}
	if !AllowedDocument(p, doc) {
		return doc, integration.ScopeMissing()
	}
	if err := r.CheckTokenTime(p.Token); err != nil {
		return doc, err
	}
	return doc, nil
}
