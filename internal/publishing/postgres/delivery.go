package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"gorm.io/gorm"
	"orbis.local/orbis/internal/asset"
	assetstore "orbis.local/orbis/internal/asset/postgres"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/document/publicview"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/publishing"
	"orbis.local/orbis/internal/table"
)

func active(tx *gorm.DB, q publishing.PublicQuery) (releaseRow, error) {
	var row releaseRow
	err := tx.Table("site_releases r").Select("r.*").Joins("JOIN sites s ON s.id=r.site_id AND s.published_release_id=r.id").Joins("JOIN workspaces w ON w.id=s.workspace_id AND w.is_active").Where("s.published_slug=?", q.Slug).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return row, publishing.MissingSite()
	}
	if err != nil {
		return row, err
	}
	if q.ExpectedReleaseID != nil && *q.ExpectedReleaseID != row.ID {
		return row, fault.New(fault.Conflict, "SITE_RELEASE_CHANGED", "站点发布版本已更新，请刷新后重试")
	}
	return row, nil
}
func assetURL(slug, release, id string) string {
	return "/api/v1/public/sites/" + slug + "/assets/" + id + "?release_id=" + release
}
func tableURL(slug, release, id string) string {
	return "/api/v1/public/sites/" + slug + "/tables/" + id + "/records?release_id=" + release
}
func bindBlocks(blocks []publicview.Block, slug, release string) {
	for i := range blocks {
		b := &blocks[i]

		bindRuns := func(runs []document.TextRun) {
			for i := range runs {
				if runs[i].Href != nil && strings.HasPrefix(*runs[i].Href, assetPrefix) {
					value := assetURL(slug, release, strings.TrimPrefix(*runs[i].Href, assetPrefix))
					runs[i].Href = &value
				}
			}
		}
		bindRuns(b.Content)
		if href, ok := b.Props["href"].(string); ok && strings.HasPrefix(href, assetPrefix) {
			b.Props["href"] = assetURL(slug, release, strings.TrimPrefix(href, assetPrefix))
		}
		if b.Table != nil {
			for _, row := range b.Table.Rows {
				for _, cell := range row {
					bindRuns(cell.Content)
				}
			}
		}
		if source, ok := b.Props["source"].(map[string]any); ok {
			if value, ok := source["url"].(string); ok && strings.HasPrefix(value, assetPrefix) {
				source["url"] = assetURL(slug, release, strings.TrimPrefix(value, assetPrefix))
			}
		}
		if b.DataTable != nil {
			b.DataTable.RecordsURL = tableURL(slug, release, b.DataTable.ID)
		}
		bindBlocks(b.Children, slug, release)
	}
}
func (r *Repository) Manifest(ctx context.Context, q publishing.PublicQuery) (publishing.Snapshot, error) {
	var result publishing.Snapshot
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		release, err := active(tx, q)
		if err != nil {
			return err
		}
		if err := json.Unmarshal(release.Metadata, &result); err != nil {
			return err
		}
		for _, links := range [][]publishing.Link{result.Branding.Links, result.Branding.FooterLinks} {
			for i := range links {
				if strings.HasPrefix(links[i].URL, assetPrefix) {
					links[i].URL = assetURL(q.Slug, release.ID, strings.TrimPrefix(links[i].URL, assetPrefix))
				}
			}
		}
		if result.Branding.CTA != nil && strings.HasPrefix(result.Branding.CTA.URL, assetPrefix) {
			result.Branding.CTA.URL = assetURL(q.Slug, release.ID, strings.TrimPrefix(result.Branding.CTA.URL, assetPrefix))
		}
		if result.Branding.LogoURL != nil && strings.HasPrefix(*result.Branding.LogoURL, assetPrefix) {
			value := assetURL(q.Slug, release.ID, strings.TrimPrefix(*result.Branding.LogoURL, assetPrefix))
			result.Branding.LogoURL = &value
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func (r *Repository) Page(ctx context.Context, q publishing.PublicQuery) (publishing.Page, error) {
	var result publishing.Page
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		release, err := active(tx, q)
		if err != nil {
			return err
		}
		var row struct {
			Metadata, Blocks json.RawMessage
			PlainText        string
		}
		query := tx.Table("site_release_pages p").Select("p.metadata,b.blocks,b.plain_text").Joins("JOIN published_page_bodies b ON b.digest=p.body_digest").Where("p.release_id=?", release.ID)
		if q.PageSlug != "" {
			query = query.Where("p.slug=?", q.PageSlug)
		} else {
			query = query.Order("p.position")
		}
		if err := query.Take(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return publishing.MissingPage()
			}
			return err
		}
		if err := json.Unmarshal(row.Metadata, &result); err != nil {
			return err
		}
		if err := json.Unmarshal(row.Blocks, &result.Blocks); err != nil {
			return err
		}
		result.PlainText = row.PlainText
		bindBlocks(result.Blocks, q.Slug, release.ID)
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func (r *Repository) Search(ctx context.Context, q publishing.PublicQuery, text string, page pagination.Page) (publishing.SearchResult, error) {
	result := publishing.SearchResult{Items: []publishing.SearchEntry{}}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		release, err := active(tx, q)
		if err != nil {
			return err
		}
		result.ReleaseID = release.ID
		base := tx.Table("site_release_pages p").Joins("JOIN published_page_bodies b ON b.digest=p.body_digest").Where("p.release_id=?", release.ID)
		if text != "" {
			base = base.Where("strpos(lower(p.metadata->>'title'),lower(?))>0 OR strpos(lower(b.plain_text),lower(?))>0", text, text)
		}
		if err := base.Count(&result.Total).Error; err != nil {
			return err
		}
		return base.Select("p.slug,p.metadata->>'title' AS title,substring(b.plain_text FROM greatest(1,strpos(lower(b.plain_text),lower(?))-64) FOR 240) AS plain_text", text).Order("p.position").Offset(page.Offset()).Limit(page.Size).Scan(&result.Items).Error
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func authorizedTable(tx *gorm.DB, release, id string) (publicTableRow, error) {
	var row publicTableRow
	err := tx.Table("published_table_snapshots t").Select("t.*").Joins("JOIN site_release_tables g ON g.snapshot_id=t.id").Where("g.release_id=? AND t.id=?", release, id).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return row, publishing.MissingPage()
	}
	return row, err
}
func publicRows(tx *gorm.DB, tableID string, page *pagination.Page) ([]table.PublicRecord, error) {
	result := []table.PublicRecord{}
	q := tx.Where("snapshot_id=?", tableID).Order("position")
	if page != nil {
		q = q.Offset(page.Offset()).Limit(page.Size)
	}
	var rows []publicRecordRow
	if err := q.Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		var values map[string]any
		if err := json.Unmarshal(row.Values, &values); err != nil {
			return nil, err
		}
		result = append(result, table.PublicRecord{ID: row.RecordID, Values: values})
	}
	return result, nil
}
func (r *Repository) Table(ctx context.Context, q publishing.TableQuery) (publishing.TablePage, error) {
	var result publishing.TablePage
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		release, err := active(tx, q.PublicQuery)
		if err != nil {
			return err
		}
		row, err := authorizedTable(tx, release.ID, q.TableID)
		if err != nil {
			return err
		}
		var metadata table.PublicData
		if err := json.Unmarshal(row.Metadata, &metadata); err != nil {
			return err
		}
		items, err := publicRows(tx, q.TableID, &q.Page)
		if err != nil {
			return err
		}
		result = publishing.TablePage{Groups: metadata.Groups, ReleaseID: release.ID, TableID: q.TableID, Title: metadata.Title, Fields: metadata.Fields, View: metadata.View, Items: items, Total: row.Total}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func (r *Repository) Asset(ctx context.Context, q publishing.PublicQuery, id string) (asset.Record, error) {
	var result asset.Record
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		release, err := active(tx, q)
		if err != nil {
			return err
		}
		var record assetstore.Record
		err = tx.Table("assets a").Select("a.*").Joins("JOIN site_release_assets g ON g.asset_id=a.id AND g.sha256=a.sha256").Where("g.release_id=? AND a.id=? AND a.kind='file' AND a.state='ready'", release.ID, id).Take(&record).Error
		if err == nil {
			result = record.Domain()
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var copy struct {
			ID, SHA256, StorageKey, Filename, MediaType string
			SizeBytes, CreatedAtMS                      int64
		}
		err = tx.Table("published_asset_copies a").Select("a.*").Joins("JOIN site_release_asset_copies g ON g.asset_id=a.id").Where("g.release_id=? AND a.id=?", release.ID, id).Take(&copy).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return publishing.MissingPage()
		}
		if err != nil {
			return err
		}
		result = asset.Record{ID: copy.ID, Kind: "publication", State: "ready", StorageKey: copy.StorageKey, Filename: copy.Filename, MediaType: copy.MediaType, SHA256: copy.SHA256, SizeBytes: copy.SizeBytes, CreatedAtMS: copy.CreatedAtMS, UpdatedAtMS: copy.CreatedAtMS}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func (r *Repository) HydrateTables(ctx context.Context, q publishing.PublicQuery, blocks []publicview.Block) ([]publicview.Block, error) {
	encoded, err := json.Marshal(blocks)
	if err != nil {
		return nil, err
	}
	var result []publicview.Block
	if err := json.Unmarshal(encoded, &result); err != nil {
		return nil, err
	}
	err = r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		release, err := active(tx, q)
		if err != nil {
			return err
		}
		var hydrate func([]publicview.Block) error
		count := 0
		size := 0
		hydrate = func(items []publicview.Block) error {
			for i := range items {
				b := &items[i]
				if b.DataTable != nil {
					row, err := authorizedTable(tx, release.ID, b.DataTable.ID)
					if err != nil {
						return err
					}
					count += int(row.Total)
					if count > publishing.MaxSiteRecords {
						return snapshotLimit()
					}
					records, err := publicRows(tx, row.ID, nil)
					if err != nil {
						return err
					}
					encoded, err := json.Marshal(records)
					if err != nil {
						return err
					}
					size += len(encoded)
					if size > publishing.MaxSnapshotBytes {
						return snapshotLimit()
					}
					b.DataTable.Items = records
				}
				if err := hydrate(b.Children); err != nil {
					return err
				}
			}
			return nil
		}
		return hydrate(result)
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}

func (r *Repository) AssetByDigest(ctx context.Context, q publishing.PublicQuery, digest string) (asset.Record, error) {
	var result asset.Record
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		release, err := active(tx, q)
		if err != nil {
			return err
		}
		var row struct {
			ID, SHA256, StorageKey, Filename, MediaType string
			SizeBytes, CreatedAtMS                      int64
		}
		err = tx.Table("published_asset_copies a").Select("a.*").Joins("JOIN site_release_asset_copies g ON g.asset_id=a.id").Where("g.release_id=? AND a.sha256=?", release.ID, digest).Order("a.id").Take(&row).Error
		if err == nil {
			result = asset.Record{ID: row.ID, Kind: "publication", State: "ready", StorageKey: row.StorageKey, Filename: row.Filename, MediaType: row.MediaType, SHA256: row.SHA256, SizeBytes: row.SizeBytes, CreatedAtMS: row.CreatedAtMS, UpdatedAtMS: row.CreatedAtMS}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var original assetstore.Record
		err = tx.Table("assets a").Select("a.*").Joins("JOIN site_release_assets g ON g.asset_id=a.id AND g.sha256=a.sha256").Where("g.release_id=? AND a.sha256=? AND a.kind='file' AND a.state='ready'", release.ID, digest).Order("a.id").Take(&original).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return publishing.MissingPage()
		}
		if err != nil {
			return err
		}
		result = original.Domain()
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
