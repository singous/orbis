package document

import (
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strings"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/platform/fault"
)

const MaxBlocks = 10000
const MaxDepth = 32
const MaxContentBytes = 7 << 20

type TextRun struct {
	TextColor       *string  `json:"text_color,omitempty"`
	BackgroundColor *string  `json:"background_color,omitempty"`
	Text            string   `json:"text"`
	Marks           []string `json:"marks"`
	Href            *string  `json:"href"`
}
type Block struct {
	Table    *Grid          `json:"table,omitempty"`
	ID       string         `json:"id"`
	Type     string         `json:"type"`
	Props    map[string]any `json:"props"`
	Content  []TextRun      `json:"content"`
	Children []Block        `json:"children"`
}
type Payload struct {
	Table   *Grid          `json:"table,omitempty"`
	Type    string         `json:"type"`
	Props   map[string]any `json:"props"`
	Content []TextRun      `json:"content"`
}
type BlockRecord struct {
	PayloadByteCount *int
	Revision         int64
	ChildCount       int
	ID               string
	ParentID         *string
	Position         int
	Payload          json.RawMessage
}

// Normalize validates the complete tree before any persistent state is changed.
func Normalize(blocks []Block) ([]Block, error) {
	encoded, err := json.Marshal(blocks)
	if err != nil {
		return nil, fault.Field("body.blocks", "文档内容不是有效 JSON")
	}
	if len(encoded) > MaxContentBytes {
		return nil, fault.New(fault.TooLarge, "CONTENT_TOO_LARGE", "文档内容超出大小限制")
	}
	var result []Block
	if err = json.Unmarshal(encoded, &result); err != nil {
		return nil, err
	}
	if result == nil {
		result = []Block{}
	}
	seen := map[string]bool{}
	count := 0
	gridCells := 0
	boardReferences := 0
	var visit func([]Block, int) error
	visit = func(items []Block, depth int) error {
		if len(items) == 0 {
			return nil
		}
		if depth > MaxDepth {
			return fault.Field("body.blocks", "文档嵌套层级超出限制")
		}
		for i := range items {
			b := &items[i]
			count++
			if count > MaxBlocks {
				return fault.Field("body.blocks", "文档块数量超出限制")
			}
			id, err := uuid.Parse(b.ID)
			if err != nil || id.String() != b.ID || id == uuid.Nil || seen[b.ID] {
				return fault.Field("body.blocks", "块 ID 必须是唯一的标准 UUID")
			}
			seen[b.ID] = true
			if b.Props == nil {
				b.Props = map[string]any{}
			}
			if b.Content == nil {
				b.Content = []TextRun{}
			}
			if b.Children == nil {
				b.Children = []Block{}
			}
			allowed := map[string]bool{}
			switch b.Type {
			case "paragraph", "quote", "bullet_list_item", "toggle_list_item", "group":
			case "heading":
				allowed["level"] = true
				if !integerProp(
					b.Props,
					"level",
					1,
					6,
				) {
					return fault.Field("body.blocks", "标题级别必须在 1 至 6 之间")
				}
			case "numbered_list_item":
				allowed["start"] = true
				if _, ok := b.Props["start"]; ok && !integerProp(
					b.Props,
					"start",
					1,
					1000000,
				) {
					return fault.Field("body.blocks", "编号起始值不正确")
				}
			case "check_list_item":
				allowed["checked"] = true
				if _, ok := b.Props["checked"].(bool); !ok {
					return fault.Field("body.blocks", "任务块必须包含 checked 布尔值")
				}
			case "code_block":
				allowed["language"] = true
				if v, ok := b.Props["language"]; ok {
					if text, valid := v.(string); !valid || len(text) > 64 {
						return fault.Field("body.blocks", "代码语言不正确")
					}
				}
			case "image", "audio", "video", "file":
				if err := normalizeMedia(b); err != nil {
					return err
				}
				for key := range b.Props {
					allowed[key] = true
				}
			case "data_table":
				if err := normalizeTableReference(b); err != nil {
					return err
				}
				for key := range b.Props {
					allowed[key] = true
				}
			case "drawing":
				if err := normalizeDrawing(b); err != nil {
					return err
				}
				for key := range b.Props {
					allowed[key] = true
				}
			case "board":
				boardReferences++
				if err := normalizeBoardReference(b); err != nil {
					return err
				}
				for key := range b.Props {
					allowed[key] = true
				}
			case "table":
				if err := normalizeGrid(b.Table, &gridCells); err != nil {
					return err
				}
			case "divider":
			default:
				recognized, err := normalizeComponent(b)
				if err != nil {
					return err
				}
				if !recognized {
					return fault.Field("body.blocks", "当前内容契约不支持该块类型")
				}
				for key := range b.Props {
					allowed[key] = true
				}
			}
			if b.Type != "table" && b.Table != nil {
				return fault.Field("body.blocks", "仅普通表格块允许 table 数据")
			}
			switch b.Type {
			case "paragraph", "heading", "quote", "bullet_list_item", "numbered_list_item", "check_list_item", "toggle_list_item", "code_block", "table":
				if err := normalizeStyle(b.Props, allowed); err != nil {
					return err
				}
			}
			for key := range b.Props {
				if !allowed[key] {
					return fault.Field("body.blocks", "块属性不受支持")
				}
			}
			if (b.Type == "divider" || b.Type == "group" || mediaBlock(b.Type) || b.Type == "drawing" || b.Type == "board" || b.Type == "table" || b.Type == "data_table") && len(b.Content) > 0 {
				return fault.Field("body.blocks", "该块类型不允许正文")
			}
			if (b.Type == "divider" || b.Type == "heading" || b.Type == "code_block" || mediaBlock(b.Type) || b.Type == "drawing" || b.Type == "board" || b.Type == "table" || b.Type == "data_table") && len(b.Children) > 0 {
				return fault.Field("body.blocks", "该块类型不允许子块")
			}
			if err := normalizeRuns(b.Content); err != nil {
				return err
			}
			if err := visit(b.Children, depth+1); err != nil {
				return err
			}
		}
		return nil
	}
	if err := visit(result, 1); err != nil {
		return nil, err
	}
	if boardReferences > MaxBoardReferences {
		return nil, fault.Field("body.blocks", fmt.Sprintf("单篇文档最多引用 %d 个画板视图", MaxBoardReferences))
	}
	normalized, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	if len(normalized) > MaxContentBytes {
		return nil, fault.New(fault.TooLarge, "CONTENT_TOO_LARGE", "补齐默认值后的文档内容超出大小限制")
	}
	return result, nil
}
func integerProp(props map[string]any, key string, min, max float64) bool {
	n, ok := props[key].(float64)
	return ok && n >= min && n <= max && n == float64(int64(n))
}

// SafeLink limits stored links to HTTP(S), email recipients and unambiguous absolute site paths.
func SafeLink(value string) bool {
	if _, valid := ParseAssetLink(value); valid {
		return true
	}
	if strings.ContainsAny(value, "\x00\r\n\t\\") || strings.TrimSpace(value) != value {
		return false
	}
	u, err := url.Parse(value)
	if err != nil || u.User != nil {
		return false
	}
	if u.Scheme == "mailto" {
		return u.Host == "" && u.Opaque != "" && !strings.HasPrefix(u.Opaque, "/")
	}
	return ((u.Scheme == "http" || u.Scheme == "https") && u.Hostname() != "") || (u.Scheme == "" && u.Host == "" && strings.HasPrefix(value, "/") && !strings.HasPrefix(value, "//"))
}

// Flatten separates tree position from block payload for temporal row storage.
func Flatten(blocks []Block) ([]BlockRecord, error) {
	result := []BlockRecord{}
	var visit func([]Block, *string) error
	visit = func(items []Block, parent *string) error {
		for position, b := range items {
			payload, err := json.Marshal(Payload{Type: b.Type, Props: b.Props, Content: b.Content, Table: b.Table})
			if err != nil {
				return err
			}
			result = append(result, BlockRecord{ID: b.ID, ParentID: parent, Position: position, Payload: payload})
			id := b.ID
			if err := visit(b.Children, &id); err != nil {
				return err
			}
		}
		return nil
	}
	err := visit(blocks, nil)
	return result, err
}

// Expand reconstructs order and rejects corrupt parent links or cycles.
func Expand(records []BlockRecord) ([]Block, error) {
	children := map[string][]BlockRecord{}
	ids := map[string]bool{}
	for _, r := range records {
		if ids[r.ID] {
			return nil, fmt.Errorf("duplicate stored block")
		}
		ids[r.ID] = true
		parent := ""
		if r.ParentID != nil {
			parent = *r.ParentID
		}
		children[parent] = append(children[parent], r)
	}
	for parent := range children {
		if parent != "" && !ids[parent] {
			return nil, fmt.Errorf("orphan stored block")
		}
		sort.Slice(children[parent], func(i, j int) bool {
			a, b := children[parent][i], children[parent][j]
			if a.Position == b.Position {
				return a.ID < b.ID
			}
			return a.Position < b.Position
		})
	}
	visited := 0
	var build func(string, int) ([]Block, error)
	build = func(parent string, depth int) ([]Block, error) {
		if depth > MaxDepth+1 {
			return nil, fmt.Errorf("stored tree exceeds depth limit")
		}
		result := []Block{}
		for _, r := range children[parent] {
			var p Payload
			if err := json.Unmarshal(r.Payload, &p); err != nil {
				return nil, err
			}
			nested, err := build(r.ID, depth+1)
			if err != nil {
				return nil, err
			}
			visited++
			result = append(result, Block{ID: r.ID, Type: p.Type, Props: p.Props, Content: p.Content, Children: nested, Table: p.Table})
		}
		return result, nil
	}
	result, err := build("", 1)
	if err == nil && visited != len(records) {
		return nil, fmt.Errorf("stored tree contains a cycle")
	}
	return result, err
}
