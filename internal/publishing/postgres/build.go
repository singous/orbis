package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	sheetstore "orbis.local/orbis/internal/sheet/postgres"
	"sort"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"orbis.local/orbis/internal/asset"
	assetstore "orbis.local/orbis/internal/asset/postgres"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/document/publicview"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/internal/publishing"
	"orbis.local/orbis/internal/table"
	tablestore "orbis.local/orbis/internal/table/postgres"
)

const assetPrefix = "orbis-asset:"
const tablePrefix = "orbis-table:"
const MaxSiteAssets = 10000

type builtSnapshot struct {
	preview       publishing.Preview
	tables        map[string]table.PublicData
	assets        map[string]asset.Record
	tableVersions map[string]int64
}

func snapshotLimit() error {
	return fault.New(fault.TooLarge, "SITE_SNAPSHOT_TOO_LARGE", "站点快照超过 32 MiB、400 个表格、100000 条表格记录或 10000 个附件限制")
}
func (r *Repository) build(ctx context.Context, tx *gorm.DB, row siteRow, config publishing.Config, source resolvedSource, preview bool) (builtSnapshot, error) {
	result := builtSnapshot{tables: map[string]table.PublicData{}, assets: map[string]asset.Record{}, tableVersions: map[string]int64{}}
	snapshot := publishing.Snapshot{Name: config.Name, Slug: config.Slug, Description: config.Description, SiteKind: config.SiteKind, AccentColor: config.AccentColor, Pages: []publishing.PageMetadata{}, Redirects: source.redirects, Branding: publishing.PublicBranding{Links: config.Branding.Links, FooterLinks: config.Branding.FooterLinks, CTA: config.Branding.CTA, Theme: config.Branding.Theme}}
	result.preview = publishing.Preview{Snapshot: snapshot, Pages: []publishing.Page{}, SourceFingerprint: source.fingerprint}
	references := map[string]string{}
	for _, page := range source.pages {
		for _, ref := range document.MediaReferences(page.Blocks) {
			if ref.Kind != "file" {
				references[ref.ID] = ref.Kind
			} else if _, exists := references[ref.ID]; !exists {
				references[ref.ID] = "file"
			}
		}
	}
	brandLinks := append(append([]publishing.Link{}, config.Branding.Links...), config.Branding.FooterLinks...)
	if config.Branding.CTA != nil {
		brandLinks = append(brandLinks, *config.Branding.CTA)
	}
	for _, link := range brandLinks {
		if id, ok := document.ParseAssetLink(link.URL); ok {
			references[id] = "file"
		}
	}
	if config.Branding.Logo != nil && config.Branding.Logo.Type == "asset" {
		references[config.Branding.Logo.AssetID] = "image"
	}
	if len(references) > MaxSiteAssets {
		return result, snapshotLimit()
	}
	ids := []string{}
	for id := range references {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	if len(ids) > 0 {
		q := tx.WithContext(ctx).Where("workspace_id=? AND id IN ? AND kind='file' AND state='ready'", row.WorkspaceID, ids).Order("id")
		if !preview {
			q = q.Clauses(clause.Locking{Strength: "SHARE"})
		}
		var records []assetstore.Record
		if err := q.Find(&records).Error; err != nil {
			return result, err
		}
		if len(records) != len(ids) {
			return result, publicview.Unsafe()
		}
		for _, record := range records {
			kind := references[record.ID]
			if kind != "file" && (!asset.InlineType(record.MediaType) || !strings.HasPrefix(record.MediaType, kind+"/")) {
				return result, publicview.Unsafe()
			}
			result.assets[record.ID] = record.Domain()
		}
	}
	policy := r.policy
	policy.DocumentLinks = map[string]string{}
	policy.PublicPrefixes = []string{"/s/", "/api/v1/public/sites/", "/public/sites/"}
	for _, page := range source.pages {
		policy.DocumentLinks[page.Metadata.DocumentID] = "/s/" + config.Slug + "/" + page.Metadata.Slug
	}
	assetURL := func(id string) (string, error) {
		if _, exists := result.assets[id]; !exists {
			return "", publicview.Unsafe()
		}
		if preview {
			return "/api/v1/workspaces/" + row.WorkspaceID + "/assets/" + id + "/content", nil
		}
		return assetPrefix + id, nil
	}
	size, rowCount := 0, 0
	for _, page := range source.pages {
		options := publicview.Options{URLs: policy, Asset: assetURL}
		options.Sheet = func(id, view string) (publicview.TableRef, error) {
			data, err := sheetstore.Snapshot(ctx, tx, row.WorkspaceID, id, view)
			if err != nil {
				return publicview.TableRef{}, err
			}
			return publicview.TableRef{ID: id, Version: sheetstore.SnapshotRevision(data), Title: data.Title, Fields: data.Fields, View: data.View, Groups: data.Groups, Items: data.Records, Total: int64(len(data.Records)), RecordsURL: ""}, nil
		}

		options.Table = func(ref table.Reference) (publicview.TableRef, error) {
			scope := table.Scope{WorkspaceID: row.WorkspaceID, DocumentID: page.Metadata.DocumentID, TableID: ref.TableID}
			header, err := tablestore.LoadHeader(ctx, tx, scope, false)
			if err != nil {
				return publicview.TableRef{}, err
			}
			if header.BlockID != ref.BlockID {
				return publicview.TableRef{}, publicview.Unsafe()
			}
			metadata, err := tablestore.Metadata(ctx, tx, header, ref.Version, page.Metadata.ContentVersion)
			if err != nil {
				return publicview.TableRef{}, err
			}
			data, err := tablestore.PublicSnapshot(ctx, tx, metadata)
			if err != nil {
				return publicview.TableRef{}, err
			}
			for _, record := range data.Records {
				for _, field := range data.Fields {
					if field.Kind == "url" {
						if value, ok := record.Values[field.ID].(string); ok && value != "" {
							rewritten, err := policy.Link(value)
							if err != nil {
								return publicview.TableRef{}, err
							}
							record.Values[field.ID] = rewritten
						}
					}
				}
			}
			encoded, err := json.Marshal(data)
			if err != nil {
				return publicview.TableRef{}, err
			}
			digest := security.Digest(string(encoded))
			id := uuid.NewSHA1(uuid.MustParse(row.ID), []byte(ref.TableID+"/"+digest)).String()
			if _, exists := result.tables[id]; !exists {
				size += len(encoded)
				rowCount += len(data.Records)
				if size > publishing.MaxSnapshotBytes || rowCount > publishing.MaxSiteRecords || len(result.tables) >= publishing.MaxSiteTables {
					return publicview.TableRef{}, snapshotLimit()
				}
				result.tables[id] = data
				result.tableVersions[id] = ref.Version
			}
			records := data.Records
			if len(records) > publicview.InitialTableRows {
				records = records[:publicview.InitialTableRows]
			}
			recordsURL := tablePrefix + id
			if preview {
				recordsURL = "/api/v1/workspaces/" + row.WorkspaceID + "/documents/" + page.Metadata.DocumentID + "/tables/" + ref.TableID + "/public-records?document_version=" + strconvInt(page.Metadata.ContentVersion)
			}
			return publicview.TableRef{Groups: data.Groups, ID: id, Version: ref.Version, Title: data.Title, Fields: data.Fields, View: data.View, Items: records, Total: int64(len(data.Records)), RecordsURL: recordsURL}, nil
		}
		blocks, err := publicview.Project(page.Blocks, options)
		if err != nil {
			return result, err
		}
		p := publishing.Page{Slug: page.Metadata.Slug, Title: page.Metadata.Title, Group: page.Metadata.Group, ParentSlug: page.Metadata.ParentSlug, Section: page.Metadata.Section, Description: page.Metadata.Description, UpdatedAtMS: page.Metadata.UpdatedAtMS, Blocks: blocks, PlainText: publicview.PlainText(blocks)}
		encoded, err := json.Marshal(p)
		if err != nil {
			return result, err
		}
		size += len(encoded)
		if size > publishing.MaxSnapshotBytes {
			return result, snapshotLimit()
		}
		result.preview.Pages = append(result.preview.Pages, p)
		result.preview.Snapshot.Pages = append(result.preview.Snapshot.Pages, p.Metadata())
	}
	linkValue := func(value string) (string, error) {
		if id, ok := document.ParseAssetLink(value); ok {
			return assetURL(id)
		}
		return policy.Link(value)
	}
	branding := &result.preview.Snapshot.Branding
	if config.Branding.Logo != nil {
		logo := config.Branding.Logo
		var value string
		var err error
		if logo.Type == "asset" {
			value, err = assetURL(logo.AssetID)
		} else {
			value, err = policy.Link(logo.URL)
		}
		if err != nil {
			return result, err
		}
		branding.LogoURL = &value
	}
	for _, links := range [][]publishing.Link{branding.Links, branding.FooterLinks} {
		for i := range links {
			value, err := linkValue(links[i].URL)
			if err != nil {
				return result, err
			}
			links[i].URL = value
		}
	}
	if branding.CTA != nil {
		value, err := linkValue(branding.CTA.URL)
		if err != nil {
			return result, err
		}
		branding.CTA.URL = value
	}
	return result, nil
}
func (r *Repository) Preview(ctx context.Context, scope publishing.Scope) (publishing.Preview, error) {
	var result publishing.Preview
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := readAccess(ctx, tx, scope); err != nil {
			return err
		}
		row, err := siteFor(ctx, tx, scope, false)
		if err != nil {
			return err
		}
		site, err := row.domain()
		if err != nil {
			return err
		}
		source, err := resolve(ctx, tx, row, site.Config, false)
		if err != nil {
			return err
		}
		built, err := r.build(ctx, tx, row, site.Config, source, true)
		if err != nil {
			return err
		}
		result = built.preview
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
