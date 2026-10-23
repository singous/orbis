package document

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/security"
)

type StructureNode struct {
	ID            string
	ParentID      *string
	Position      int
	Type          string
	Revision      int64
	PayloadBytes  int
	PayloadDigest string
	GridCells     int
}
type BlockMutation struct {
	StructureNode
	Payload *Payload
}
type CommandPlan struct {
	Title      string
	Upserts    []BlockMutation
	DeletedIDs []string
	ChangedIDs []string
}
type nodeState struct {
	StructureNode
	payload *Payload
}

func parentKey(id *string) string {
	if id == nil {
		return ""
	}
	return *id
}
func childrenOf(nodes map[string]*nodeState, parent string) []*nodeState {
	result := []*nodeState{}
	for _, node := range nodes {
		if parentKey(node.ParentID) == parent {
			result = append(result, node)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Position == result[j].Position {
			return result[i].ID < result[j].ID
		}
		return result[i].Position < result[j].Position
	})
	return result
}
func validatePlacementParent(nodes map[string]*nodeState, nodeID string, parentID *string) error {
	if parentID != nil {
		if _, exists := nodes[*parentID]; !exists {
			return fault.Field("body.operations", "目标父块不存在")
		}
		for current := *parentID; current != ""; {
			if current == nodeID {
				return fault.Field("body.operations", "块不能移动到自身或后代")
			}
			ancestor, exists := nodes[current]
			if !exists {
				return fault.Field("body.operations", "目标父块不可用")
			}
			current = parentKey(ancestor.ParentID)
		}
	}
	return nil
}
func place(nodes map[string]*nodeState, node *nodeState, parentID, afterID *string, requestedPosition *int) error {
	if err := validatePlacementParent(nodes, node.ID, parentID); err != nil {
		return err
	}
	oldParent := parentKey(node.ParentID)
	delete(nodes, node.ID)
	siblings := childrenOf(nodes, parentKey(parentID))
	position := len(siblings)
	if requestedPosition != nil {
		position = *requestedPosition
		if position > len(siblings) {
			nodes[node.ID] = node
			return fault.Field("body.operations", "目标位置超过兄弟节点范围")
		}
	}
	if afterID != nil {
		found := false
		for i, sibling := range siblings {
			if sibling.ID == *afterID {
				position = i + 1
				found = true
				break
			}
		}
		if !found {
			nodes[node.ID] = node
			return fault.Field("body.operations", "after_id 必须是同父节点中的有效块")
		}
	}
	siblings = append(siblings, nil)
	copy(siblings[position+1:], siblings[position:])
	siblings[position] = node
	node.ParentID = parentID
	nodes[node.ID] = node
	for i, sibling := range siblings {
		sibling.Position = i
	}
	if oldParent != parentKey(parentID) {
		for i, sibling := range childrenOf(nodes, oldParent) {
			sibling.Position = i
		}
	}
	return nil
}

// placeInsertedRoots resolves the first anchor before removing the remaining new
// roots. This preserves placement semantics while ordering each sibling set once
// per operation instead of once per inserted root.
func placeInsertedRoots(nodes map[string]*nodeState, roots []*nodeState, parentID, afterID *string, requestedPosition *int) error {
	if len(roots) == 0 {
		return nil
	}
	if err := validatePlacementParent(nodes, roots[0].ID, parentID); err != nil {
		return err
	}
	siblings := childrenOf(nodes, parentKey(parentID))
	withoutFirst := siblings[:0]
	for _, sibling := range siblings {
		if sibling.ID != roots[0].ID {
			withoutFirst = append(withoutFirst, sibling)
		}
	}
	siblings = withoutFirst
	position := len(siblings)
	if requestedPosition != nil {
		position = *requestedPosition
		if position > len(siblings) {
			return fault.Field("body.operations", "目标位置超过兄弟节点范围")
		}
	}
	if afterID != nil {
		found := false
		for i, sibling := range siblings {
			if sibling.ID == *afterID {
				position, found = i+1, true
				break
			}
		}
		if !found {
			return fault.Field("body.operations", "after_id 必须是同父节点中的有效块")
		}
	}
	moving := make(map[string]bool, len(roots))
	for _, root := range roots {
		if err := validatePlacementParent(nodes, root.ID, parentID); err != nil {
			return err
		}
		moving[root.ID] = true
	}
	// Subsequent roots follow the first root, including when the initial anchor
	// refers to another root in this insertion operation.
	insertion := 0
	remaining := make([]*nodeState, 0, len(siblings))
	for i, sibling := range siblings {
		if !moving[sibling.ID] {
			remaining = append(remaining, sibling)
			if i < position {
				insertion++
			}
		}
	}
	ordered := make([]*nodeState, 0, len(remaining)+len(roots))
	ordered = append(ordered, remaining[:insertion]...)
	ordered = append(ordered, roots...)
	ordered = append(ordered, remaining[insertion:]...)
	for _, root := range roots {
		root.ParentID = parentID
	}
	for i, sibling := range ordered {
		sibling.Position = i
	}
	if parentID != nil {
		for i, sibling := range childrenOf(nodes, "") {
			sibling.Position = i
		}
	}
	return nil
}
func normalizedPayload(id string, input Payload) (Payload, int, string, int, error) {
	blocks, err := Normalize([]Block{{ID: id, Type: input.Type, Props: input.Props, Content: input.Content, Table: input.Table, Children: []Block{}}})
	if err != nil {
		return Payload{}, 0, "", 0, err
	}
	b := blocks[0]
	payload := Payload{Type: b.Type, Props: b.Props, Content: b.Content, Table: b.Table}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return payload, 0, "", 0, err
	}
	cells := 0
	if b.Table != nil {
		cells = len(b.Table.Rows) * len(b.Table.ColumnWidths)
	}
	return payload, len(encoded), security.Digest(string(encoded)), cells, nil
}
func overlaps(value, match string) int {
	count, offset := 0, 0
	for offset <= len(value) {
		i := strings.Index(value[offset:], match)
		if i < 0 {
			break
		}
		count++
		if count >= 2 {
			return count
		}
		offset += i + 1
	}
	return count
}
func replaceRun(payload Payload, match, replacement string) (Payload, error) {
	switch payload.Type {
	case "table", "data_table", "image", "audio", "video", "file", "drawing", "divider", "group", "card", "card_group", "steps", "step", "tabs", "tab", "code_group":
		return Payload{}, fault.New(fault.Validation, "TEXT_REPLACEMENT_UNSUPPORTED", "此块不支持局部文字替换，请使用浅层块更新")
	}
	count := 0
	var combined strings.Builder
	for _, run := range payload.Content {
		count += overlaps(run.Text, match)
		combined.WriteString(run.Text)
	}
	if count != 1 || overlaps(combined.String(), match) != 1 {
		return Payload{}, fault.New(fault.Conflict, "TEXT_MATCH_CONFLICT", "旧文本须在一个富文本运行段中唯一匹配")
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return Payload{}, err
	}
	if err := json.Unmarshal(encoded, &payload); err != nil {
		return Payload{}, err
	}
	for i := range payload.Content {
		if strings.Contains(payload.Content[i].Text, match) {
			payload.Content[i].Text = strings.Replace(payload.Content[i].Text, match, replacement, 1)
			break
		}
	}
	return payload, nil
}

// EncodedTreeBytes accounts for each node's two envelope fields and commas in nonempty arrays.
func EncodedTreeBytes(nodes []StructureNode) (int, error) {
	if len(nodes) == 0 {
		return 2, nil
	}
	size := 2
	parents := map[string]bool{}
	for _, node := range nodes {
		id, err := json.Marshal(node.ID)
		if err != nil {
			return 0, err
		}
		size += node.PayloadBytes + len(`,"id":`) + len(id) + len(`,"children":[]`)
		if node.ParentID != nil {
			parents[*node.ParentID] = true
		}
	}
	size += len(nodes) - 1 - len(parents)
	return size, nil
}
func childAllowed(parent, child string) bool {
	switch parent {
	case "heading", "code_block", "divider", "image", "audio", "video", "file", "drawing", "board", "table", "data_table":
		return false
	case "card_group":
		return child == "card"
	case "steps":
		return child == "step"
	case "tabs":
		return child == "tab"
	case "code_group":
		return child == "code_block"
	}
	return true
}
func validateStructure(nodes map[string]*nodeState) error {
	if len(nodes) > MaxBlocks {
		return fault.Field("body.operations", "文档块数量超出限制")
	}
	cells := 0
	boardReferences := 0
	metadata := make([]StructureNode, 0, len(nodes))
	for _, node := range nodes {
		cells += node.GridCells
		if node.Type == "board" {
			boardReferences++
		}
		metadata = append(metadata, node.StructureNode)
		seen := map[string]bool{node.ID: true}
		parent := parentKey(node.ParentID)
		depth := 1
		for parent != "" {
			ancestor, exists := nodes[parent]
			if !exists || seen[parent] {
				return fault.Field("body.operations", "文档包含无效父节点或循环")
			}
			seen[parent] = true
			depth++
			if depth > MaxDepth {
				return fault.Field("body.operations", "块嵌套层级超出限制")
			}
			parent = parentKey(ancestor.ParentID)
		}
		if node.ParentID != nil {
			if !childAllowed(nodes[*node.ParentID].Type, node.Type) {
				return fault.Field("body.operations", "父块不支持此子块类型")
			}
		}
	}
	if boardReferences > MaxBoardReferences {
		return fault.Field("body.operations", fmt.Sprintf("单篇文档最多引用 %d 个画板视图", MaxBoardReferences))
	}
	if cells > MaxDocumentGridCells {
		return fault.Field("body.operations", "普通表格逻辑格位总数超出限制")
	}
	size, err := EncodedTreeBytes(metadata)
	if err != nil {
		return err
	}
	if size > MaxContentBytes {
		return fault.New(fault.TooLarge, "CONTENT_TOO_LARGE", "修改后的文档内容超出大小限制")
	}
	return nil
}

// PlanCommands preserves unloaded children and only needs payloads for targeted text replacement.
func PlanCommands(doc Document, structure []StructureNode, operations []Operation, payloads map[string]Payload) (CommandPlan, error) {
	original := map[string]StructureNode{}
	nodes := map[string]*nodeState{}
	for _, node := range structure {
		if _, exists := nodes[node.ID]; exists {
			return CommandPlan{}, fmt.Errorf("duplicate stored structural node")
		}
		original[node.ID] = node
		nodes[node.ID] = &nodeState{StructureNode: node}
	}
	plan := CommandPlan{Title: doc.Title, Upserts: []BlockMutation{}, DeletedIDs: []string{}, ChangedIDs: []string{}}
	setPayload := func(node *nodeState, input Payload) error {
		payload, size, digest, cells, err := normalizedPayload(node.ID, input)
		if err != nil {
			return err
		}
		node.Type, node.PayloadBytes, node.PayloadDigest, node.GridCells = payload.Type, size, digest, cells
		node.payload = &payload
		return nil
	}
	for _, op := range operations {
		node, exists := nodes[op.BlockID]
		if op.Type == "update_block" || op.Type == "replace_text" || op.Type == "move_block" || op.Type == "delete_block" {
			if !exists {
				return CommandPlan{}, fault.New(fault.NotFound, "BLOCK_NOT_FOUND", "目标块不存在")
			}
			if op.ExpectedBlockRevision != nil && *op.ExpectedBlockRevision != node.Revision {
				return CommandPlan{}, fault.New(fault.Conflict, "BLOCK_VERSION_CONFLICT", "块版本已变化，请重新读取后重试")
			}
		}
		switch op.Type {
		case "update_block":
			if err := setPayload(node, *op.Block); err != nil {
				return CommandPlan{}, err
			}
		case "replace_text":
			var payload Payload
			if node.payload != nil {
				payload = *node.payload
			} else {
				var found bool
				payload, found = payloads[node.ID]
				if !found {
					return CommandPlan{}, fmt.Errorf("text replacement payload was not loaded")
				}
			}
			replaced, err := replaceRun(payload, op.Match, op.Replacement)
			if err != nil {
				return CommandPlan{}, err
			}
			if err := setPayload(node, replaced); err != nil {
				return CommandPlan{}, err
			}
		case "insert_blocks":
			blocks, err := Normalize(op.Blocks)
			if err != nil {
				return CommandPlan{}, err
			}
			records, err := Flatten(blocks)
			if err != nil {
				return CommandPlan{}, err
			}
			for _, record := range records {
				if _, exists := nodes[record.ID]; exists {
					return CommandPlan{}, fault.New(fault.Conflict, "BLOCK_ID_CONFLICT", "插入的块 ID 已存在")
				}
			}
			for _, record := range records {
				var payload Payload
				if err := json.Unmarshal(record.Payload, &payload); err != nil {
					return CommandPlan{}, err
				}
				newNode := &nodeState{StructureNode: StructureNode{ID: record.ID, ParentID: record.ParentID, Position: record.Position, Revision: doc.ContentVersion + 1}}
				if err := setPayload(newNode, payload); err != nil {
					return CommandPlan{}, err
				}
				nodes[newNode.ID] = newNode
			}
			roots := make([]*nodeState, 0, len(blocks))
			for _, block := range blocks {
				roots = append(roots, nodes[block.ID])
			}
			if err := placeInsertedRoots(nodes, roots, op.ParentID, op.AfterID, op.Position); err != nil {
				return CommandPlan{}, err
			}
		case "move_block":
			if op.AfterID != nil && *op.AfterID == node.ID {
				return CommandPlan{}, fault.Field("body.operations", "块不能放置在自身之后")
			}
			if err := place(nodes, node, op.ParentID, op.AfterID, op.Position); err != nil {
				return CommandPlan{}, err
			}
		case "delete_block":
			if !op.DeleteSubtree && len(childrenOf(nodes, node.ID)) > 0 {
				return CommandPlan{}, fault.New(fault.Conflict, "BLOCK_HAS_CHILDREN", "删除容器须明确 delete_subtree:true")
			}
			children := make(map[string][]string, len(nodes))
			for id, entry := range nodes {
				children[parentKey(entry.ParentID)] = append(children[parentKey(entry.ParentID)], id)
			}
			stack := []string{node.ID}
			for len(stack) > 0 {
				id := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				stack = append(stack, children[id]...)
				delete(nodes, id)
			}
			for i, sibling := range childrenOf(nodes, parentKey(node.ParentID)) {
				sibling.Position = i
			}
		case "update_metadata":
			plan.Title = strings.TrimSpace(op.Title)
		}
	}
	if err := validateStructure(nodes); err != nil {
		return CommandPlan{}, err
	}
	for id, node := range nodes {
		before, existed := original[id]
		changed := !existed || !sameParent(before.ParentID, node.ParentID) || before.Position != node.Position || before.PayloadDigest != node.PayloadDigest
		if changed {
			payload := node.payload
			if existed && before.PayloadDigest == node.PayloadDigest {
				payload = nil
			}
			metadata := node.StructureNode
			if existed {
				metadata.Revision = before.Revision
			}
			plan.Upserts = append(plan.Upserts, BlockMutation{StructureNode: metadata, Payload: payload})
			plan.ChangedIDs = append(plan.ChangedIDs, id)
		}
	}
	for id := range original {
		if _, exists := nodes[id]; !exists {
			plan.DeletedIDs = append(plan.DeletedIDs, id)
		}
	}
	sort.Strings(plan.ChangedIDs)
	sort.Strings(plan.DeletedIDs)
	sort.Slice(plan.Upserts, func(i, j int) bool { return plan.Upserts[i].ID < plan.Upserts[j].ID })
	return plan, nil
}
func sameParent(a, b *string) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}
