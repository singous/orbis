package integration

import (
	"context"

	"orbis.local/orbis/internal/board"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
)

type BoardQuery struct {
	Principal    Principal
	BoardID      string
	Revision     int64
	Elements     board.ElementQuery
	After        int64
	OperationID  string
	Page         pagination.Page
	CollectionID string
}
type BoardRepository interface {
	ReadBoard(context.Context, BoardQuery, string) (any, error)
	CreateBoard(context.Context, Principal, board.Create) (board.Board, error)
	ChangeBoard(context.Context, Principal, string, board.Mutation) (board.Change, error)
}
type Boards struct{ repo BoardRepository }

func NewBoards(repo BoardRepository) *Boards { return &Boards{repo: repo} }
func (b *Boards) Read(ctx context.Context, q BoardQuery, kind string) (any, error) {
	if err := q.Principal.Require(DocumentsRead); err != nil {
		return nil, err
	}
	if kind != "list" && !board.ValidID(q.BoardID) {
		return nil, ScopeMissing()
	}
	switch kind {
	case "list", "metadata", "elements", "snapshot", "changes", "history", "receipt":
	default:
		return nil, fault.Missing()
	}
	return b.repo.ReadBoard(ctx, q, kind)
}
func (b *Boards) Create(ctx context.Context, p Principal, in board.Create) (board.Board, error) {
	if err := p.Require(DocumentsWrite); err != nil {
		return board.Board{}, err
	}
	if p.Token.DocumentID != nil || (p.Token.CollectionID != nil && *p.Token.CollectionID != in.CollectionID) {
		return board.Board{}, ScopeMissing()
	}
	return b.repo.CreateBoard(ctx, p, in)
}
func (b *Boards) Change(ctx context.Context, p Principal, id string, in board.Mutation) (board.Change, error) {
	if err := p.Require(DocumentsWrite); err != nil {
		return board.Change{}, err
	}
	if !board.ValidID(id) {
		return board.Change{}, ScopeMissing()
	}
	return b.repo.ChangeBoard(ctx, p, id, in)
}
