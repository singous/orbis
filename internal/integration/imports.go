package integration

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"github.com/google/uuid"
	"io"
	"strings"
	"unicode/utf8"

	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
)

const MaxStagedImportBytes int64 = 32 << 20
const MaxImportChunkBytes int64 = 256 << 10
const MaxPendingImports = 8

type StagedImportInput struct {
	OperationID  string  `json:"operation_id"`
	CollectionID string  `json:"collection_id"`
	ParentID     *string `json:"parent_id"`
	Title        string  `json:"title"`
	SizeBytes    int64   `json:"size_bytes"`
	SHA256       string  `json:"sha256"`
}
type ImportStatus struct {
	ID            string           `json:"id"`
	OperationID   string           `json:"operation_id"`
	CollectionID  string           `json:"collection_id"`
	State         string           `json:"state"`
	SizeBytes     int64            `json:"size_bytes"`
	ReceivedBytes int64            `json:"received_bytes"`
	ChunkBytes    int64            `json:"chunk_bytes"`
	ErrorCode     *string          `json:"error_code"`
	Result        *CreatedDocument `json:"result"`
	CreatedAtMS   int64            `json:"created_at_ms"`
	UpdatedAtMS   int64            `json:"updated_at_ms"`
	ExpiresAtMS   *int64           `json:"expires_at_ms"`
}
type ImportRepository interface {
	BeginImport(context.Context, Principal, StagedImportInput, string, int64) (ImportStatus, error)
	ImportStatus(context.Context, Principal, string) (ImportStatus, error)
	WriteImportChunk(context.Context, Principal, string, int64, []byte, string) (ImportStatus, error)
	FinalizeImport(context.Context, Principal, string) (ImportStatus, error)
}
type Imports struct {
	repo    ImportRepository
	clock   clock.Clock
	enabled bool
	uploads chan struct{}
}

func NewImports(repo ImportRepository, c clock.Clock, enabled bool) *Imports {
	return &Imports{repo: repo, clock: c, enabled: enabled, uploads: make(chan struct{}, 2)}
}
func (s *Imports) Enabled() bool { return s != nil && s.enabled }
func (s *Imports) Begin(ctx context.Context, p Principal, input StagedImportInput) (ImportStatus, error) {
	if err := p.Require(DocumentsWrite); err != nil {
		return ImportStatus{}, err
	}
	if !s.Enabled() {
		return ImportStatus{}, importUnavailable()
	}
	if p.Token.DocumentID != nil {
		return ImportStatus{}, fault.Denied()
	}
	if !validResourceID(input.OperationID) || !validResourceID(input.CollectionID) || (input.ParentID != nil && !validResourceID(*input.ParentID)) {
		return ImportStatus{}, fault.Field("body", "操作、文集或父文档 ID 不正确")
	}
	input.Title = strings.TrimSpace(input.Title)
	if n := utf8.RuneCountInString(input.Title); n < 1 || n > 240 || strings.ContainsRune(input.Title, 0) {
		return ImportStatus{}, fault.Field("body.title", "标题须为 1 至 240 个字符")
	}
	if input.SizeBytes < 0 || input.SizeBytes > MaxStagedImportBytes {
		return ImportStatus{}, fault.Field("body.size_bytes", "暂存 Markdown 最大为 32 MiB")
	}
	decoded, err := hex.DecodeString(input.SHA256)
	if err != nil || len(decoded) != sha256.Size || strings.ToLower(input.SHA256) != input.SHA256 {
		return ImportStatus{}, fault.Field("body.sha256", "需要小写 SHA-256 摘要")
	}
	hash, err := RequestHash("import", "", input)
	if err != nil {
		return ImportStatus{}, err
	}
	return s.repo.BeginImport(ctx, p, input, hash, s.clock.Now().UnixMilli())
}
func (s *Imports) Status(ctx context.Context, p Principal, id string) (ImportStatus, error) {
	if err := p.Require(DocumentsRead); err != nil {
		return ImportStatus{}, err
	}
	if !validResourceID(id) {
		return ImportStatus{}, fault.Missing()
	}
	return s.repo.ImportStatus(ctx, p, id)
}
func (s *Imports) Chunk(ctx context.Context, p Principal, id string, offset int64, digest string, body io.Reader) (ImportStatus, error) {
	if err := p.Require(DocumentsWrite); err != nil {
		return ImportStatus{}, err
	}
	if !validResourceID(id) || offset < 0 {
		return ImportStatus{}, fault.Field("path", "导入 ID 或偏移不正确")
	}
	select {
	case s.uploads <- struct{}{}:
	default:
		return ImportStatus{}, fault.New(fault.Unavailable, "IMPORT_BUSY", "导入上传繁忙，请稍后重试")
	}
	defer func() { <-s.uploads }()
	data, err := io.ReadAll(io.LimitReader(body, MaxImportChunkBytes+1))
	if err != nil {
		return ImportStatus{}, err
	}
	if len(data) == 0 || int64(len(data)) > MaxImportChunkBytes {
		return ImportStatus{}, fault.Field("body", "每块须为 1 至 262144 字节")
	}
	sum := sha256.Sum256(data)
	if digest != hex.EncodeToString(sum[:]) {
		return ImportStatus{}, fault.New(fault.Validation, "IMPORT_CHUNK_DIGEST_MISMATCH", "分块摘要不匹配")
	}
	return s.repo.WriteImportChunk(ctx, p, id, offset, data, digest)
}
func (s *Imports) Finalize(ctx context.Context, p Principal, id string) (ImportStatus, error) {
	if err := p.Require(DocumentsWrite); err != nil {
		return ImportStatus{}, err
	}
	if !s.Enabled() {
		return ImportStatus{}, importUnavailable()
	}
	if !validResourceID(id) {
		return ImportStatus{}, fault.Missing()
	}
	return s.repo.FinalizeImport(ctx, p, id)
}
func importUnavailable() error {
	return fault.New(fault.Unavailable, "IMPORT_QUEUE_UNAVAILABLE", "异步导入未配置，请使用小文档创建接口")
}

// ImportChunkKey assigns an immutable server key to one acknowledged source interval.
func ImportChunkKey(id string, offset int64) (string, error) {
	namespace, err := uuid.Parse(id)
	if err != nil || namespace == uuid.Nil || namespace.String() != id || offset < 0 {
		return "", errors.New("invalid staged import chunk identity")
	}
	var value [8]byte
	binary.BigEndian.PutUint64(value[:], uint64(offset))
	return uuid.NewSHA1(namespace, value[:]).String() + ".blob", nil
}
