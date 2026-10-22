package postgres

import (
	"context"

	"gorm.io/gorm"
	"orbis.local/orbis/internal/document"
	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/internal/platform/fault"
)

// ValidateReferences permits existing document references without broadening a scoped file grant.
func ValidateReferences(ctx context.Context, tx *gorm.DB, p integration.Principal, doc document.Document, ops []document.Operation) error {
	blocks := []document.Block{}
	for _, op := range ops {
		if op.Type == "update_block" && op.Block != nil {
			b := op.Block
			blocks = append(blocks, document.Block{ID: op.BlockID, Type: b.Type, Props: b.Props, Content: b.Content, Table: b.Table})
		}
		if op.Type == "insert_blocks" {
			blocks = append(blocks, op.Blocks...)
		}
	}
	for _, ref := range document.BoardReferences(blocks) {
		if err := p.Require(integration.DocumentsRead); err != nil {
			return err
		}
		var owner struct{ DocumentID string }
		if err := tx.WithContext(ctx).Table("boards").Select("document_id").Where("workspace_id=? AND id=?", p.Token.WorkspaceID, ref.ID).Take(&owner).Error; err != nil {
			return integration.ScopeMissing()
		}
		source, err := docstore.New(tx).Get(ctx, p.Token.WorkspaceID, owner.DocumentID)
		if err != nil {
			return err
		}
		if !AllowedDocument(p, source) {
			return integration.ScopeMissing()
		}
	}
	refs := document.MediaReferences(blocks)
	ids := []string{}
	seen := map[string]bool{}
	for _, ref := range refs {
		if !seen[ref.ID] {
			ids = append(ids, ref.ID)
			seen[ref.ID] = true
		}
	}
	current, err := docstore.ReferencedAssetIDs(ctx, tx, doc.ID, doc.ContentVersion, ids)
	if err != nil {
		return err
	}
	needed := []string{}
	for _, id := range ids {
		if !current[id] {
			needed = append(needed, id)
		}
	}
	if len(needed) == 0 {
		return nil
	}
	if err := p.Require(integration.AssetsRead); err != nil {
		return err
	}
	var count int64
	if err := tx.Table("integration_attachments").Where("workspace_id=? AND document_id=? AND asset_id IN ?", p.Token.WorkspaceID, doc.ID, needed).Count(&count).Error; err != nil {
		return err
	}
	if count != int64(len(needed)) {
		return fault.New(fault.Forbidden, "INTEGRATION_ASSET_SCOPE_FORBIDDEN", "附件未关联到当前授权文档")
	}
	// Absolute/internal hyperlinks are not asset grants; only explicit asset identities participate.
	return nil
}
