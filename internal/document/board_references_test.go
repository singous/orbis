package document_test

import (
	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	"testing"
)

func TestBoardReferenceBudgetsCoverWholeBodyAndIncrementalWrites(t *testing.T) {
	blocks := []document.Block{}
	structure := []document.StructureNode{}
	for i := 0; i < document.MaxBoardReferences; i++ {
		id := uuid.NewString()
		blocks = append(blocks, document.Block{ID: id, Type: "board"})
		structure = append(structure, document.StructureNode{ID: id, Type: "board", Position: i, PayloadBytes: 200, Revision: 1})
	}
	if _, err := document.Normalize(blocks); err != nil {
		t.Fatal(err)
	}
	extra := document.Block{ID: uuid.NewString(), Type: "board"}
	if _, err := document.Normalize(append(blocks, extra)); err == nil {
		t.Fatal("whole body exceeded board reference budget")
	}
	position := document.MaxBoardReferences
	_, err := document.PlanCommands(document.Document{Title: "Test"}, structure, []document.Operation{{Type: "insert_blocks", Position: &position, Blocks: []document.Block{extra}}}, nil)
	if err == nil {
		t.Fatal("incremental write bypassed aggregate reference budget")
	}
	_, err = document.PlanCommands(document.Document{Title: "Test"}, structure[:1], []document.Operation{{Type: "insert_blocks", ParentID: &structure[0].ID, Blocks: []document.Block{paragraph("invalid child")}}}, nil)
	if err == nil {
		t.Fatal("incremental write attached children to atomic board block")
	}
}
func TestBoardProjectionKeysDistinguishVersionAndFrame(t *testing.T) {
	base := document.BoardReference{ID: uuid.NewString(), PageID: uuid.NewString(), Mode: "live"}
	copy := base
	copy.Mode = "snapshot"
	copy.Revision = 4
	if copy.Key() == base.Key() {
		t.Fatal("snapshot collided with live projection")
	}
	frame := uuid.NewString()
	copy = base
	copy.FrameID = &frame
	if copy.Key() == base.Key() {
		t.Fatal("frame collided with whole page")
	}
}
