// Package storage implements private local object storage behind asset.Store.
package storage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"strings"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/asset"
)

type Local struct{ root *os.Root }

func NewLocal(directory string) (*Local, error) {
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, fmt.Errorf("create object directory: %w", err)
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, fmt.Errorf("open object directory: %w", err)
	}
	return &Local{root: root}, nil
}
func (s *Local) Close() error { return s.root.Close() }
func validKey(key string) bool {
	id, err := uuid.Parse(strings.TrimSuffix(key, ".blob"))
	return err == nil && id != uuid.Nil && key == id.String()+".blob"
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}

// Put writes a unique staged object. Database state keeps partial bytes invisible until publication.
func (s *Local) Put(ctx context.Context, key string, reader io.Reader, limit int64) (size int64, digest string, result error) {
	if !validKey(key) || limit < 0 {
		return 0, "", fmt.Errorf("invalid object write")
	}
	if err := ctx.Err(); err != nil {
		return 0, "", err
	}
	file, err := s.root.OpenFile(key, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return 0, "", fmt.Errorf("create object: %w", err)
	}
	defer func() {
		result = errors.Join(result, file.Close())
		if result != nil {
			result = errors.Join(result, s.Remove(context.WithoutCancel(ctx), key))
		}
	}()
	if err := file.Chmod(0600); err != nil {
		return 0, "", err
	}
	hash := sha256.New()
	size, err = io.Copy(io.MultiWriter(file, hash), io.LimitReader(contextReader{ctx: ctx, reader: reader}, limit+1))
	if err != nil {
		return size, "", err
	}
	if size > limit {
		return size, "", asset.ErrTooLarge
	}
	if err := ctx.Err(); err != nil {
		return size, "", err
	}
	if err := file.Sync(); err != nil {
		return size, "", err
	}
	dir, err := s.root.Open(".")
	if err != nil {
		return size, "", err
	}
	if err := errors.Join(dir.Sync(), dir.Close()); err != nil {
		return size, "", err
	}
	return size, hex.EncodeToString(hash.Sum(nil)), ctx.Err()
}
func (s *Local) Open(ctx context.Context, key string) (io.ReadSeekCloser, error) {
	if !validKey(key) {
		return nil, fs.ErrNotExist
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	info, err := s.root.Lstat(key)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, fs.ErrNotExist
	}
	file, err := s.root.Open(key)
	if err != nil {
		return nil, err
	}
	info, err = file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		_ = file.Close()
		if err != nil {
			return nil, err
		}
		return nil, fs.ErrNotExist
	}
	return contextObject{ReadSeekCloser: file, ctx: ctx}, nil
}
func (s *Local) Remove(ctx context.Context, key string) error {
	if !validKey(key) {
		return fmt.Errorf("invalid object key")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	err := s.root.Remove(key)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	dir, err := s.root.Open(".")
	if err != nil {
		return err
	}
	return errors.Join(dir.Sync(), dir.Close())
}

// contextObject stops further disk reads once the delivery request is cancelled.
type contextObject struct {
	io.ReadSeekCloser
	ctx context.Context
}

func (f contextObject) Read(data []byte) (int, error) {
	if err := f.ctx.Err(); err != nil {
		return 0, err
	}
	return f.ReadSeekCloser.Read(data)
}
func (f contextObject) Seek(offset int64, whence int) (int64, error) {
	if err := f.ctx.Err(); err != nil {
		return 0, err
	}
	return f.ReadSeekCloser.Seek(offset, whence)
}
