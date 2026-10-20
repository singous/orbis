package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sort"
	"strconv"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/internal/publishing"
	"orbis.local/orbis/internal/table"
	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
)

func strconvInt(value int64) string { return strconv.FormatInt(value, 10) }

type bodyRow struct {
	Digest    string
	Blocks    json.RawMessage `gorm:"type:jsonb"`
	PlainText string
}

func (bodyRow) TableName() string { return "published_page_bodies" }

type pageRow struct {
	ReleaseID, Slug string
	Position        int
	Metadata        json.RawMessage `gorm:"type:jsonb"`
	BodyDigest      string
}

func (pageRow) TableName() string { return "site_release_pages" }

type publicTableRow struct {
	ID, Digest string
	Metadata   json.RawMessage `gorm:"type:jsonb"`
	Total      int64
}

func (publicTableRow) TableName() string { return "published_table_snapshots" }

type publicRecordRow struct {
	SnapshotID, RecordID string
	Position             int
	Values               json.RawMessage `gorm:"type:jsonb"`
}

func (publicRecordRow) TableName() string { return "published_table_records" }

type tableGrant struct{ ReleaseID, SnapshotID string }

func (tableGrant) TableName() string { return "site_release_tables" }

type assetGrant struct{ ReleaseID, AssetID, SHA256 string }

func (assetGrant) TableName() string { return "site_release_assets" }
func replay(tx *gorm.DB, row siteRow, actor, operation, hash string) (publishing.Mutation, bool, error) {
	var previous operationRow
	err := tx.Where("site_id=? AND operation_id=?", row.ID, operation).Take(&previous).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return publishing.Mutation{}, false, nil
	}
	if err != nil {
		return publishing.Mutation{}, false, err
	}
	if previous.ActorID != actor || previous.RequestHash != hash {
		return publishing.Mutation{}, false, fault.New(fault.Conflict, "IDEMPOTENCY_CONFLICT", "操作 ID 已用于其他请求")
	}
	var result publishing.Mutation
	err = json.Unmarshal(previous.Result, &result)
	return result, true, err
}
func receipt(tx *gorm.DB, row siteRow, actor, operation, hash string, result publishing.Mutation, timestamp int64) error {
	encoded, err := json.Marshal(result)
	if err != nil {
		return err
	}
	return tx.Create(&operationRow{SiteID: row.ID, OperationID: operation, ActorID: actor, RequestHash: hash, Result: encoded, CreatedAtMS: timestamp}).Error
}
func persistSnapshot(tx *gorm.DB, row siteRow, releaseID string, built builtSnapshot, source resolvedSource, timestamp int64) (publishing.Release, error) {
	number := row.ReleaseSequence + 1
	built.preview.Snapshot.ReleaseID = &releaseID
	built.preview.Snapshot.ReleaseNumber = &number
	built.preview.Snapshot.PublishedAtMS = &timestamp
	metadata, err := json.Marshal(built.preview.Snapshot)
	if err != nil {
		return publishing.Release{}, err
	}
	manifest, err := json.Marshal(source.manifest)
	if err != nil {
		return publishing.Release{}, err
	}
	release := releaseRow{ID: releaseID, SiteID: row.ID, ReleaseNumber: number, Metadata: metadata, SourceManifest: manifest, SourceFingerprint: source.fingerprint, PublishedAtMS: timestamp}
	if err := tx.Create(&release).Error; err != nil {
		return publishing.Release{}, err
	}
	pages := make([]pageRow, 0, len(built.preview.Pages))
	bodies := map[string]bodyRow{}
	for index, page := range built.preview.Pages {
		encoded, err := json.Marshal(page.Blocks)
		if err != nil {
			return publishing.Release{}, err
		}
		digest := security.Digest("projection:1:" + string(encoded))
		bodies[digest] = bodyRow{Digest: digest, Blocks: encoded, PlainText: page.PlainText}
		metadata, err := json.Marshal(page.Metadata())
		if err != nil {
			return publishing.Release{}, err
		}
		pages = append(pages, pageRow{ReleaseID: releaseID, Slug: page.Slug, Position: index, Metadata: metadata, BodyDigest: digest})
	}
	// Global body identities are locked in digest order across independently published sites.
	digests := make([]string, 0, len(bodies))
	for digest := range bodies {
		digests = append(digests, digest)
	}
	sort.Strings(digests)
	for _, digest := range digests {
		body := bodies[digest]
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&body).Error; err != nil {
			return publishing.Release{}, err
		}
	}
	if len(pages) > 0 {
		if err := tx.CreateInBatches(pages, rowBatchSize).Error; err != nil {
			return publishing.Release{}, err
		}
	}
	for id, data := range built.tables {
		encoded, err := json.Marshal(data)
		if err != nil {
			return publishing.Release{}, err
		}
		digest := security.Digest(string(encoded))
		records := data.Records
		data.Records = []table.PublicRecord{}
		metadata, err := json.Marshal(data)
		if err != nil {
			return publishing.Release{}, err
		}
		inserted := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&publicTableRow{ID: id, Digest: digest, Metadata: metadata, Total: int64(len(records))})
		if inserted.Error != nil {
			return publishing.Release{}, inserted.Error
		}
		if inserted.RowsAffected == 1 {
			rows := make([]publicRecordRow, 0, min(len(records), rowBatchSize))
			flush := func() error {
				if len(rows) == 0 {
					return nil
				}
				err := tx.CreateInBatches(rows, rowBatchSize).Error
				rows = rows[:0]
				return err
			}
			for position, record := range records {
				values, err := json.Marshal(record.Values)
				if err != nil {
					return publishing.Release{}, err
				}
				rows = append(rows, publicRecordRow{SnapshotID: id, RecordID: record.ID, Position: position, Values: values})
				if len(rows) == rowBatchSize {
					if err := flush(); err != nil {
						return publishing.Release{}, err
					}
				}
			}
			if err := flush(); err != nil {
				return publishing.Release{}, err
			}
		} else {
			var previous publicTableRow
			if err := tx.Where("id=?", id).Take(&previous).Error; err != nil {
				return publishing.Release{}, err
			}
			if previous.Digest != digest {
				return publishing.Release{}, errors.New("published table identity collision")
			}
		}
		if err := tx.Create(&tableGrant{ReleaseID: releaseID, SnapshotID: id}).Error; err != nil {
			return publishing.Release{}, err
		}
	}
	grants := make([]assetGrant, 0, len(built.assets))
	for id, asset := range built.assets {
		grants = append(grants, assetGrant{ReleaseID: releaseID, AssetID: id, SHA256: asset.SHA256})
	}
	if len(grants) > 0 {
		if err := tx.CreateInBatches(grants, rowBatchSize).Error; err != nil {
			return publishing.Release{}, err
		}
	}
	return publishing.Release{ID: releaseID, Number: number, PublishedAtMS: timestamp, IsActive: true}, nil
}
func (r *Repository) Publish(ctx context.Context, scope publishing.Scope, input publishing.PublishInput, hash string, timestamp int64) (publishing.Mutation, error) {
	var result publishing.Mutation
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := wsstore.RequireLocked(ctx, tx, scope.WorkspaceID, scope.ActorID, workspace.Publish); err != nil {
			return err
		}
		row, err := siteFor(ctx, tx, scope, true)
		if err != nil {
			return err
		}
		previous, found, err := replay(tx, row, scope.ActorID, input.OperationID, hash)
		if err != nil {
			return err
		}
		if found {
			result = previous
			return nil
		}
		if err := checkVersion(row, input.ExpectedVersion); err != nil {
			return err
		}
		if row.ReleaseSequence >= publishing.MaxVersion {
			return fault.New(fault.Conflict, "SITE_RELEASE_EXHAUSTED", "站点发布版本号已达到上限")
		}
		site, err := row.domain()
		if err != nil {
			return err
		}
		source, err := resolve(ctx, tx, row, site.Config, true)
		if err != nil {
			return err
		}
		if source.fingerprint != input.ExpectedSourceFingerprint {
			return fault.New(fault.Conflict, "SITE_SOURCE_CONFLICT", "来源内容或配置已变化，请重新预览后发布")
		}
		if len(source.pages) == 0 {
			return fault.New(fault.Validation, "SITE_EMPTY", "请先选择至少一篇文档再发布")
		}
		built, err := r.build(ctx, tx, row, site.Config, source, false)
		if err != nil {
			return err
		}
		releaseID := uuid.NewString()
		release, err := persistSnapshot(tx, row, releaseID, built, source, timestamp)
		if err != nil {
			return err
		}
		registry, err := json.Marshal(source.registry)
		if err != nil {
			return err
		}
		row.PublishedReleaseID = &releaseID
		slug := row.Slug
		row.PublishedSlug = &slug
		row.ReleaseSequence = release.Number
		row.PageRegistry = registry
		row.Version++
		row.UpdatedAtMS = timestamp
		if err := tx.Model(&siteRow{}).Where("id=?", row.ID).Updates(map[string]any{"published_release_id": releaseID, "published_slug": row.Slug, "release_sequence": row.ReleaseSequence, "page_registry": registry, "version": row.Version, "updated_at_ms": timestamp}).Error; err != nil {
			return slugError(err)
		}
		if err := releaseSlugs(tx, row); err != nil {
			return err
		}
		result.Site, err = row.domain()
		if err != nil {
			return err
		}
		result.Release = &release
		return receipt(tx, row, scope.ActorID, input.OperationID, hash, result, timestamp)
	})
	return result, err
}
func (r *Repository) Activate(ctx context.Context, scope publishing.Scope, input publishing.ActivateInput, hash string, timestamp int64) (publishing.Mutation, error) {
	var result publishing.Mutation
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := wsstore.RequireLocked(ctx, tx, scope.WorkspaceID, scope.ActorID, workspace.Publish); err != nil {
			return err
		}
		row, err := siteFor(ctx, tx, scope, true)
		if err != nil {
			return err
		}
		previous, found, err := replay(tx, row, scope.ActorID, input.OperationID, hash)
		if err != nil {
			return err
		}
		if found {
			result = previous
			return nil
		}
		if err := checkVersion(row, input.ExpectedVersion); err != nil {
			return err
		}
		var slug *string
		if input.ReleaseID != nil {
			var release releaseRow
			if err := tx.Where("site_id=? AND id=?", row.ID, *input.ReleaseID).Take(&release).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return fault.New(fault.NotFound, "SITE_RELEASE_NOT_FOUND", "发布版本不存在")
				}
				return err
			}
			var metadata publishing.Snapshot
			if err := json.Unmarshal(release.Metadata, &metadata); err != nil {
				return err
			}
			slug = &metadata.Slug
			if err := reserveSlug(tx, row.ID, *slug); err != nil {
				return err
			}
			result.Release = &publishing.Release{ID: release.ID, Number: release.ReleaseNumber, PublishedAtMS: release.PublishedAtMS, IsActive: true}
		}
		row.PublishedReleaseID = input.ReleaseID
		row.PublishedSlug = slug
		row.Version++
		row.UpdatedAtMS = timestamp
		if err := tx.Model(&siteRow{}).Where("id=?", row.ID).Updates(map[string]any{"published_release_id": row.PublishedReleaseID, "published_slug": slug, "version": row.Version, "updated_at_ms": timestamp}).Error; err != nil {
			return slugError(err)
		}
		if err := releaseSlugs(tx, row); err != nil {
			return err
		}
		result.Site, err = row.domain()
		if err != nil {
			return err
		}
		return receipt(tx, row, scope.ActorID, input.OperationID, hash, result, timestamp)
	})
	return result, err
}
func (r *Repository) Releases(ctx context.Context, scope publishing.Scope, page pagination.Page) ([]publishing.Release, int64, error) {
	result := []publishing.Release{}
	var total int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := readAccess(ctx, tx, scope); err != nil {
			return err
		}
		site, err := siteFor(ctx, tx, scope, false)
		if err != nil {
			return err
		}
		q := tx.Model(&releaseRow{}).Where("site_id=?", site.ID)
		if err := q.Count(&total).Error; err != nil {
			return err
		}
		var rows []releaseRow
		if err := q.Select("id,release_number,published_at_ms").Order("release_number DESC").Offset(page.Offset()).Limit(page.Size).Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			result = append(result, publishing.Release{ID: row.ID, Number: row.ReleaseNumber, PublishedAtMS: row.PublishedAtMS, IsActive: site.PublishedReleaseID != nil && *site.PublishedReleaseID == row.ID})
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, total, err
}
