package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sort"
	"strconv"
	"strings"

	"gorm.io/gorm"
	"orbis.local/orbis/internal/document"
	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/internal/publishing"
)

type selectedDocument struct {
	ID, CollectionID, Title     string
	ParentID                    *string
	ContentVersion, UpdatedAtMS int64
}
type manifestEntry struct {
	Position int                   `json:"position"`
	Page     publishing.PageSource `json:"page"`
	Digest   string                `json:"digest"`
}
type resolvedSource struct {
	pages       []publishing.DocumentSource
	registry    publishing.Registry
	redirects   map[string]string
	manifest    []manifestEntry
	fingerprint string
	excluded    int64
}

func sourceInvalid() error {
	return fault.New(fault.Validation, "SITE_SOURCE_INVALID", "来源文档、文集或祖先不可用，请检查工作空间与归档状态")
}
func tooManyPages() error {
	return fault.New(fault.Validation, "SITE_TOO_MANY_PAGES", "来源超过 200 篇文档，请缩小范围或排除子树")
}

const visibleSQL = `WITH RECURSIVE visible AS (
    SELECT d.id,d.collection_id,d.parent_id,d.title,d.content_version,d.updated_at_ms,
       ARRAY[d.position] AS path,ARRAY[d.id] AS ancestors,
       jsonb_exists(CAST(@exclusions AS jsonb),d.id::text) AS excluded
    FROM documents d JOIN collections c ON c.id=d.collection_id AND c.workspace_id=d.workspace_id
    JOIN collection_groups g ON g.id=c.group_id AND g.workspace_id=c.workspace_id
    WHERE d.workspace_id=@workspace AND d.collection_id IN @collections AND d.parent_id IS NULL
      AND d.is_archived = FALSE AND c.is_archived = FALSE AND g.is_archived = FALSE
    UNION ALL
    SELECT d.id,d.collection_id,d.parent_id,d.title,d.content_version,d.updated_at_ms,
      v.path || d.position,v.ancestors || d.id,
      v.excluded OR jsonb_exists(CAST(@exclusions AS jsonb),d.id::text)
    FROM documents d JOIN visible v ON d.parent_id=v.id AND d.collection_id=v.collection_id
    WHERE d.workspace_id=@workspace AND d.is_archived = FALSE AND cardinality(v.ancestors)<@depth
) `

func resolve(ctx context.Context, tx *gorm.DB, row siteRow, config publishing.Config, lock bool) (resolvedSource, error) {
	result := resolvedSource{pages: []publishing.DocumentSource{}, manifest: []manifestEntry{}}
	collections := map[string]bool{}
	if config.Source.Kind == "manual" && len(config.Navigation) > 0 {
		ids := []string{}
		for _, item := range config.Navigation {
			ids = append(ids, item.DocumentID)
		}
		var docs []selectedDocument
		if err := tx.WithContext(ctx).Table("documents").Select("id,collection_id").Where("workspace_id=? AND id IN ?", row.WorkspaceID, ids).Scan(&docs).Error; err != nil {
			return result, err
		}
		if len(docs) != len(ids) {
			return result, sourceInvalid()
		}
		for _, doc := range docs {
			collections[doc.CollectionID] = true
		}
	} else {
		for _, binding := range config.Source.Collections {
			collections[binding.CollectionID] = true
		}
	}
	collectionIDs := []string{}
	for id := range collections {
		collectionIDs = append(collectionIDs, id)
	}
	sort.Strings(collectionIDs)
	collectionTitles := map[string]string{}
	for _, id := range collectionIDs {
		scope := document.DirectoryScope{WorkspaceID: row.WorkspaceID, CollectionID: id}
		var collection document.Collection
		var err error
		if lock {
			collection, err = docstore.LockSnapshotCollection(ctx, tx, scope)
		} else {
			collection, err = docstore.ReadSnapshotCollection(ctx, tx, scope)
			if err == nil && collection.IsArchived {
				err = sourceInvalid()
			}
		}
		if err != nil {
			var business *fault.Error
			if errors.As(err, &business) && business.Kind == fault.NotFound {
				return result, sourceInvalid()
			}
			return result, err
		}
		collectionTitles[id] = collection.Title
	}
	exclusions := map[string]bool{}
	for _, id := range config.Source.ExcludedDocumentIDs {
		exclusions[id] = true
	}
	exclusionBytes, _ := json.Marshal(exclusions)
	args := []any{sql.Named("workspace", row.WorkspaceID), sql.Named("collections", collectionIDs), sql.Named("exclusions", string(exclusionBytes)), sql.Named("depth", document.MaxDirectoryDepth)}
	metadata := []publishing.PageSource{}
	selected := map[string]selectedDocument{}
	parentIDs := map[string]*string{}
	autoTitle := map[string]bool{}
	if config.Source.Kind == "manual" && len(config.Navigation) > 0 {
		args = append(args, sql.Named("ids", func() []string {
			ids := []string{}
			for _, n := range config.Navigation {
				ids = append(ids, n.DocumentID)
			}
			return ids
		}()))
		var docs []selectedDocument
		if err := tx.WithContext(ctx).Raw(visibleSQL+"SELECT * FROM visible WHERE id IN @ids", args...).Scan(&docs).Error; err != nil {
			return result, err
		}
		if len(docs) != len(config.Navigation) {
			return result, sourceInvalid()
		}
		byID := map[string]selectedDocument{}
		for _, doc := range docs {
			byID[doc.ID] = doc
		}
		for _, entry := range config.Navigation {
			doc := byID[entry.DocumentID]
			selected[doc.ID] = doc
			metadata = append(metadata, publishing.PageSource{DocumentID: doc.ID, Slug: entry.Slug, Title: entry.Title, Group: entry.Group, UpdatedAtMS: &doc.UpdatedAtMS, ContentVersion: doc.ContentVersion})
		}
	} else if config.Source.Kind == "collections" {
		labelOwners := map[string]string{}
		labels := map[string]string{}
		statConditions := []string{}
		statArgs := append([]any{}, args...)
		for bindingIndex, binding := range config.Source.Collections {
			original := collectionTitles[binding.CollectionID]
			if binding.Label != nil {
				original = *binding.Label
			}
			key := binding.CollectionID + "/" + original
			label := labels[key]
			if label == "" {
				label = original
				for suffix := 2; labelOwners[label] != "" && labelOwners[label] != key; suffix++ {
					label = original + " (" + strconv.Itoa(suffix) + ")"
				}
				labels[key] = label
				labelOwners[label] = key
			}
			condition := "collection_id=@collection AND (CAST(@root AS uuid) IS NULL OR CAST(@root AS uuid)=ANY(ancestors))"
			boundArgs := append(append([]any{}, args...), sql.Named("collection", binding.CollectionID), sql.Named("root", binding.RootDocumentID), sql.Named("limit", publishing.MaxPages+len(selected)+1))
			if binding.RootDocumentID != nil {
				var count int64
				if err := tx.WithContext(ctx).Raw(visibleSQL+"SELECT count(*) FROM visible WHERE collection_id=@collection AND id=CAST(@root AS uuid)", boundArgs...).Scan(&count).Error; err != nil {
					return result, err
				}
				if count != 1 {
					return result, sourceInvalid()
				}
			}
			suffix := strconv.Itoa(bindingIndex)
			statConditions = append(statConditions, "(collection_id=@collection"+suffix+" AND (CAST(@root"+suffix+" AS uuid) IS NULL OR CAST(@root"+suffix+" AS uuid)=ANY(ancestors)))")
			statArgs = append(statArgs, sql.Named("collection"+suffix, binding.CollectionID), sql.Named("root"+suffix, binding.RootDocumentID))
			var docs []selectedDocument
			if err := tx.WithContext(ctx).Raw(visibleSQL+"SELECT * FROM visible WHERE "+condition+" AND NOT excluded ORDER BY path,id LIMIT @limit", boundArgs...).Scan(&docs).Error; err != nil {
				return result, err
			}
			for _, doc := range docs {
				if _, exists := selected[doc.ID]; exists {
					continue
				}
				selected[doc.ID] = doc
				parentIDs[doc.ID] = doc.ParentID
				autoTitle[doc.ID] = true
				section := label
				metadata = append(metadata, publishing.PageSource{DocumentID: doc.ID, Title: doc.Title, Group: &section, Section: &section, UpdatedAtMS: &doc.UpdatedAtMS, ContentVersion: doc.ContentVersion})
				if len(metadata) > publishing.MaxPages {
					return result, tooManyPages()
				}
			}
		}
		if len(statConditions) > 0 {
			if err := tx.WithContext(ctx).Raw(visibleSQL+"SELECT count(*) FROM visible WHERE excluded AND ("+strings.Join(statConditions, " OR ")+")", statArgs...).Scan(&result.excluded).Error; err != nil {
				return result, err
			}
		}
	}
	ids := []string{}
	for id := range selected {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	contents, err := docstore.ReadSnapshotBatch(ctx, tx, row.WorkspaceID, ids, publishing.MaxSnapshotBytes, lock)
	if err != nil {
		return result, err
	}
	overrides := map[string]publishing.Override{}
	for _, override := range config.Source.PageOverrides {
		overrides[override.DocumentID] = override
	}
	for i := range metadata {
		page := &metadata[i]
		content := contents[page.DocumentID]
		page.ContentVersion = content.Revision.Version
		if page.UpdatedAtMS == nil || *page.UpdatedAtMS < content.Revision.CreatedAtMS {
			timestamp := content.Revision.CreatedAtMS
			page.UpdatedAtMS = &timestamp
		}
		if autoTitle[page.DocumentID] {
			page.Title = content.Revision.Title
			if override, ok := overrides[page.DocumentID]; ok {
				if override.Title != nil {
					page.Title = *override.Title
				}
				if override.Slug != nil {
					page.Slug = *override.Slug
				}
				if override.Description != nil {
					page.Description = *override.Description
				}
			}
		}
	}
	registry := publishing.Registry{}
	if err := json.Unmarshal(row.PageRegistry, &registry); err != nil {
		return result, err
	}
	metadata, result.registry, result.redirects, err = publishing.AssignPaths(registry, metadata, config.Source.Kind == "manual")
	if err != nil {
		return result, err
	}
	byID := map[string]publishing.PageSource{}
	for _, page := range metadata {
		byID[page.DocumentID] = page
	}
	for position, page := range metadata {
		if parentID := parentIDs[page.DocumentID]; parentID != nil {
			if parent, ok := byID[*parentID]; ok && parent.Section != nil && page.Section != nil && *parent.Section == *page.Section {
				slug := parent.Slug
				page.ParentSlug = &slug
			}
		}
		content := contents[page.DocumentID]
		encoded, err := json.Marshal(content.Blocks)
		if err != nil {
			return result, err
		}
		result.manifest = append(result.manifest, manifestEntry{Position: position, Page: page, Digest: security.Digest(string(encoded))})
		result.pages = append(result.pages, publishing.DocumentSource{Metadata: page, Blocks: content.Blocks})
	}
	encoded, err := json.Marshal(struct {
		Config   publishing.Config
		Version  int64
		Manifest []manifestEntry
	}{config, row.Version, result.manifest})
	if err != nil {
		return result, err
	}
	result.fingerprint = security.Digest(string(encoded))
	return result, nil
}
func changes(current []manifestEntry, previous []manifestEntry) publishing.Changes {
	result := publishing.Changes{Added: []publishing.PageSource{}, Modified: []publishing.PageSource{}, Removed: []publishing.PageSource{}}
	before := map[string]manifestEntry{}
	for _, item := range previous {
		before[item.Page.DocumentID] = item
	}
	for _, item := range current {
		old, exists := before[item.Page.DocumentID]
		delete(before, item.Page.DocumentID)
		if !exists {
			result.Added = append(result.Added, item.Page)
		} else {
			left, _ := json.Marshal(old)
			right, _ := json.Marshal(item)
			if string(left) != string(right) {
				result.Modified = append(result.Modified, item.Page)
			}
		}
	}
	for _, item := range previous {
		if _, exists := before[item.Page.DocumentID]; exists {
			result.Removed = append(result.Removed, item.Page)
		}
	}
	return result
}
func (r *Repository) Sources(ctx context.Context, scope publishing.Scope) (publishing.Sources, error) {
	var result publishing.Sources
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
		resolved, err := resolve(ctx, tx, row, site.Config, false)
		if err != nil {
			return err
		}
		old := []manifestEntry{}
		if row.PublishedReleaseID != nil {
			var release releaseRow
			if err := tx.Where("site_id=? AND id=?", row.ID, *row.PublishedReleaseID).Take(&release).Error; err != nil {
				return err
			}
			if err := json.Unmarshal(release.SourceManifest, &old); err != nil {
				return err
			}
		}
		pages := []publishing.PageSource{}
		for _, page := range resolved.pages {
			pages = append(pages, page.Metadata)
		}
		result = publishing.Sources{Pages: pages, ExcludedCount: resolved.excluded, SourceFingerprint: resolved.fingerprint, Changes: changes(resolved.manifest, old)}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
