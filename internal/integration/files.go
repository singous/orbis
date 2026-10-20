package integration

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"regexp"

	"orbis.local/orbis/internal/asset"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
)

const MaxAgentUploadBytes int64 = 20 << 20

type UploadInput struct {
	OperationID string `json:"operation_id"`
	SHA256      string `json:"sha256"`
	SizeBytes   int64  `json:"size_bytes"`
	Filename    string `json:"filename"`
	MediaHint   string `json:"media_hint"`
}
type FileMetadata struct {
	ID          string `json:"id"`
	Filename    string `json:"filename"`
	MediaType   string `json:"media_type"`
	SizeBytes   int64  `json:"size_bytes"`
	SHA256      string `json:"sha256"`
	CreatedAtMS int64  `json:"created_at_ms"`
}
type UploadedFile struct {
	FileMetadata
	DocumentID    string           `json:"document_id"`
	OperationID   string           `json:"operation_id"`
	BlockTemplate document.Payload `json:"block_template"`
}
type UploadState struct {
	Asset     asset.Record
	Completed *UploadedFile
}
type UploadObject func(context.Context, asset.Record) (asset.Metadata, error)

func FileInfo(file asset.Record) FileMetadata {
	return FileMetadata{ID: file.ID, Filename: file.Filename, MediaType: file.MediaType, SizeBytes: file.SizeBytes, SHA256: file.SHA256, CreatedAtMS: file.CreatedAtMS}
}
func (l *Library) Upload(ctx context.Context, p Principal, did string, input UploadInput, reader io.Reader) (UploadedFile, error) {
	if err := p.Require(DocumentsWrite); err != nil {
		return UploadedFile{}, err
	}
	if err := p.Require(AssetsWrite); err != nil {
		return UploadedFile{}, err
	}
	if !validResourceID(did) || !validResourceID(input.OperationID) {
		return UploadedFile{}, fault.Field("query.operation_id", "文档或操作 ID 不正确")
	}
	if input.SizeBytes < 0 || input.SizeBytes > l.maxUploadBytes || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(input.SHA256) {
		return UploadedFile{}, fault.Field("query", "附件大小或 SHA-256 不正确")
	}
	input.Filename = asset.Filename(input.Filename)
	if input.MediaHint == "" {
		input.MediaHint = "application/octet-stream"
	}
	if err := l.acquire(ctx); err != nil {
		return UploadedFile{}, err
	}
	defer func() { <-l.codecs }()
	hash, err := RequestHash("upload", did, input)
	if err != nil {
		return UploadedFile{}, err
	}
	state, err := l.repo.BeginUpload(ctx, p, did, input, hash, l.clock.Now().UnixMilli())
	if err != nil {
		return UploadedFile{}, err
	}
	if state.Completed != nil {
		return *state.Completed, nil
	}
	return l.repo.PublishUpload(ctx, p, did, input, hash, func(ctx context.Context, file asset.Record) (asset.Metadata, error) {
		current, openErr := l.objects.Open(ctx, file.StorageKey)
		if openErr == nil {
			metadata, err := inspectObject(ctx, current, input.MediaHint, l.maxUploadBytes)
			closeErr := current.Close()
			if err == nil && closeErr == nil && metadata.SizeBytes == input.SizeBytes && metadata.SHA256 == input.SHA256 {
				return metadata, nil
			}
			if err != nil && !errors.Is(err, asset.ErrTooLarge) {
				return asset.Metadata{}, err
			}
			if closeErr != nil {
				return asset.Metadata{}, closeErr
			}
			if err := l.objects.Remove(ctx, file.StorageKey); err != nil {
				return asset.Metadata{}, err
			}
		} else if !errors.Is(openErr, fs.ErrNotExist) {
			return asset.Metadata{}, openErr
		}
		capture := &captureReader{reader: reader}
		size, digest, err := l.objects.Put(ctx, file.StorageKey, capture, l.maxUploadBytes)
		if err != nil {
			return asset.Metadata{}, err
		}
		if size != input.SizeBytes || digest != input.SHA256 {
			mismatch := fault.New(fault.Validation, "UPLOAD_DIGEST_MISMATCH", "附件大小或 SHA-256 与声明不一致")
			return asset.Metadata{}, errors.Join(mismatch, l.objects.Remove(ctx, file.StorageKey))
		}
		return asset.Metadata{SizeBytes: size, SHA256: digest, MediaType: asset.MediaType(capture.prefix, input.MediaHint)}, nil
	})
}

type captureReader struct {
	reader io.Reader
	prefix []byte
}

func (r *captureReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	if len(r.prefix) < 512 {
		r.prefix = append(r.prefix, p[:min(n, 512-len(r.prefix))]...)
	}
	return n, err
}
func inspectObject(ctx context.Context, reader io.Reader, hint string, limit int64) (asset.Metadata, error) {
	capture := &captureReader{reader: reader}
	hash := sha256.New()
	buffer := make([]byte, 32<<10)
	var size int64
	for {
		if err := ctx.Err(); err != nil {
			return asset.Metadata{}, err
		}
		n, err := capture.Read(buffer)
		if n > 0 {
			size += int64(n)
			if size > limit {
				return asset.Metadata{}, asset.ErrTooLarge
			}
			hash.Write(buffer[:n])
		}
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return asset.Metadata{}, err
		}
	}
	return asset.Metadata{SizeBytes: size, SHA256: hex.EncodeToString(hash.Sum(nil)), MediaType: asset.MediaType(capture.prefix, hint)}, nil
}
func (l *Library) File(ctx context.Context, p Principal, did, id string) (asset.Record, error) {
	if err := p.Require(AssetsRead); err != nil {
		return asset.Record{}, err
	}
	if err := p.Require(DocumentsRead); err != nil {
		return asset.Record{}, err
	}
	if !validResourceID(did) || !validResourceID(id) {
		return asset.Record{}, ScopeMissing()
	}
	return l.repo.File(ctx, p, did, id)
}
