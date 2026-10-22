package postgres

import (
	"context"
	"strings"

	"gorm.io/gorm"

	"orbis.local/orbis/internal/board"
	"orbis.local/orbis/internal/document"
)

type Projector struct{ renderer *board.Renderer }

func NewProjector(renderer *board.Renderer) *Projector { return &Projector{renderer: renderer} }
func (p *Projector) Read(ctx context.Context, tx *gorm.DB, wid string, ref document.BoardReference) (board.Snapshot, error) {
	result, err := pageSnapshot(ctx, tx, board.Scope{WorkspaceID: wid, BoardID: ref.ID}, ref.PageID, ref.Revision)
	if err != nil {
		return result, err
	}
	result.Elements, err = board.SelectFrame(result.Elements, ref.FrameID)
	return result, err
}
func (p *Projector) Project(ctx context.Context, tx *gorm.DB, wid string, ref document.BoardReference, assets func(string) (string, error)) (board.View, error) {
	release, err := p.renderer.Acquire(ctx)
	if err != nil {
		return board.View{}, err
	}
	defer release()
	snapshot, err := p.Read(ctx, tx, wid, ref)
	if err != nil {
		return board.View{}, err
	}
	background := "#ffffff"
	for _, page := range snapshot.Board.Pages {
		if page.ID == ref.PageID {
			background = page.Background
		}
	}
	svg, err := p.renderer.SVG(ctx, snapshot.Elements, background, assets)
	text := []string{}
	for _, element := range board.ExpandedElements(snapshot.Elements) {
		text = append(text, element.Text)
		for _, member := range element.Structure.Members {
			text = append(text, member.Name, member.Type)
		}
	}
	return board.View{Title: snapshot.Board.Title, Revision: snapshot.Board.Revision, SVG: svg, Text: strings.Join(text, "\n")}, err
}
