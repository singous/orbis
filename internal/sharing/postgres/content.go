package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/url"
	"strconv"
	"strings"

	"gorm.io/gorm"
	"orbis.local/orbis/internal/asset"
	assetstore "orbis.local/orbis/internal/asset/postgres"
	"orbis.local/orbis/internal/board"
	"orbis.local/orbis/internal/document"
	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/internal/document/publicview"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/sharing"
	sheetstore "orbis.local/orbis/internal/sheet/postgres"
	"orbis.local/orbis/internal/table"
	tablestore "orbis.local/orbis/internal/table/postgres"
)

func contentLimit() error {
	return fault.New(fault.TooLarge, "SHARE_CONTENT_TOO_LARGE", "分享正文超出读取预算，请使用更小的块分页")
}
func documentReference(value string) string {
	parsed, err := url.Parse(value)
	if err != nil {
		return ""
	}
	path := parsed.Path
	for range 3 {
		decoded, err := url.PathUnescape(path)
		if err != nil {
			break
		}
		if decoded == path {
			break
		}
		path = decoded
	}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 2 {
		return ""
	}
	if parts[len(parts)-2] != "documents" && parts[len(parts)-2] != "notes" {
		return ""
	}
	id := parts[len(parts)-1]
	if table.ValidID(id) {
		return id
	}
	return ""
}
func linkValues(blocks []document.Block) []string {
	values := []string{}
	var visit func([]document.Block)
	visit = func(items []document.Block) {
		for _, b := range items {
			for _, run := range b.Content {
				if run.Href != nil {
					values = append(values, *run.Href)
				}
			}
			if href, ok := b.Props["href"].(string); ok {
				values = append(values, href)
			}
			if b.Table != nil {
				for _, row := range b.Table.Rows {
					for _, cell := range row {
						for _, run := range cell.Content {
							if run.Href != nil {
								values = append(values, *run.Href)
							}
						}
					}
				}
			}
			visit(b.Children)
		}
	}
	visit(blocks)
	return values
}
func addDocumentLinks(ctx context.Context, tx *gorm.DB, scope scopeState, token string, values []string, links map[string]string) error {
	ids := map[string]bool{}
	for _, value := range values {
		if id := documentReference(value); id != "" {
			ids[id] = true
		}
	}
	if len(ids) == 0 {
		return nil
	}
	encoded, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	args := append(scope.treeArgs(), sql.Named("identities", string(encoded)))
	var selected []struct{ ID string }
	if err := tx.WithContext(ctx).Raw(treeSQL+"SELECT id FROM tree WHERE jsonb_exists(CAST(@identities AS JSONB),id::text)", args...).Scan(&selected).Error; err != nil {
		return err
	}
	for _, row := range selected {
		links[row.ID] = "/share/" + token + "/" + row.ID
	}
	return nil
}
func (r *Repository) policyFor(ctx context.Context, tx *gorm.DB, scope scopeState, input sharing.PublicQuery, blocks []document.Block) (publicview.URLPolicy, error) {
	policy := r.policy
	policy.DocumentLinks = map[string]string{}
	policy.PublicPrefixes = []string{"/s/", "/api/v1/public/sites/", "/share/" + input.Token + "/"}
	err := addDocumentLinks(ctx, tx, scope, input.Token, linkValues(blocks), policy.DocumentLinks)
	return policy, err
}
func tableMetadata(ctx context.Context, tx *gorm.DB, scope scopeState, doc document.Document, id string) (table.Metadata, error) {
	tableScope := table.Scope{WorkspaceID: scope.share.WorkspaceID, DocumentID: doc.ID, TableID: id}
	header, err := tablestore.LoadHeader(ctx, tx, tableScope, false)
	if err != nil {
		return table.Metadata{}, scopeError(err)
	}
	payload, err := docstore.BlockAt(ctx, tx, document.DirectoryScope{WorkspaceID: scope.share.WorkspaceID, DocumentID: doc.ID}, doc.ContentVersion, header.BlockID)
	if err != nil {
		return table.Metadata{}, scopeError(err)
	}
	ref, ok := document.TableReference(header.BlockID, payload)
	if !ok || ref.TableID != id {
		return table.Metadata{}, sharing.Missing()
	}
	metadata, err := tablestore.Metadata(ctx, tx, header, ref.Version, doc.ContentVersion)
	return metadata, scopeError(err)
}
func tablePage(ctx context.Context, tx *gorm.DB, scope scopeState, doc document.Document, input sharing.PublicQuery, metadata table.Metadata, policy publicview.URLPolicy) (table.PublicPage, error) {
	projected, err := tablestore.PublicRecords(ctx, tx, metadata, table.Query{Page: input.Page})
	if err != nil {
		return projected, err
	}
	urls := []string{}
	for _, record := range projected.Data.Records {
		for _, field := range projected.Data.Fields {
			if field.Kind == "url" {
				if value, ok := record.Values[field.ID].(string); ok {
					urls = append(urls, value)
				}
			}
		}
	}
	if err := addDocumentLinks(ctx, tx, scope, input.Token, urls, policy.DocumentLinks); err != nil {
		return projected, err
	}
	for _, record := range projected.Data.Records {
		for _, field := range projected.Data.Fields {
			if field.Kind == "url" {
				if value, ok := record.Values[field.ID].(string); ok && value != "" {
					value, err := policy.Link(value)
					if err != nil {
						record.Values[field.ID] = nil
					} else {
						record.Values[field.ID] = value
					}
				}
			}
		}
	}
	return projected, nil
}
func (r *Repository) project(ctx context.Context, tx *gorm.DB, scope scopeState, doc document.Document, input sharing.PublicQuery, blocks []document.Block) ([]publicview.Block, error) {
	policy, err := r.policyFor(ctx, tx, scope, input, blocks)
	if err != nil {
		return nil, err
	}
	references := document.MediaReferences(blocks)
	boardAllowed := map[string]bool{}
	if r.boards != nil {
		for _, ref := range document.BoardReferences(blocks) {
			var count int64
			if err := tx.WithContext(ctx).Table("boards").Where("id=? AND workspace_id=? AND document_id=?", ref.ID, scope.share.WorkspaceID, doc.ID).Count(&count).Error; err != nil {
				return nil, err
			}
			if count != 1 {
				continue
			}
			boardAllowed[ref.ID] = true
			snapshot, err := r.boards.Read(ctx, tx, scope.share.WorkspaceID, ref)
			if err != nil {
				return nil, err
			}
			for _, element := range snapshot.Elements {
				if element.Structure.AssetID != nil {
					references = append(references, document.AssetReference{ID: *element.Structure.AssetID, Kind: "image"})
				}
			}
		}
	}
	ids := []string{}
	seen := map[string]bool{}
	for _, ref := range references {
		if !seen[ref.ID] {
			ids = append(ids, ref.ID)
			seen[ref.ID] = true
		}
	}
	types := map[string]string{}
	if len(ids) > 0 {
		var files []assetstore.Record
		if err := tx.WithContext(ctx).Where("workspace_id=? AND kind='file' AND state='ready' AND id IN ?", scope.share.WorkspaceID, ids).Find(&files).Error; err != nil {
			return nil, err
		}
		for _, file := range files {
			types[file.ID] = file.MediaType
		}
	}
	for _, ref := range references {
		media, exists := types[ref.ID]
		if !exists || (ref.Kind != "file" && (!asset.InlineType(media) || !strings.HasPrefix(media, ref.Kind+"/"))) {
			return nil, sharing.Missing()
		}
	}
	options := publicview.Options{URLs: policy, RedactUnsafeLinks: true, MaxBytes: sharing.MaxPageBytes, BudgetError: contentLimit()}
	// Only tables owned by this authorized document inherit its public projection.
	options.Sheet = func(id, view string) (publicview.TableRef, error) {
		var count int64
		if err := tx.WithContext(ctx).Table("sheets").Where("id=? AND document_id=? AND workspace_id=?", id, doc.ID, scope.share.WorkspaceID).Count(&count).Error; err != nil {
			return publicview.TableRef{}, err
		}
		if count == 1 {
			data, err := sheetstore.Snapshot(ctx, tx, scope.share.WorkspaceID, id, view)
			if err != nil {
				return publicview.TableRef{}, err
			}
			return publicview.TableRef{ID: id, Version: sheetstore.SnapshotRevision(data), Title: data.Title, Fields: data.Fields, View: data.View, Groups: data.Groups, Items: data.Records}, nil
		}
		return publicview.TableRef{Restricted: true, ID: id, Version: 1, Title: "数据表", Fields: []table.Field{}, View: table.PublicView{Name: "需要工作空间访问权限", Kind: "grid", Widths: map[string]int{}}, Groups: []table.Group{}, Items: []table.PublicRecord{}}, nil
	}

	options.Asset = func(id string) (string, error) {
		if _, exists := types[id]; !exists {
			return "", sharing.Missing()
		}
		return "/api/v1/public/shares/" + input.Token + "/documents/" + doc.ID + "/assets/" + id + "?version=" + versionString(doc.ContentVersion), nil
	}
	options.Board = func(ref document.BoardReference) (board.View, error) {
		if !boardAllowed[ref.ID] || r.boards == nil {
			return board.View{Title: "画板", Restricted: true}, nil
		}
		return r.boards.Project(ctx, tx, scope.share.WorkspaceID, ref, options.Asset)
	}
	options.Table = func(ref table.Reference) (publicview.TableRef, error) {
		metadata, err := tableMetadata(ctx, tx, scope, doc, ref.TableID)
		if err != nil {
			return publicview.TableRef{}, err
		}
		if metadata.BlockID != ref.BlockID || metadata.TableVersion != ref.Version {
			return publicview.TableRef{}, sharing.Missing()
		}
		pageInput := input
		pageInput.Page = pagination.Page{Number: 1, Size: publicview.InitialTableRows}
		page, err := tablePage(ctx, tx, scope, doc, pageInput, metadata, policy)
		if err != nil {
			return publicview.TableRef{}, err
		}
		return publicview.TableRef{ID: ref.TableID, Version: ref.Version, Title: page.Data.Title, Fields: page.Data.Fields, View: page.Data.View, Groups: page.Data.Groups, Items: page.Data.Records, Total: page.Total, RecordsURL: "/api/v1/public/shares/" + input.Token + "/documents/" + doc.ID + "/tables/" + ref.TableID + "/records?version=" + versionString(doc.ContentVersion)}, nil
	}
	return publicview.Project(blocks, options)
}
func (r *Repository) Content(ctx context.Context, input sharing.PublicQuery) (sharing.Content, error) {
	var result sharing.Content
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		scope, err := r.resolve(ctx, tx, input)
		if err != nil {
			return err
		}
		doc, err := scope.doc(ctx, tx, input.DocumentID, input.Version)
		if err != nil {
			return err
		}
		_, records, err := docstore.New(tx).Read(ctx, scope.share.WorkspaceID, doc.ID, doc.ContentVersion)
		if err != nil {
			return scopeError(err)
		}
		blocks, err := document.Expand(records)
		if err != nil {
			return err
		}
		projected, err := r.project(ctx, tx, scope, doc, input, blocks)
		if err != nil {
			return err
		}
		result = sharing.Content{Document: publicDocument(doc), Blocks: projected}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func (r *Repository) Blocks(ctx context.Context, input sharing.PublicQuery) (sharing.BlockPage, error) {
	result := sharing.BlockPage{Items: []sharing.Block{}}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		scope, err := r.resolve(ctx, tx, input)
		if err != nil {
			return err
		}
		doc, err := scope.doc(ctx, tx, input.DocumentID, input.Version)
		if err != nil {
			return err
		}
		records, err := docstore.New(tx).BlockPage(ctx, scope.share.WorkspaceID, doc.ID, doc.ContentVersion, input.After, input.Limit+1)
		if err != nil {
			return scopeError(err)
		}
		result.HasMore = len(records) > input.Limit
		if result.HasMore {
			records = records[:input.Limit]
		}
		blocks := make([]document.Block, 0, len(records))
		for _, record := range records {
			var payload document.Payload
			if err := json.Unmarshal(record.Payload, &payload); err != nil {
				return err
			}
			blocks = append(blocks, document.Block{ID: record.ID, Type: payload.Type, Props: payload.Props, Content: payload.Content, Table: payload.Table, Children: []document.Block{}})
		}
		projected, err := r.project(ctx, tx, scope, doc, input, blocks)
		if err != nil {
			return err
		}
		for i, record := range records {
			result.Items = append(result.Items, sharing.Block{ID: record.ID, ParentID: record.ParentID, Position: record.Position, Block: projected[i]})
		}
		result.Document = publicDocument(doc)
		result.ShareID = scope.share.ID
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func (r *Repository) Block(ctx context.Context, input sharing.PublicQuery) (sharing.Block, error) {
	var result sharing.Block
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		scope, err := r.resolve(ctx, tx, input)
		if err != nil {
			return err
		}
		doc, err := scope.doc(ctx, tx, input.DocumentID, input.Version)
		if err != nil {
			return err
		}
		var row struct {
			BlockID  string
			ParentID *string
			Position int
			Payload  json.RawMessage
		}
		if err := tx.Table("document_block_versions").Select("block_id,parent_id,position,payload").Where("document_id=? AND block_id=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>?)", doc.ID, input.BlockID, doc.ContentVersion, doc.ContentVersion).Take(&row).Error; err != nil {
			return scopeError(err)
		}
		var payload document.Payload
		if err := json.Unmarshal(row.Payload, &payload); err != nil {
			return err
		}
		projected, err := r.project(ctx, tx, scope, doc, input, []document.Block{{ID: row.BlockID, Type: payload.Type, Props: payload.Props, Content: payload.Content, Table: payload.Table, Children: []document.Block{}}})
		if err != nil {
			return err
		}
		result = sharing.Block{ID: row.BlockID, ParentID: row.ParentID, Position: row.Position, Block: projected[0]}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func (r *Repository) Table(ctx context.Context, input sharing.PublicQuery) (sharing.PublicTablePage, error) {
	var result sharing.PublicTablePage
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		scope, err := r.resolve(ctx, tx, input)
		if err != nil {
			return err
		}
		doc, err := scope.doc(ctx, tx, input.DocumentID, input.Version)
		if err != nil {
			return err
		}
		metadata, err := tableMetadata(ctx, tx, scope, doc, input.TableID)
		if err != nil {
			return err
		}
		policy, err := r.policyFor(ctx, tx, scope, input, nil)
		if err != nil {
			return err
		}
		page, err := tablePage(ctx, tx, scope, doc, input, metadata, policy)
		if err != nil {
			return err
		}
		result = sharing.PublicTablePage{Document: publicDocument(doc), Title: page.Data.Title, Fields: page.Data.Fields, View: page.Data.View, Groups: page.Data.Groups, Items: page.Data.Records, Total: page.Total}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func (r *Repository) Asset(ctx context.Context, input sharing.PublicQuery) (asset.Record, error) {
	var result asset.Record
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		scope, err := r.resolve(ctx, tx, input)
		if err != nil {
			return err
		}
		doc, err := scope.doc(ctx, tx, input.DocumentID, input.Version)
		if err != nil {
			return err
		}
		referenced, err := docstore.ReferencesAsset(ctx, tx, doc.ID, doc.ContentVersion, input.AssetID)
		if err != nil {
			return err
		}
		if !referenced {
			if r.boards == nil {
				return sharing.Missing()
			}
			var rows []struct{ Payload json.RawMessage }
			if err := tx.WithContext(ctx).Table("document_block_versions").Select("payload").Where("document_id=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>?) AND payload->>'type'='board'", doc.ID, doc.ContentVersion, doc.ContentVersion).Limit(document.MaxBlocks).Find(&rows).Error; err != nil {
				return err
			}
			for _, row := range rows {
				var block document.Block
				if err := json.Unmarshal(row.Payload, &block); err != nil {
					return err
				}
				for _, ref := range document.BoardReferences([]document.Block{block}) {
					var count int64
					if err := tx.Table("boards").Where("workspace_id=? AND id=? AND document_id=?", scope.share.WorkspaceID, ref.ID, doc.ID).Count(&count).Error; err != nil {
						return err
					}
					if count != 1 {
						continue
					}
					snapshot, err := r.boards.Read(ctx, tx, scope.share.WorkspaceID, ref)
					if err != nil {
						return err
					}
					for _, element := range snapshot.Elements {
						if element.Structure.AssetID != nil && *element.Structure.AssetID == input.AssetID {
							referenced = true
							break
						}
					}
					if referenced {
						break
					}
				}
				if referenced {
					break
				}
			}
			if !referenced {
				return sharing.Missing()
			}
		}
		var row assetstore.Record
		if err := tx.Where("id=? AND workspace_id=? AND kind='file' AND state='ready'", input.AssetID, scope.share.WorkspaceID).Take(&row).Error; err != nil {
			return scopeError(err)
		}
		result = row.Domain()
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}

func versionString(value int64) string { return strconv.FormatInt(value, 10) }
