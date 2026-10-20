package document

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"strings"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/internal/workspace"
)

const (
	CollaborationProtocolVersion = 1
	MaxCollaborationUpdateBytes  = 16 << 20
	MaxCollaborationStateBytes   = 32 << 20
	// Containers and their own editable heads can both carry a block identity.
	MaxCollaborationTargets = 2 * MaxBlocks
)

// CollaborationEngine transforms persistent CRDT identity into the native read projection.
// Implementations do not authorize users, own transactions, or acknowledge persistence.
type CollaborationEngine interface {
	Transform(context.Context, CollaborationTransform) (CollaborationTransformResult, error)
}

type CollaborationTransform struct {
	State   []byte                `json:"state"`
	Blocks  *[]Block              `json:"blocks"`
	Update  []byte                `json:"update"`
	Targets []CollaborationTarget `json:"targets,omitempty"`
}

type CollaborationTarget struct {
	Client      uint64 `json:"client"`
	Clock       int64  `json:"clock"`
	ContentHash string `json:"content_hash,omitempty"`
}

type CollaborationTransformResult struct {
	State       []byte  `json:"state"`
	Update      []byte  `json:"update"`
	Blocks      []Block `json:"blocks"`
	Changed     bool    `json:"changed"`
	StateVector []byte  `json:"state_vector"`
}

type CollaborationState struct {
	DocumentID      string   `json:"document_id"`
	Epoch           string   `json:"epoch"`
	ContentVersion  int64    `json:"content_version"`
	ProtocolVersion int      `json:"protocol_version"`
	State           []byte   `json:"state"`
	StateVector     []byte   `json:"state_vector"`
	UpdatedAtMS     int64    `json:"updated_at_ms"`
	Updates         [][]byte `json:"updates,omitempty"`
}

type CollaborationUpdate struct {
	OperationID string                `json:"operation_id"`
	Epoch       string                `json:"epoch"`
	Update      []byte                `json:"update"`
	TableCopies []TableCopy           `json:"table_copies,omitempty"`
	Targets     []CollaborationTarget `json:"targets,omitempty"`
}

type CollaborationCommit struct {
	Scope       DirectoryScope
	Input       CollaborationUpdate
	RequestHash string
	Timestamp   int64
}

type CollaborationResult struct {
	DocumentID     string          `json:"document_id"`
	OperationID    string          `json:"operation_id"`
	Epoch          string          `json:"epoch"`
	ContentVersion int64           `json:"content_version"`
	Changed        bool            `json:"changed"`
	ResolvedBlocks []ResolvedBlock `json:"resolved_blocks,omitempty"`
}

// CollaborationRepository keeps binary state, native blocks, history and receipts atomic.
type CollaborationRepository interface {
	CollaborationAvailable() bool
	EnableCollaboration(context.Context, DirectoryScope, int64) (CollaborationState, error)
	ReadCollaboration(context.Context, DirectoryScope, int64) (CollaborationState, bool, error)
	CommitCollaboration(context.Context, CollaborationCommit) (CollaborationResult, error)
}

func (s *Service) CollaborationAvailable() bool {
	r, ok := s.repo.(CollaborationRepository)
	return ok && r.CollaborationAvailable()
}

func (s *Service) EnableCollaboration(ctx context.Context, scope DirectoryScope) (CollaborationState, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Edit); err != nil {
		return CollaborationState{}, err
	}
	r, ok := s.repo.(CollaborationRepository)
	if !ok || !r.CollaborationAvailable() {
		return CollaborationState{}, CollaborationUnavailable()
	}
	if err := s.acquireCommand(ctx); err != nil {
		return CollaborationState{}, err
	}
	defer func() { <-s.commands }()
	return r.EnableCollaboration(ctx, scope, s.clock.Now().UnixMilli())
}

// ReadCollaboration checks current visibility even when no newer snapshot exists.
func (s *Service) ReadCollaboration(ctx context.Context, scope DirectoryScope, after int64) (CollaborationState, bool, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Read); err != nil {
		return CollaborationState{}, false, err
	}
	r, ok := s.repo.(CollaborationRepository)
	if !ok || !r.CollaborationAvailable() {
		return CollaborationState{}, false, CollaborationUnavailable()
	}
	return r.ReadCollaboration(ctx, scope, after)
}

func (s *Service) ApplyCollaboration(ctx context.Context, scope DirectoryScope, input CollaborationUpdate) (CollaborationResult, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Edit); err != nil {
		return CollaborationResult{}, err
	}
	for field, value := range map[string]string{"operation_id": input.OperationID, "epoch": input.Epoch} {
		id, err := uuid.Parse(value)
		if err != nil || id == uuid.Nil || id.String() != value {
			return CollaborationResult{}, fault.Field("body."+field, "标识必须是标准 UUID")
		}
	}
	if len(input.Update) > MaxCollaborationUpdateBytes {
		return CollaborationResult{}, fault.New(fault.TooLarge, "COLLABORATION_TOO_LARGE", "正文协同更新超过容量限制，本机修改仍保留")
	}
	if len(input.Update) == 0 {
		return CollaborationResult{}, fault.Field("body.update", "协同更新不能为空")
	}
	if len(input.Targets) > MaxCollaborationTargets {
		return CollaborationResult{}, fault.Field("body.targets", "修改目标超过文档容量限制")
	}
	for _, target := range input.Targets {
		if target.Client > 1<<32-1 || target.Clock < 0 || target.Clock > MaxVersion {
			return CollaborationResult{}, fault.Field("body.targets", "修改目标标识无效")
		}
		if target.ContentHash != "" {
			decoded, err := hex.DecodeString(target.ContentHash)
			if err != nil || len(decoded) != 32 || strings.ToLower(target.ContentHash) != target.ContentHash {
				return CollaborationResult{}, fault.Field("body.targets", "修改目标内容校验值无效")
			}
		}
	}
	r, ok := s.repo.(CollaborationRepository)
	if !ok || !r.CollaborationAvailable() {
		return CollaborationResult{}, CollaborationUnavailable()
	}
	if err := s.acquireCommand(ctx); err != nil {
		return CollaborationResult{}, err
	}
	defer func() { <-s.commands }()
	encoded, err := json.Marshal(input)
	if err != nil {
		return CollaborationResult{}, err
	}
	return r.CommitCollaboration(ctx, CollaborationCommit{Scope: scope, Input: input, RequestHash: security.Digest("document.crdt.v1:" + string(encoded)), Timestamp: s.clock.Now().UnixMilli()})
}

func CollaborationUnavailable() error {
	return fault.New(fault.Unavailable, "COLLABORATION_UNAVAILABLE", "正文协同服务暂时不可用，本机修改仍保留")
}
