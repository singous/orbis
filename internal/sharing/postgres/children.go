package postgres

import (
	"context"
	"database/sql"
	"encoding/json"

	"gorm.io/gorm"
	"orbis.local/orbis/internal/document"
	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/internal/sharing"
)

// Children projects only authorized current content and keeps omitted payloads distinct from empty content.
func (r *Repository) Children(ctx context.Context, input sharing.PublicQuery) (sharing.ChildPage, error) {
	result := sharing.ChildPage{Items: []sharing.ChildBlock{}}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		scope, err := r.resolve(ctx, tx, input)
		if err != nil {
			return err
		}
		doc, err := scope.doc(ctx, tx, input.DocumentID, input.Version)
		if err != nil {
			return err
		}
		records, err := docstore.ChildrenAt(ctx, tx, document.ReadQuery{Scope: document.DirectoryScope{WorkspaceID: scope.share.WorkspaceID, DocumentID: doc.ID}, Version: doc.ContentVersion, ParentID: input.ParentID, AfterID: input.After, AfterPosition: input.AfterPosition, Limit: input.Limit + 1})
		if err != nil {
			return scopeError(err)
		}
		result.HasMore = len(records) > input.Limit
		if result.HasMore {
			records = records[:input.Limit]
		}
		remaining := sharing.MaxWindowPayloadBytes
		for _, record := range records {
			var payload document.Payload
			if err := json.Unmarshal(record.Payload, &payload); err != nil {
				return err
			}
			projected, err := r.project(ctx, tx, scope, doc, input, []document.Block{{ID: record.ID, Type: payload.Type, Props: payload.Props, Content: payload.Content, Table: payload.Table, Children: []document.Block{}}})
			if err != nil {
				return err
			}
			encoded, err := json.Marshal(projected[0])
			if err != nil {
				return err
			}
			item := sharing.ChildBlock{ID: record.ID, ParentID: record.ParentID, Position: record.Position, BlockType: payload.Type, ChildCount: record.ChildCount, PayloadBytes: len(encoded)}
			if len(encoded) <= remaining {
				item.Block = &projected[0]
				item.PayloadLoaded = true
				remaining -= len(encoded)
			}
			result.Items = append(result.Items, item)
		}
		result.Document = publicDocument(doc)
		result.ShareID = scope.share.ID
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
