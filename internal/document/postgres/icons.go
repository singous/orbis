package postgres

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	assetstore "orbis.local/orbis/internal/asset/postgres"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
)

type iconAsset struct{ AssetID, WorkspaceID string }

func (iconAsset) TableName() string { return "collection_icon_assets" }

// RecordIcon participates in the caller's ready-file publication transaction.
func RecordIcon(ctx context.Context, tx *gorm.DB, wid, assetID string) error {
	return tx.WithContext(ctx).Create(&iconAsset{AssetID: assetID, WorkspaceID: wid}).Error
}
func requireIcon(ctx context.Context, tx *gorm.DB, wid string, icon *document.CollectionIcon) error {
	if icon == nil || icon.Type != "image" {
		return nil
	}
	var row assetstore.Record
	err := tx.WithContext(ctx).Table("assets a").Select("a.*").Joins("JOIN collection_icon_assets i ON i.asset_id=a.id AND i.workspace_id=a.workspace_id").Where("a.workspace_id=? AND a.id=? AND a.kind='file' AND a.state='ready' AND a.media_type IN ('image/png','image/webp')", wid, icon.AssetID).Clauses(clause.Locking{Strength: "SHARE", Table: clause.Table{Name: "a"}}).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return fault.New(fault.NotFound, "COLLECTION_ICON_NOT_FOUND", "图标文件不存在或不属于当前工作空间")
	}
	return err
}
