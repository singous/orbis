package postgres

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"orbis.local/orbis/internal/asset"
	assetstore "orbis.local/orbis/internal/asset/postgres"
	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/internal/identity"
	idstore "orbis.local/orbis/internal/identity/postgres"
	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
)

type Assets struct {
	*assetstore.Repository
	db    *gorm.DB
	clock clock.Clock
}

func NewAssets(db *gorm.DB, clock clock.Clock) *Assets {
	return &Assets{Repository: assetstore.New(db, clock), db: db, clock: clock}
}

// PublishAvatar makes the new object, profile pointer, and previous object's retirement atomic.
func (r *Assets) PublishAvatar(ctx context.Context, actor, id string, expected int64, write asset.WriteObject) (identity.User, error) {
	var result identity.User
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		user, err := idstore.LockProfile(ctx, tx, actor, expected)
		if err != nil {
			return err
		}
		if _, err := assetstore.PublishInTransaction(
			ctx,
			tx,
			r.clock,
			actor,
			id,
			"avatar",
			nil,
			write,
		); err != nil {
			return err
		}
		now := r.clock.Now().UnixMilli()
		result, err = idstore.SetAvatar(ctx, tx, user, &id, now)
		if err != nil {
			return err
		}
		return assetstore.RetireAvatar(ctx, tx, actor, user.AvatarAssetID, now)
	})
	return result, err
}
func (r *Assets) Avatar(ctx context.Context, actor string) (asset.Record, error) {
	var row assetstore.Record
	err := r.db.WithContext(ctx).Table("assets a").Select("a.*").Joins("JOIN users u ON u.avatar_asset_id=a.id AND u.id=a.owner_id").Where(
		"u.id=? AND a.kind='avatar' AND a.state='ready'",
		actor,
	).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return asset.Record{}, fault.Missing()
	}
	return row.Domain(), err
}
func (r *Assets) ClearAvatar(ctx context.Context, actor string, expected int64) (identity.User, error) {
	var result identity.User
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		user, err := idstore.LockProfile(ctx, tx, actor, expected)
		if err != nil {
			return err
		}
		now := r.clock.Now().UnixMilli()
		result, err = idstore.SetAvatar(ctx, tx, user, nil, now)
		if err != nil {
			return err
		}
		return assetstore.RetireAvatar(ctx, tx, actor, user.AvatarAssetID, now)
	})
	return result, err
}

// PublishIcon commits ready metadata and its normalization marker atomically.
func (r *Assets) PublishIcon(ctx context.Context, scope asset.Scope, id string, write asset.WriteObject) (asset.Record, error) {
	var result asset.Record
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := wsstore.RequireLocked(ctx, tx, scope.WorkspaceID, scope.ActorID, workspace.Edit); err != nil {
			return err
		}
		var err error
		result, err = assetstore.PublishInTransaction(ctx, tx, r.clock, scope.ActorID, id, "file", &scope.WorkspaceID, write)
		if err != nil {
			return err
		}
		return docstore.RecordIcon(ctx, tx, scope.WorkspaceID, id)
	})
	return result, err
}
