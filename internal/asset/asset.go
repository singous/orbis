// Package asset owns private file uploads, avatar changes, and object lifecycle rules.
package asset

import (
	"context"
	"encoding/binary"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/identity"
	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/workspace"
)

const MaxAvatarBytes int64 = 2 << 20
const MaxFilenameLength = 255
const UploadConcurrency = 2
const CleanupBatch = 100
const Retention = time.Hour

var ErrTooLarge = errors.New("upload exceeds size limit")
var ErrInvalidImage = errors.New("invalid avatar image")

type Scope struct{ ActorID, WorkspaceID string }
type Record struct {
	ID, OwnerID                                          string
	WorkspaceID                                          *string
	Kind, State, StorageKey, Filename, MediaType, SHA256 string
	SizeBytes, CreatedAtMS, UpdatedAtMS                  int64
	RetiredAtMS                                          *int64
}
type Metadata struct {
	MediaType, SHA256 string
	SizeBytes         int64
}
type WriteObject func(context.Context) (Metadata, error)
type Store interface {
	Put(context.Context, string, io.Reader, int64) (int64, string, error)
	Open(context.Context, string) (io.ReadSeekCloser, error)
	Remove(context.Context, string) error
}
type Images interface {
	Normalize(context.Context, []byte) ([]byte, error)
}
type Access interface {
	Require(context.Context, string, string, workspace.Permission) error
}
type Repository interface {
	PublishIcon(context.Context, Scope, string, WriteObject) (Record, error)
	Begin(context.Context, Record) error
	PublishFile(context.Context, Scope, string, WriteObject) (Record, error)
	File(context.Context, Scope, string) (Record, error)
	List(context.Context, Scope, pagination.Page) ([]Record, int64, error)
	PublishAvatar(context.Context, string, string, int64, WriteObject) (identity.User, error)
	Avatar(context.Context, string) (Record, error)
	ClearAvatar(context.Context, string, int64) (identity.User, error)
	Cleanup(context.Context, func(context.Context, string) error) (int, error)
}
type Service struct {
	repo     Repository
	access   Access
	store    Store
	images   Images
	clock    clock.Clock
	maxBytes int64
	uploads  chan struct{}
}

func New(repo Repository, access Access, store Store, images Images, clock clock.Clock, maxBytes int64) *Service {
	return &Service{repo: repo, access: access, store: store, images: images, clock: clock, maxBytes: maxBytes, uploads: make(chan struct{}, UploadConcurrency)}
}
func (s *Service) acquire(ctx context.Context) error {
	select {
	case s.uploads <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func Filename(raw string) string {
	raw = path.Base(strings.ReplaceAll(raw, "\\", "/"))
	raw = strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, raw))
	chars := []rune(raw)
	if len(chars) > MaxFilenameLength {
		raw = string(chars[:MaxFilenameLength])
	}
	if raw == "" || raw == "." || raw == "/" {
		return "download"
	}
	return raw
}
func (s *Service) staging(actor, kind, filename string, wid *string) Record {
	id := uuid.NewString()
	now := s.clock.Now().UnixMilli()
	return Record{
		ID:          id,
		OwnerID:     actor,
		WorkspaceID: wid,
		Kind:        kind,
		State:       "staging",
		StorageKey:  id + ".blob",
		Filename:    Filename(filename),
		MediaType:   "application/octet-stream",
		CreatedAtMS: now,
		UpdatedAtMS: now,
	}
}
func (s *Service) Upload(ctx context.Context, scope Scope, filename, hint string, reader io.Reader) (Record, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Edit); err != nil {
		return Record{}, err
	}
	if err := s.acquire(ctx); err != nil {
		return Record{}, err
	}
	defer func() { <-s.uploads }()
	row := s.staging(scope.ActorID, "file", filename, &scope.WorkspaceID)
	if err := s.repo.Begin(ctx, row); err != nil {
		return Record{}, err
	}
	result, err := s.repo.PublishFile(ctx, scope, row.ID, func(ctx context.Context) (Metadata, error) {
		return s.write(ctx, row.StorageKey, reader, s.maxBytes, hint)
	})
	return result, uploadError(err)
}
func (s *Service) write(ctx context.Context, key string, reader io.Reader, limit int64, hint string) (Metadata, error) {
	capture := &prefixReader{reader: reader}
	size, hash, err := s.store.Put(ctx, key, capture, limit)
	return Metadata{SizeBytes: size, SHA256: hash, MediaType: MediaType(capture.prefix, hint)}, err
}

type prefixReader struct {
	reader io.Reader
	prefix []byte
}

func (r *prefixReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	if missing := 512 - len(r.prefix); missing > 0 {
		r.prefix = append(r.prefix, p[:min(n, missing)]...)
	}
	return n, err
}
func uploadError(err error) error {
	if errors.Is(err, ErrTooLarge) {
		return fault.New(fault.TooLarge, "FILE_TOO_LARGE", "文件超出上传大小限制")
	}
	return err
}
func (s *Service) List(ctx context.Context, scope Scope, page pagination.Page) ([]Record, int64, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Read); err != nil {
		return nil, 0, err
	}
	return s.repo.List(ctx, scope, page)
}
func (s *Service) File(ctx context.Context, scope Scope, id string) (Record, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Read); err != nil {
		return Record{}, err
	}
	return s.repo.File(ctx, scope, id)
}
func (s *Service) Open(ctx context.Context, row Record) (io.ReadSeekCloser, error) {
	content, err := s.store.Open(ctx, row.StorageKey)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, fault.Missing()
	}
	return content, err
}
func (s *Service) Cleanup(ctx context.Context) (int, error) {
	return s.repo.Cleanup(ctx, s.store.Remove)
}

// MediaType trusts byte signatures; hints only distinguish inert variants of one container.
func MediaType(prefix []byte, hint string) string {
	if len(prefix) >= 16 && string(prefix[4:8]) == "ftyp" {
		size := int64(binary.BigEndian.Uint32(prefix[:4]))
		if size >= 16 && size <= int64(len(prefix)) && size%4 == 0 {
			for offset := 8; offset < int(size); offset += 4 {
				if offset == 12 {
					continue
				}
				switch string(prefix[offset : offset+4]) {
				case "avif", "avis":
					return "image/avif"
				case "qt  ":
					return "video/quicktime"
				}
			}
		}
	}
	detected := strings.Split(http.DetectContentType(prefix), ";")[0]
	hint = strings.ToLower(strings.TrimSpace(strings.Split(hint, ";")[0]))
	if detected == "video/mp4" && hint == "audio/mp4" {
		return hint
	}
	if detected == "video/webm" && hint == "audio/webm" {
		return hint
	}
	if detected == "application/ogg" {
		if hint == "video/ogg" {
			return hint
		}
		return "audio/ogg"
	}
	if len(prefix) >= 4 && string(prefix[:4]) == "fLaC" {
		return "audio/flac"
	}
	if len(prefix) >= 2 && prefix[0] == 0xff && prefix[1]&0xf6 == 0xf0 {
		return "audio/aac"
	}
	return detected
}
func InlineType(media string) bool {
	switch media {
	case "image/avif", "image/gif", "image/jpeg", "image/png", "image/webp",
		"audio/aac", "audio/flac", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wave", "audio/wav", "audio/webm",
		"video/mp4", "video/ogg", "video/quicktime", "video/webm":
		return true
	}
	return false
}
