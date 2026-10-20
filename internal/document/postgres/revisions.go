package postgres

import (
	"context"

	"gorm.io/gorm"

	"orbis.local/orbis/internal/identity"
)

// insertRevision snapshots the display name without inventing an account for historical anonymous authors.
func insertRevision(ctx context.Context, tx *gorm.DB, row revisionRow) error {
	if row.AuthorID != nil {
		var user struct{ DisplayName *string }
		if err := tx.WithContext(ctx).Table("users").Select("display_name").Where("id=?", *row.AuthorID).Take(&user).Error; err != nil {
			return err
		}
		row.AuthorName = (identity.User{DisplayName: user.DisplayName}).Name()
	}
	return tx.WithContext(ctx).Create(&row).Error
}
