package postgres

import (
	"context"
	"database/sql"

	"gorm.io/gorm"
	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/sharing"
	sharestore "orbis.local/orbis/internal/sharing/postgres"
)

func canManageShare(p integration.Principal, cid string) error {
	if p.Token.DocumentID != nil || (p.Token.CollectionID != nil && *p.Token.CollectionID != cid) {
		return fault.New(fault.Forbidden, "INTEGRATION_SHARE_SCOPE_FORBIDDEN", "实时分享范围超出集成令牌授权")
	}
	return nil
}
func (r *Library) CreateShare(ctx context.Context, claimed integration.Principal, ready sharing.Created) (sharing.Created, error) {
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		p, err := r.tokens.RequirePrincipal(ctx, tx, claimed, []integration.Permission{integration.SharesManage}, true)
		if err != nil {
			return err
		}
		if err := canManageShare(p, ready.Share.CollectionID); err != nil {
			return err
		}
		ready.Share, err = sharestore.CreateInTransaction(ctx, tx, r.clock, sharing.Scope{ActorID: p.UserID, WorkspaceID: p.Token.WorkspaceID}, ready.Share)
		if err != nil {
			return err
		}
		return r.tokens.CheckTokenTime(p.Token)
	})
	return ready, err
}
func (r *Library) Shares(ctx context.Context, claimed integration.Principal, q sharing.ListQuery) ([]sharing.Share, int64, error) {
	result := []sharing.Share{}
	var total int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		p, err := r.tokens.RequirePrincipal(ctx, tx, claimed, []integration.Permission{integration.SharesManage}, false)
		if err != nil {
			return err
		}
		if p.Token.DocumentID != nil {
			return canManageShare(p, "")
		}
		if p.Token.CollectionID != nil {
			if q.CollectionID != nil && *q.CollectionID != *p.Token.CollectionID {
				return canManageShare(p, *q.CollectionID)
			}
			q.CollectionID = p.Token.CollectionID
		}
		q.Scope = sharing.Scope{ActorID: p.UserID, WorkspaceID: p.Token.WorkspaceID}
		result, total, err = sharestore.New(tx, r.clock, "").List(ctx, q)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, total, err
}
func (r *Library) RevokeShare(ctx context.Context, claimed integration.Principal, id string, expected int64) (sharing.Share, error) {
	var result sharing.Share
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		p, err := r.tokens.RequirePrincipal(ctx, tx, claimed, []integration.Permission{integration.SharesManage}, true)
		if err != nil {
			return err
		}
		share, err := sharestore.GetShare(ctx, tx, p.Token.WorkspaceID, id)
		if err != nil {
			return err
		}
		if err := canManageShare(p, share.CollectionID); err != nil {
			return err
		}
		result, err = sharestore.RevokeInTransaction(ctx, tx, sharing.Scope{ActorID: p.UserID, WorkspaceID: p.Token.WorkspaceID, ShareID: id}, expected, r.clock.Now().UnixMilli())
		if err != nil {
			return err
		}
		return r.tokens.CheckTokenTime(p.Token)
	})
	return result, err
}
