package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/document/markdown"
	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/internal/integration"
	itstore "orbis.local/orbis/internal/integration/postgres"
	"orbis.local/orbis/internal/platform/fault"
)

func allowedSnapshots(tx *gorm.DB, p integration.Principal) *gorm.DB {
	conditions := []string{"TRUE"}
	args := []any{sql.Named("workspace", p.Token.WorkspaceID), sql.Named("depth", document.MaxDirectoryDepth)}
	if p.Token.CollectionID != nil {
		conditions = append(conditions, "v.collection_id=CAST(@collection AS UUID)")
		args = append(args, sql.Named("collection", *p.Token.CollectionID))
	}
	if p.Token.DocumentID != nil {
		conditions = append(conditions, "v.id=CAST(@document AS UUID)")
		args = append(args, sql.Named("document", *p.Token.DocumentID))
	}
	return tx.Raw(libraryVisibleSQL+"SELECT v.id,v.content_version AS version FROM visible v WHERE "+strings.Join(conditions, " AND "), args...)
}
func validateNewAssets(ctx context.Context, tx *gorm.DB, p integration.Principal, blocks []document.Block) ([]string, error) {
	refs := document.MediaReferences(blocks)
	ids := []string{}
	seen := map[string]bool{}
	for _, ref := range refs {
		if !seen[ref.ID] {
			seen[ref.ID] = true
			ids = append(ids, ref.ID)
		}
	}
	if len(ids) == 0 {
		return ids, nil
	}
	if err := p.Require(integration.AssetsRead); err != nil {
		return nil, err
	}
	current, err := docstore.ReferencedAssetsInSnapshots(ctx, tx, allowedSnapshots(tx, p), ids)
	if err != nil {
		return nil, err
	}
	var attached []struct{ AssetID string }
	if err := tx.WithContext(ctx).Table("integration_attachments a").Select("DISTINCT a.asset_id").Joins("JOIN (?) scoped ON scoped.id=a.document_id", allowedSnapshots(tx, p)).Where("a.workspace_id=? AND a.asset_id IN ?", p.Token.WorkspaceID, ids).Scan(&attached).Error; err != nil {
		return nil, err
	}
	for _, row := range attached {
		current[row.AssetID] = true
	}
	for _, id := range ids {
		if !current[id] {
			return nil, fault.New(fault.Forbidden, "INTEGRATION_ASSET_SCOPE_FORBIDDEN", "文件未关联到令牌授权范围内的文档")
		}
	}
	return ids, nil
}
func (r *Library) Create(ctx context.Context, command integration.CreateDocumentCommand) (integration.CreatedDocument, error) {
	var result integration.CreatedDocument
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		p, err := r.tokens.RequirePrincipal(ctx, tx, command.Principal, []integration.Permission{integration.DocumentsWrite}, true)
		if err != nil {
			return err
		}
		if p.Token.DocumentID != nil || (p.Token.CollectionID != nil && *p.Token.CollectionID != command.Input.CollectionID) {
			return fault.New(fault.Forbidden, "INTEGRATION_SCOPE_FORBIDDEN", "不能在令牌范围外创建文档")
		}
		previous, err := itstore.ReserveOperation(ctx, tx, p, "create", command.Input.OperationID, command.Hash, nil, command.Timestamp)
		if err != nil {
			return err
		}
		if previous.State == "completed" {
			if previous.DocumentID == nil {
				return fault.Missing()
			}
			if _, err := r.tokens.Document(ctx, tx, p, *previous.DocumentID, false); err != nil {
				return err
			}
			return json.Unmarshal(previous.Result, &result)
		}
		result, err = r.createDocumentInTransaction(ctx, tx, p, command.Input, command.Parsed, command.Timestamp)
		if err != nil {
			return err
		}
		return itstore.CompleteOperation(ctx, tx, p, command.Input.OperationID, result.DocumentID, result, command.Timestamp)
	})
	return result, err
}

// createDocumentInTransaction is shared by inline creation and durable import completion.
func (r *Library) createDocumentInTransaction(ctx context.Context, tx *gorm.DB, p integration.Principal, input integration.CreateDocumentInput, parsed markdown.Parsed, timestamp int64) (integration.CreatedDocument, error) {
	assets, err := validateNewAssets(ctx, tx, p, parsed.Blocks)
	if err != nil {
		return integration.CreatedDocument{}, err
	}
	records, err := document.Flatten(parsed.Blocks)
	if err != nil {
		return integration.CreatedDocument{}, err
	}
	doc := document.Document{ID: uuid.NewString(), WorkspaceID: p.Token.WorkspaceID, CollectionID: input.CollectionID, ParentID: input.ParentID, Title: input.Title, ContentVersion: 1, CreatedAtMS: timestamp, UpdatedAtMS: timestamp}
	doc, err = docstore.InsertDocument(ctx, tx, p.UserID, doc, records)
	if err != nil {
		return integration.CreatedDocument{}, err
	}
	if err := docstore.RequireBlockReferences(ctx, tx, document.DirectoryScope{WorkspaceID: p.Token.WorkspaceID, DocumentID: doc.ID}, parsed.Blocks); err != nil {
		return integration.CreatedDocument{}, err
	}
	if err := r.tokens.CheckTokenTime(p.Token); err != nil {
		return integration.CreatedDocument{}, err
	}
	for _, assetID := range assets {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Table("integration_attachments").Create(map[string]any{"workspace_id": p.Token.WorkspaceID, "document_id": doc.ID, "asset_id": assetID, "created_at_ms": timestamp}).Error; err != nil {
			return integration.CreatedDocument{}, err
		}
	}
	result := integration.CreatedDocument{DocumentID: doc.ID, CollectionID: doc.CollectionID, OperationID: input.OperationID, ContentVersion: 1, Title: doc.Title, URL: "/documents/" + doc.ID, Warnings: parsed.Warnings, CreatedAtMS: timestamp}
	return result, nil
}
