package asset

import (
	"bytes"
	"context"
	"errors"
	"io"

	"orbis.local/orbis/internal/identity"
	"orbis.local/orbis/internal/platform/fault"
)

func profileVersion(expected int64, field string) error {
	if expected < 1 || expected > identity.MaxProfileVersion {
		return fault.Field(field, "资料版本号超出范围")
	}
	return nil
}
func (s *Service) SetAvatar(ctx context.Context, actor string, expected int64, reader io.Reader) (identity.User, error) {
	if err := profileVersion(expected, "query.expected_version"); err != nil {
		return identity.User{}, err
	}
	if err := s.acquire(ctx); err != nil {
		return identity.User{}, err
	}
	defer func() { <-s.uploads }()
	data, err := io.ReadAll(io.LimitReader(reader, MaxAvatarBytes+1))
	if err != nil {
		return identity.User{}, err
	}
	if int64(len(data)) > MaxAvatarBytes {
		return identity.User{}, fault.New(fault.TooLarge, "AVATAR_TOO_LARGE", "头像图片不能超过 2 MiB")
	}
	clean, err := s.images.Normalize(ctx, data)
	if errors.Is(err, ErrInvalidImage) {
		return identity.User{}, fault.New(fault.Validation, "AVATAR_INVALID_IMAGE", "请选择有效的 PNG、JPEG 或 WebP 静态图片，且不超过 16,777,216 像素")
	}
	if err != nil {
		return identity.User{}, err
	}
	row := s.staging(actor, "avatar", "avatar.png", nil)
	if err := s.repo.Begin(ctx, row); err != nil {
		return identity.User{}, err
	}
	return s.repo.PublishAvatar(ctx, actor, row.ID, expected, func(ctx context.Context) (Metadata, error) {
		return s.write(ctx, row.StorageKey, bytes.NewReader(clean), MaxAvatarBytes, "image/png")
	})
}
func (s *Service) Avatar(ctx context.Context, actor string) (Record, error) {
	return s.repo.Avatar(ctx, actor)
}
func (s *Service) ClearAvatar(ctx context.Context, actor string, expected int64) (identity.User, error) {
	if err := profileVersion(expected, "body.expected_version"); err != nil {
		return identity.User{}, err
	}
	return s.repo.ClearAvatar(ctx, actor, expected)
}
