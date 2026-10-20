package asset

import (
	"bytes"
	"context"
	"errors"
	"io"

	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/workspace"
)

const MaxCollectionIconBytes int64 = 2 << 20

// UploadCollectionIcon reuses the static-image codec and publishes a workspace-owned normalized file.
func (s *Service) UploadCollectionIcon(ctx context.Context, scope Scope, reader io.Reader) (Record, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, workspace.Edit); err != nil {
		return Record{}, err
	}
	if err := s.acquire(ctx); err != nil {
		return Record{}, err
	}
	defer func() { <-s.uploads }()
	data, err := io.ReadAll(io.LimitReader(reader, MaxCollectionIconBytes+1))
	if err != nil {
		return Record{}, err
	}
	if int64(len(data)) > MaxCollectionIconBytes {
		return Record{}, fault.New(fault.TooLarge, "COLLECTION_ICON_TOO_LARGE", "图标图片不能超过 2 MiB")
	}
	clean, err := s.images.Normalize(ctx, data)
	if errors.Is(err, ErrInvalidImage) {
		return Record{}, fault.New(fault.Validation, "COLLECTION_ICON_INVALID_IMAGE", "请选择有效的 PNG、JPEG 或 WebP 静态图片，且不超过 16,777,216 像素")
	}
	if err != nil {
		return Record{}, err
	}
	row := s.staging(scope.ActorID, "file", "collection-icon.png", &scope.WorkspaceID)
	if err := s.repo.Begin(ctx, row); err != nil {
		return Record{}, err
	}
	return s.repo.PublishIcon(ctx, scope, row.ID, func(ctx context.Context) (Metadata, error) {
		return s.write(ctx, row.StorageKey, bytes.NewReader(clean), MaxCollectionIconBytes, "image/png")
	})
}
