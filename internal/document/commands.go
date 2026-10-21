package document

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/internal/workspace"
)

const MaxOperations = 100
const MaxOperationBytes = 8 << 20
const MaxAgentOperationBytes = 1 << 20
const MaxInsertedBlocks = 100
const MaxTextEditRunes = 131072

type Operation struct {
	Position              *int     `json:"position,omitempty"`
	Type                  string   `json:"type"`
	BlockID               string   `json:"block_id,omitempty"`
	ExpectedBlockRevision *int64   `json:"expected_block_revision,omitempty"`
	Block                 *Payload `json:"block,omitempty"`
	Match                 string   `json:"match,omitempty"`
	Replacement           string   `json:"replacement,omitempty"`
	ParentID              *string  `json:"parent_id,omitempty"`
	AfterID               *string  `json:"after_id,omitempty"`
	Blocks                []Block  `json:"blocks,omitempty"`
	DeleteSubtree         bool     `json:"delete_subtree,omitempty"`
	Title                 string   `json:"title,omitempty"`
}
type CommandsInput struct {
	OperationID     string      `json:"operation_id"`
	ExpectedVersion int64       `json:"expected_version"`
	Operations      []Operation `json:"operations"`
	TableCopies     []TableCopy `json:"table_copies,omitempty"`
}
type Command struct {
	Scope       DirectoryScope
	Input       CommandsInput
	RequestHash string
	Timestamp   int64
}
type CommandResult struct {
	DocumentID      string          `json:"document_id"`
	OperationID     string          `json:"operation_id"`
	BaseVersion     int64           `json:"base_version"`
	ContentVersion  int64           `json:"content_version"`
	Title           string          `json:"title"`
	ChangedBlockIDs []string        `json:"changed_block_ids"`
	DeletedBlockIDs []string        `json:"deleted_block_ids"`
	ResolvedBlocks  []ResolvedBlock `json:"resolved_blocks,omitempty"`
}
type CommandPreview struct {
	DocumentID       string   `json:"document_id"`
	OperationID      string   `json:"operation_id"`
	ExpectedVersion  int64    `json:"expected_version"`
	ProjectedVersion int64    `json:"projected_version"`
	Title            string   `json:"title"`
	ChangedBlockIDs  []string `json:"changed_block_ids"`
	DeletedBlockIDs  []string `json:"deleted_block_ids"`
}

func validBlockID(id string) bool {
	value, err := uuid.Parse(id)
	return err == nil && value != uuid.Nil && value.String() == id
}
func operationError(index int, field, message string) error {
	suffix := ""
	if field != "" {
		suffix = "." + field
	}
	return fault.Field(fmt.Sprintf("body.operations[%d]%s", index, suffix), message)
}

// PrepareCommand is shared by the private editor and explicitly scoped Agent use cases.
func PrepareCommand(scope DirectoryScope, input CommandsInput, clientID string, timestamp int64) (Command, error) {
	raw, err := json.Marshal(input)
	if err != nil {
		return Command{}, fault.Field("body.operations", "操作内容不是有效 JSON")
	}
	limit := MaxOperationBytes
	if clientID != "" {
		limit = MaxAgentOperationBytes
	}
	if len(raw) > limit {
		return Command{}, &fault.Error{Kind: fault.TooLarge, Code: "OPERATIONS_TOO_LARGE", Message: "操作请求超出大小限制", Details: map[string]int{"max_bytes": limit}}
	}
	var copyInput CommandsInput
	if err := json.Unmarshal(raw, &copyInput); err != nil {
		return Command{}, err
	}
	input = copyInput

	if !validBlockID(input.OperationID) {
		return Command{}, fault.Field("body.operation_id", "操作 ID 必须是标准 UUID")
	}
	if input.ExpectedVersion < 1 || input.ExpectedVersion >= MaxVersion {
		return Command{}, fault.Field("body.expected_version", "文档版本号不正确")
	}
	if len(input.Operations) < 1 || len(input.Operations) > MaxOperations {
		return Command{}, fault.Field("body.operations", "单次操作数量必须在 1 至 100 之间")
	}
	for i, op := range input.Operations {
		requiresBlock := op.Type == "update_block" || op.Type == "replace_text" || op.Type == "move_block" || op.Type == "delete_block"
		if requiresBlock && !validBlockID(op.BlockID) {
			return Command{}, operationError(i, "block_id", "块 ID 必须是标准 UUID")
		}
		if op.ExpectedBlockRevision != nil && (*op.ExpectedBlockRevision < 1 || *op.ExpectedBlockRevision > MaxVersion) {
			return Command{}, operationError(i, "expected_block_revision", "块版本号不正确")
		}
		for _, id := range []*string{op.ParentID, op.AfterID} {
			if id != nil && !validBlockID(*id) {
				return Command{}, operationError(i, "", "父块与位置引用必须是标准 UUID 或 null")
			}
		}
		if op.Position != nil && (*op.Position < 0 || *op.Position > MaxBlocks || op.AfterID != nil) {
			return Command{}, operationError(i, "position", "位置须为非负整数，且不能与 after_id 同时提供")
		}
		if (op.Type != "update_block" && op.Block != nil) || (op.Type != "insert_blocks" && len(op.Blocks) > 0) || ((op.Type != "insert_blocks" && op.Type != "move_block") && (op.ParentID != nil || op.AfterID != nil || op.Position != nil)) || (op.Type != "replace_text" && (op.Match != "" || op.Replacement != "")) || (op.Type != "update_metadata" && op.Title != "") || (!requiresBlock && op.BlockID != "") || (op.Type != "delete_block" && op.DeleteSubtree) {
			return Command{}, operationError(i, "", "操作包含其他类型的字段")
		}
		switch op.Type {
		case "update_block":
			if op.Block == nil {
				return Command{}, operationError(i, "block", "需要提供浅层块内容")
			}
			payload, _, _, _, err := normalizedPayload(op.BlockID, *op.Block)
			if err != nil {
				return Command{}, err
			}
			input.Operations[i].Block = &payload
		case "replace_text":
			if op.Match == "" || utf8.RuneCountInString(op.Match) > MaxTextEditRunes || utf8.RuneCountInString(op.Replacement) > MaxTextEditRunes || strings.ContainsRune(op.Replacement, 0) {
				return Command{}, operationError(i, "replacement", "替换文本格式或长度不正确")
			}
		case "insert_blocks":
			var err error
			if len(op.Blocks) < 1 || len(op.Blocks) > MaxInsertedBlocks {
				return Command{}, operationError(i, "blocks", "每次插入须为 1 至 100 个块")
			}
			input.Operations[i].Blocks, err = Normalize(op.Blocks)
			if err != nil {
				return Command{}, err
			}
		case "move_block", "delete_block":
		case "update_metadata":
			input.Operations[i].Title = strings.TrimSpace(op.Title)
			if _, err := title(op.Title, 240); err != nil {
				return Command{}, operationError(i, "title", "标题长度必须在 1 至 240 个字符之间")
			}
		default:
			return Command{}, operationError(i, "type", "操作类型不受支持")
		}
	}
	if err := validateTableCopies(input); err != nil {
		return Command{}, err
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return Command{}, fault.Field("body.operations", "操作内容不是有效 JSON")
	}
	maxBytes := MaxOperationBytes
	if clientID != "" {
		maxBytes = MaxAgentOperationBytes
	}
	if len(encoded) > maxBytes {
		return Command{}, &fault.Error{Kind: fault.TooLarge, Code: "OPERATIONS_TOO_LARGE", Message: "操作请求超出大小限制", Details: map[string]int{"max_bytes": maxBytes}}
	}
	hash, err := json.Marshal(struct {
		Kind, ClientID string
		Input          CommandsInput
	}{Kind: "document.commands.v1", ClientID: clientID, Input: input})
	if err != nil {
		return Command{}, err
	}
	return Command{Scope: scope, Input: input, RequestHash: security.Digest(string(hash)), Timestamp: timestamp}, nil
}
func (s *Service) ApplyCommands(ctx context.Context, scope DirectoryScope, input CommandsInput) (CommandResult, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Edit); err != nil {
		return CommandResult{}, err
	}
	if err := s.acquireCommand(ctx); err != nil {
		return CommandResult{}, err
	}
	defer func() { <-s.commands }()
	command, err := PrepareCommand(scope, input, "", s.clock.Now().UnixMilli())
	if err != nil {
		return CommandResult{}, err
	}
	return s.repo.ApplyCommands(ctx, command)
}
func (s *Service) PreviewCommands(ctx context.Context, scope DirectoryScope, input CommandsInput) (CommandPreview, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Edit); err != nil {
		return CommandPreview{}, err
	}
	if err := s.acquireCommand(ctx); err != nil {
		return CommandPreview{}, err
	}
	defer func() { <-s.commands }()
	command, err := PrepareCommand(scope, input, "", s.clock.Now().UnixMilli())
	if err != nil {
		return CommandPreview{}, err
	}
	return s.repo.PreviewCommands(ctx, command)
}
func (s *Service) CommandReceipt(ctx context.Context, scope DirectoryScope, id string) (CommandResult, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Read); err != nil {
		return CommandResult{}, err
	}
	if !validBlockID(id) {
		return CommandResult{}, fault.Field("path.operation_id", "操作 ID 必须是标准 UUID")
	}
	return s.repo.CommandReceipt(ctx, scope, id)
}

func (s *Service) acquireCommand(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case s.commands <- struct{}{}:
		return nil
	default:
		return fault.New(fault.Unavailable, "DOCUMENT_OPERATIONS_BUSY", "文档编辑繁忙，请稍后重试")
	}
}
