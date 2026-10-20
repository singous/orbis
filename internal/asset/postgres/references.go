package postgres

import (
	"context"
	"sort"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"orbis.local/orbis/internal/platform/fault"
)

// RequireFiles pins ready workspace files for the caller's document transaction.
func RequireFiles(ctx context.Context, tx *gorm.DB, wid string, ids []string) (map[string]string, error) {
	media := map[string]string{}
	for _, id := range ids {
		media[id] = ""
	}
	unique := make([]string, 0, len(media))
	for id := range media {
		unique = append(unique, id)
	}
	sort.Strings(unique)
	if len(unique) == 0 {
		return media, nil
	}
	var rows []Record
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "SHARE"}).Where("workspace_id=? AND id IN ? AND kind='file' AND state='ready'", wid, unique).Order("id").Find(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) != len(unique) {
		return nil, fault.New(fault.NotFound, "ASSET_REFERENCE_NOT_FOUND", "引用的文件不存在或不属于当前工作空间")
	}
	for _, row := range rows {
		media[row.ID] = row.MediaType
	}
	return media, nil
}
