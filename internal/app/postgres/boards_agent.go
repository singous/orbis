package postgres

import (
	"context"
	"database/sql"
	"encoding/json"

	"gorm.io/gorm"

	"orbis.local/orbis/internal/board"
	boardstore "orbis.local/orbis/internal/board/postgres"
	"orbis.local/orbis/internal/integration"
	itstore "orbis.local/orbis/internal/integration/postgres"
	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/internal/workspace"
)

type AgentBoards struct {
	db       *gorm.DB
	tokens   *itstore.Repository
	clock    clock.Clock
	catalog  board.Catalog
	renderer *board.Renderer
	cursors  *security.CursorSigner
}

func NewAgentBoards(db *gorm.DB, clock clock.Clock, key string, catalog board.Catalog, renderer *board.Renderer) *AgentBoards {
	return &AgentBoards{db: db, tokens: itstore.New(db, clock), clock: clock, catalog: catalog, renderer: renderer, cursors: security.NewCursorSigner("agent-boards:" + key)}
}
func (r *AgentBoards) service(tx *gorm.DB) *board.Service {
	return board.New(boardstore.New(tx, r.catalog, r.cursors), workspace.New(NewWorkspaces(tx), r.clock), r.clock, r.catalog, r.renderer)
}
func boardScopeFor(p integration.Principal, id string) board.Scope {
	return board.Scope{ActorID: p.UserID, WorkspaceID: p.Token.WorkspaceID, BoardID: id}
}
func (r *AgentBoards) ReadBoard(ctx context.Context, q integration.BoardQuery, kind string) (any, error) {
	var result any
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		principal, err := r.tokens.RequirePrincipal(ctx, tx, q.Principal, []integration.Permission{integration.DocumentsRead}, false)
		if err != nil {
			return err
		}
		service := r.service(tx)
		scope := boardScopeFor(principal, q.BoardID)
		if kind == "list" {
			collection := q.CollectionID
			if principal.Token.CollectionID != nil {
				if collection != "" && collection != *principal.Token.CollectionID {
					return integration.ScopeMissing()
				}
				collection = *principal.Token.CollectionID
			}
			if principal.Token.DocumentID != nil {
				if _, err := r.tokens.Document(ctx, tx, principal, *principal.Token.DocumentID, false); err != nil {
					return err
				}
				scope.OwnerDocumentID = *principal.Token.DocumentID
			}
			items, total, err := service.List(ctx, scope, collection, q.Page)
			if err != nil {
				return err
			}
			result = map[string]any{"items": items, "pagination": map[string]any{"page": q.Page.Number, "page_size": q.Page.Size, "total": total}}
			return nil
		}
		meta, err := service.Get(ctx, scope, 0)
		if err != nil {
			return err
		}
		if _, err := r.tokens.Document(ctx, tx, principal, meta.DocumentID, false); err != nil {
			return err
		}
		switch kind {
		case "metadata":
			result, err = service.Get(ctx, scope, q.Revision)
		case "snapshot":
			result, err = service.Snapshot(ctx, scope, q.Revision)
		case "elements":
			result, err = service.Elements(ctx, scope, q.Elements)
		case "changes":
			result, err = service.Changes(ctx, scope, q.After)
		case "history":
			var items []board.HistoryItem
			items, err = service.History(ctx, scope, q.After)
			result = map[string]any{"items": items}
		case "receipt":
			result, err = service.Receipt(ctx, scope, q.OperationID)
		}
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func (r *AgentBoards) CreateBoard(ctx context.Context, claimed integration.Principal, in board.Create) (board.Board, error) {
	var result board.Board
	if _, err := board.ValidateCreate(r.catalog, in); err != nil {
		return result, err
	}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		principal, err := r.tokens.RequirePrincipal(ctx, tx, claimed, []integration.Permission{integration.DocumentsWrite}, true)
		if err != nil {
			return err
		}
		if principal.Token.DocumentID != nil || (principal.Token.CollectionID != nil && *principal.Token.CollectionID != in.CollectionID) {
			return integration.ScopeMissing()
		}
		if in.ParentID != nil {
			if _, err := r.tokens.Document(ctx, tx, principal, *in.ParentID, false); err != nil {
				return err
			}
		}
		for _, element := range in.Elements {
			if element.Structure.AssetID != nil {
				if err := principal.Require(integration.AssetsRead); err != nil {
					return err
				}
				if principal.Token.CollectionID != nil {
					return fault.New(fault.Forbidden, "INTEGRATION_ASSET_SCOPE_FORBIDDEN", "限定范围的令牌须先创建画板，再向所属文档上传图片")
				}
			}
		}
		hash, err := integration.RequestHash("board.create", in.ID, in)
		if err != nil {
			return err
		}
		receipt, err := itstore.ReserveOperation(ctx, tx, principal, "board.create", in.OperationID, hash, nil, r.clock.Now().UnixMilli())
		if err != nil {
			return err
		}
		if receipt.State == "completed" {
			if err := json.Unmarshal(receipt.Result, &result); err != nil {
				return err
			}
			_, err := r.tokens.Document(ctx, tx, principal, result.DocumentID, false)
			return err
		}
		result, err = r.service(tx).Create(ctx, boardScopeFor(principal, in.ID), in)
		if err != nil {
			return err
		}
		if err := r.tokens.CheckTokenTime(principal.Token); err != nil {
			return err
		}
		return itstore.CompleteOperation(ctx, tx, principal, in.OperationID, result.DocumentID, result, r.clock.Now().UnixMilli())
	})
	return result, err
}
func (r *AgentBoards) ChangeBoard(ctx context.Context, claimed integration.Principal, id string, in board.Mutation) (board.Change, error) {
	var result board.Change
	if _, err := board.ValidateMutation(r.catalog, in); err != nil {
		return result, err
	}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		principal, err := r.tokens.RequirePrincipal(ctx, tx, claimed, []integration.Permission{integration.DocumentsWrite}, true)
		if err != nil {
			return err
		}
		service := r.service(tx)
		scope := boardScopeFor(principal, id)
		meta, err := service.Get(ctx, scope, 0)
		if err != nil {
			return err
		}
		if _, err := r.tokens.Document(ctx, tx, principal, meta.DocumentID, false); err != nil {
			return err
		}
		hash, err := integration.RequestHash("board.commands", id, in)
		if err != nil {
			return err
		}
		receipt, err := itstore.ReserveOperation(ctx, tx, principal, "board.commands", in.OperationID, hash, nil, r.clock.Now().UnixMilli())
		if err != nil {
			return err
		}
		if receipt.State == "completed" {
			return json.Unmarshal(receipt.Result, &result)
		}
		if err := r.authorizeImages(ctx, tx, principal, meta, in); err != nil {
			return err
		}
		result, err = service.Mutate(ctx, scope, in)
		if err != nil {
			return err
		}
		if err := r.tokens.CheckTokenTime(principal.Token); err != nil {
			return err
		}
		return itstore.CompleteOperation(ctx, tx, principal, in.OperationID, meta.DocumentID, result, r.clock.Now().UnixMilli())
	})
	return result, err
}
func (r *AgentBoards) authorizeImages(ctx context.Context, tx *gorm.DB, p integration.Principal, meta board.Board, in board.Mutation) error {
	ids := map[string]bool{}
	for _, command := range in.Commands {
		for _, element := range command.Elements {
			if element.Structure.AssetID != nil {
				ids[*element.Structure.AssetID] = true
			}
		}
		for _, patch := range command.Patches {
			if patch.Structure != nil && patch.Structure.AssetID != nil {
				ids[*patch.Structure.AssetID] = true
			}
		}
	}
	if len(ids) == 0 {
		return nil
	}
	values := []string{}
	for id := range ids {
		values = append(values, id)
	}
	var current []struct{ AssetID string }
	if err := tx.WithContext(ctx).Table("board_elements").Select("DISTINCT asset_id").Where("board_id=? AND asset_id IN ?", meta.ID, values).Scan(&current).Error; err != nil {
		return err
	}
	for _, row := range current {
		delete(ids, row.AssetID)
	}
	if len(ids) == 0 {
		return nil
	}
	if err := p.Require(integration.AssetsRead); err != nil {
		return err
	}
	values = []string{}
	for id := range ids {
		values = append(values, id)
	}
	var count int64
	if err := tx.Table("integration_attachments").Where("workspace_id=? AND document_id=? AND asset_id IN ?", p.Token.WorkspaceID, meta.DocumentID, values).Count(&count).Error; err != nil {
		return err
	}
	if count != int64(len(ids)) {
		return fault.New(fault.Forbidden, "INTEGRATION_ASSET_SCOPE_FORBIDDEN", "图片尚未关联到当前画板所属文档")
	}
	return nil
}
