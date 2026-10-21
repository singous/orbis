package storage_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/asset"
	"orbis.local/orbis/internal/platform/storage"
)

func TestLocalObjectsAreImmutablePrivateAndBounded(t *testing.T) {
	root := t.TempDir()
	store, err := storage.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	key := uuid.NewString() + ".blob"
	data := []byte("object bytes")
	hash := sha256.Sum256(data)
	size, digest, err := store.Put(t.Context(), key, bytes.NewReader(data), 100)
	if err != nil || size != int64(len(data)) || digest != hex.EncodeToString(hash[:]) {
		t.Fatalf("write metadata: %d %q %v", size, digest, err)
	}
	if _, _, err := store.Put(t.Context(), key, bytes.NewReader([]byte("replacement")), 100); err == nil {
		t.Fatal("immutable object was overwritten")
	}
	file, err := store.Open(t.Context(), key)
	if err != nil {
		t.Fatal(err)
	}
	contents, err := io.ReadAll(file)
	_ = file.Close()
	if err != nil || !bytes.Equal(contents, data) {
		t.Fatal("object content changed")
	}
	stat, err := os.Stat(filepath.Join(root, key))
	if err != nil {
		t.Fatal(err)
	}
	if stat.Mode().Perm() != 0600 {
		t.Fatal("object permissions are not private")
	}
	tooBig := uuid.NewString() + ".blob"
	if _, _, err := store.Put(t.Context(), tooBig, bytes.NewReader(data), 2); !errors.Is(err, asset.ErrTooLarge) {
		t.Fatalf("missing size error: %v", err)
	}
	if _, err := store.Open(t.Context(), tooBig); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("failed upload left bytes")
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, _, err := store.Put(ctx, uuid.NewString()+".blob", bytes.NewReader(data), 100); !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled write succeeded")
	}
	if err := store.Remove(t.Context(), key); err != nil {
		t.Fatal(err)
	}
	if err := store.Remove(t.Context(), key); err != nil {
		t.Fatal("removal is not idempotent")
	}
}
func TestLocalStorageRejectsPathsAndSymlinks(t *testing.T) {
	root := t.TempDir()
	store, err := storage.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	for _, key := range []string{"../escape", "/absolute", "file.txt", uuid.NewString() + ".blob/"} {
		if _, _, err := store.Put(t.Context(), key, bytes.NewReader(nil), 10); err == nil {
			t.Fatal("invalid key accepted")
		}
		if _, err := store.Open(t.Context(), key); err == nil {
			t.Fatal("invalid key opened")
		}
		if err := store.Remove(t.Context(), key); err == nil {
			t.Fatal("invalid key removed")
		}
	}
	target := filepath.Join(t.TempDir(), "outside")
	if err := os.WriteFile(target, []byte("outside bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	key := uuid.NewString() + ".blob"
	if err := os.Symlink(target, filepath.Join(root, key)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Open(t.Context(), key); err == nil {
		t.Fatal("symlink was served")
	}
	if _, _, err := store.Put(t.Context(), key, bytes.NewReader([]byte("overwrite")), 100); err == nil {
		t.Fatal("symlink was overwritten")
	}
	actual, err := os.ReadFile(target)
	if err != nil || string(actual) != "outside bytes" {
		t.Fatal("external file was modified")
	}
}

type cancelledReader struct{ cancel context.CancelFunc }

func (r cancelledReader) Read(p []byte) (int, error) { r.cancel(); return copy(p, "partial"), nil }
func TestInterruptedObjectWriteRemovesPartialFile(t *testing.T) {
	root := t.TempDir()
	store, err := storage.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	key := uuid.NewString() + ".blob"
	if _, _, err := store.Put(ctx, key, cancelledReader{cancel: cancel}, 100); !errors.Is(err, context.Canceled) {
		t.Fatal("write did not preserve cancellation")
	}
	files, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 0 {
		t.Fatal("cancelled write left a partial object")
	}
}
