package integration

import (
	"context"

	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/sharing"
)

func shareScopeAllowed(p Principal, cid string) error {
	if p.Token.DocumentID != nil || (p.Token.CollectionID != nil && *p.Token.CollectionID != cid) {
		return fault.New(fault.Forbidden, "INTEGRATION_SHARE_SCOPE_FORBIDDEN", "实时分享包含未来子文档，需要覆盖整个文集的令牌授权")
	}
	return nil
}
func (l *Library) CreateShare(ctx context.Context, p Principal, input sharing.CreateInput) (sharing.Created, error) {
	if err := p.Require(SharesManage); err != nil {
		return sharing.Created{}, err
	}
	if err := shareScopeAllowed(p, input.CollectionID); err != nil {
		return sharing.Created{}, err
	}
	ready, err := l.sharing.PrepareCreate(ctx, sharing.Scope{ActorID: p.UserID, WorkspaceID: p.Token.WorkspaceID}, input)
	if err != nil {
		return sharing.Created{}, err
	}
	return l.repo.CreateShare(ctx, p, ready)
}
func (l *Library) Shares(ctx context.Context, p Principal, q sharing.ListQuery) ([]sharing.Managed, int64, error) {
	if err := p.Require(SharesManage); err != nil {
		return nil, 0, err
	}
	if p.Token.DocumentID != nil {
		return nil, 0, shareScopeAllowed(p, "")
	}
	if p.Token.CollectionID != nil {
		if q.CollectionID != nil && *q.CollectionID != *p.Token.CollectionID {
			return nil, 0, shareScopeAllowed(p, *q.CollectionID)
		}
		q.CollectionID = p.Token.CollectionID
	}
	if q.CollectionID != nil && !validResourceID(*q.CollectionID) {
		return nil, 0, fault.Field("query.collection_id", "文集 ID 不正确")
	}
	q.Scope = sharing.Scope{ActorID: p.UserID, WorkspaceID: p.Token.WorkspaceID}
	items, total, err := l.repo.Shares(ctx, p, q)
	if err != nil {
		return nil, 0, err
	}
	result := []sharing.Managed{}
	for _, item := range items {
		result = append(result, sharing.Managed{Share: item, Path: l.sharing.RecoverPath(item)})
	}
	return result, total, nil
}
func (l *Library) RevokeShare(ctx context.Context, p Principal, id string, expected int64) (sharing.Share, error) {
	if err := p.Require(SharesManage); err != nil {
		return sharing.Share{}, err
	}
	if !validResourceID(id) || expected < 1 {
		return sharing.Share{}, fault.Field("body.expected_version", "分享 ID 或版本号不正确")
	}
	return l.repo.RevokeShare(ctx, p, id, expected)
}
