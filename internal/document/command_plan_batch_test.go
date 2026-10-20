package document

import (
	"fmt"
	"math/rand/v2"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

func commandPlanInsertionFixture(count int) []Operation {
	operations := make([]Operation, 0, (count+MaxInsertedBlocks-1)/MaxInsertedBlocks)
	for offset := 0; offset < count; offset += MaxInsertedBlocks {
		operation := Operation{Type: "insert_blocks"}
		for i := offset; i < min(offset+MaxInsertedBlocks, count); i++ {
			operation.Blocks = append(operation.Blocks, Block{ID: fmt.Sprintf("00000000-0000-4000-8000-%012d", i+1), Type: "paragraph", Content: []TextRun{{Text: "Long document paragraph"}}})
		}
		operations = append(operations, operation)
	}
	return operations
}

func BenchmarkPlanCommandsInsertLongDocument(b *testing.B) {
	for _, count := range []int{5500, 10000} {
		b.Run(fmt.Sprintf("blocks_%d", count), func(b *testing.B) {
			operations := commandPlanInsertionFixture(count)
			doc := Document{Title: "Long document", ContentVersion: 1}
			b.ReportAllocs()
			b.ResetTimer()
			for b.Loop() {
				plan, err := PlanCommands(doc, nil, operations, nil)
				if err != nil {
					b.Fatal(err)
				}
				if len(plan.Upserts) != count {
					b.Fatalf("planned %d blocks, want %d", len(plan.Upserts), count)
				}
			}
		})
	}
}

func TestCommandsInsertLongDocumentPreservesEveryParagraph(t *testing.T) {
	for _, count := range []int{5500, 10000} {
		t.Run(fmt.Sprintf("blocks_%d", count), func(t *testing.T) {
			doc := Document{Title: "Long document", ContentVersion: 1}
			command, err := PrepareCommand(DirectoryScope{}, CommandsInput{OperationID: uuid.NewString(), ExpectedVersion: 1, Operations: commandPlanInsertionFixture(count)}, "", 1)
			if err != nil {
				t.Fatal(err)
			}
			plan, err := PlanCommands(doc, nil, command.Input.Operations, nil)
			if err != nil {
				t.Fatal(err)
			}
			if len(plan.Upserts) != count || len(plan.ChangedIDs) != count || len(plan.DeletedIDs) != 0 {
				t.Fatalf("incomplete document plan: %d upserts, %d changed, %d deleted", len(plan.Upserts), len(plan.ChangedIDs), len(plan.DeletedIDs))
			}
			for i, block := range plan.Upserts {
				wantID := fmt.Sprintf("00000000-0000-4000-8000-%012d", i+1)
				if block.ID != wantID || block.ParentID != nil || block.Position != i || block.Revision != 2 || block.Payload == nil || len(block.Payload.Content) != 1 || block.Payload.Content[0].Text != "Long document paragraph" {
					t.Fatalf("paragraph %d lost its identity, order or payload: %+v", i, block)
				}
			}
		})
	}
}

func TestCommandsMixedPlacementKeepsNestedContentAndAnchors(t *testing.T) {
	group, first, second, third, last := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	insertedGroup, insertedChild, inserted, tailFirst, tailSecond := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	paragraph := func(id, text string) Block { return Block{ID: id, Type: "paragraph", Content: []TextRun{{Text: text}}} }
	blocks, err := Normalize([]Block{{ID: group, Type: "group", Children: []Block{paragraph(first, "first"), paragraph(second, "second"), paragraph(third, "original")}}, paragraph(last, "last")})
	if err != nil {
		t.Fatal(err)
	}
	metadata := structure(t, blocks)
	position := 1
	front := 0
	updated := Payload{Type: "paragraph", Content: []TextRun{{Text: "updated"}}}
	operations := []Operation{
		{Type: "insert_blocks", ParentID: &group, Position: &position, Blocks: []Block{{ID: insertedGroup, Type: "group", Children: []Block{paragraph(insertedChild, "child")}}, paragraph(inserted, "inserted")}},
		{Type: "move_block", BlockID: second, Position: &front},
		{Type: "move_block", BlockID: insertedChild, ParentID: &group, AfterID: &third},
		{Type: "update_block", BlockID: inserted, Block: &updated},
		{Type: "delete_block", BlockID: insertedGroup},
		{Type: "replace_text", BlockID: third, Match: "original", Replacement: "replaced"},
		{Type: "delete_block", BlockID: first},
		{Type: "insert_blocks", ParentID: &group, AfterID: &insertedChild, Blocks: []Block{paragraph(tailFirst, "tail 1"), paragraph(tailSecond, "tail 2")}},
		{Type: "update_metadata", Title: "Updated document"},
	}
	plan, err := PlanCommands(Document{Title: "Original document", ContentVersion: 1}, metadata, operations, map[string]Payload{third: {Type: "paragraph", Content: []TextRun{{Text: "original"}}}})
	if err != nil {
		t.Fatal(err)
	}
	if plan.Title != "Updated document" || !reflect.DeepEqual(plan.DeletedIDs, []string{first}) {
		t.Fatalf("unexpected title or deletions: %+v", plan)
	}
	current := make(map[string]StructureNode)
	for _, node := range metadata {
		current[node.ID] = node
	}
	for _, id := range plan.DeletedIDs {
		delete(current, id)
	}
	for _, mutation := range plan.Upserts {
		current[mutation.ID] = mutation.StructureNode
	}
	if _, exists := current[insertedGroup]; exists {
		t.Fatal("inserted then deleted group persisted")
	}
	assertOrder := func(parent *string, ids []string) {
		t.Helper()
		for i, id := range ids {
			if node, ok := current[id]; !ok || !sameParent(node.ParentID, parent) || node.Position != i {
				t.Fatalf("block %s has incorrect parent or position: %+v", id, node)
			}
		}
	}
	assertOrder(nil, []string{second, group, last})
	assertOrder(&group, []string{inserted, third, insertedChild, tailFirst, tailSecond})
	for _, mutation := range plan.Upserts {
		if mutation.ID == third && (mutation.Payload == nil || mutation.Payload.Content[0].Text != "replaced") {
			t.Fatal("text replacement was lost after sibling reordering")
		}
		if mutation.ID == inserted && (mutation.Payload == nil || mutation.Payload.Content[0].Text != "updated") {
			t.Fatal("new block update was lost after sibling reordering")
		}
	}
}

// The established single-block move behavior is the compatibility model for
// batching. Exercise anchors that also name pending roots, tied positions,
// reparenting, missing parents and cycles instead of assuming clean input order.
func TestInsertedRootBatchMatchesSequentialPlacement(t *testing.T) {
	random := rand.New(rand.NewPCG(14, 27))
	for iteration := range 2000 {
		nodes := make(map[string]*nodeState)
		parent := "parent"
		nodes[parent] = &nodeState{StructureNode: StructureNode{ID: parent, Type: "group", Position: 3}}
		ids := []string{parent, "missing"}
		for i := range 20 {
			id := fmt.Sprintf("existing-%02d", i)
			var parentID *string
			if i%2 == 0 {
				parentID = &parent
			}
			nodes[id] = &nodeState{StructureNode: StructureNode{ID: id, Type: "group", ParentID: parentID, Position: random.IntN(12)}}
			ids = append(ids, id)
		}
		var rootIDs []string
		for i := range 1 + random.IntN(10) {
			id := fmt.Sprintf("inserted-%02d", i)
			nodes[id] = &nodeState{StructureNode: StructureNode{ID: id, Type: "group", Position: i}}
			rootIDs = append(rootIDs, id)
			ids = append(ids, id)
			childID := id + "-child"
			nodes[childID] = &nodeState{StructureNode: StructureNode{ID: childID, Type: "paragraph", ParentID: &rootIDs[i], Position: 0}}
			ids = append(ids, childID)
		}
		clone := func() map[string]*nodeState {
			result := make(map[string]*nodeState, len(nodes))
			for id, node := range nodes {
				copyNode := *node
				result[id] = &copyNode
			}
			return result
		}
		sequential, batched := clone(), clone()
		var parentID, afterID *string
		var position *int
		if random.IntN(3) != 0 {
			parentID = &ids[random.IntN(len(ids))]
		}
		switch random.IntN(3) {
		case 0:
			afterID = &ids[random.IntN(len(ids))]
		case 1:
			value := random.IntN(30)
			position = &value
		}
		after, requestedPosition := afterID, position
		var expectedErr error
		for _, id := range rootIDs {
			expectedErr = place(sequential, sequential[id], parentID, after, requestedPosition)
			if expectedErr != nil {
				break
			}
			after = &sequential[id].ID
			requestedPosition = nil
		}
		roots := make([]*nodeState, 0, len(rootIDs))
		for _, id := range rootIDs {
			roots = append(roots, batched[id])
		}
		actualErr := placeInsertedRoots(batched, roots, parentID, afterID, position)
		if !reflect.DeepEqual(actualErr, expectedErr) {
			t.Fatalf("case %d changed validation behavior: got %+v, want %+v", iteration, actualErr, expectedErr)
		}
		if actualErr == nil && !reflect.DeepEqual(batched, sequential) {
			t.Fatalf("case %d changed block parents or positions", iteration)
		}
	}
}
