package integration

import (
	"context"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
)

func (l *Library) DocumentVersions(ctx context.Context, q LibraryQuery) (document.VersionPage, error) {
	if err := q.Principal.Require(DocumentsRead); err != nil {
		return document.VersionPage{}, err
	}
	if !validResourceID(q.DocumentID) {
		return document.VersionPage{}, ScopeMissing()
	}
	return l.repo.DocumentVersions(ctx, q)
}

func (l *Library) DocumentVersion(ctx context.Context, q LibraryQuery, id string) (document.Version, document.Content, error) {
	if err := q.Principal.Require(DocumentsRead); err != nil {
		return document.Version{}, document.Content{}, err
	}
	if !validResourceID(q.DocumentID) {
		return document.Version{}, document.Content{}, ScopeMissing()
	}
	return l.repo.DocumentVersion(ctx, q, id)
}

func (l *Library) CompareDocumentVersions(ctx context.Context, q LibraryQuery, from, to string) (document.VersionComparison, error) {
	if err := q.Principal.Require(DocumentsRead); err != nil {
		return document.VersionComparison{}, err
	}
	if !validResourceID(q.DocumentID) {
		return document.VersionComparison{}, ScopeMissing()
	}
	return l.repo.CompareDocumentVersions(ctx, q, from, to)
}

func (l *Library) SaveDocumentVersion(ctx context.Context, p Principal, did string, input document.CreateVersion) (document.Version, error) {
	if !validResourceID(input.OperationID) {
		return document.Version{}, fault.Field("body.operation_id", "操作标识无效")
	}
	if err := p.Require(DocumentsWrite); err != nil {
		return document.Version{}, err
	}
	if !validResourceID(did) {
		return document.Version{}, ScopeMissing()
	}
	return l.repo.SaveDocumentVersion(ctx, p, did, input)
}

func (l *Library) EditDocumentVersion(ctx context.Context, p Principal, did, id string, input document.EditVersion) (document.Version, error) {
	if !validResourceID(input.OperationID) {
		return document.Version{}, fault.Field("body.operation_id", "操作标识无效")
	}
	if err := p.Require(DocumentsWrite); err != nil {
		return document.Version{}, err
	}
	if !validResourceID(did) {
		return document.Version{}, ScopeMissing()
	}
	return l.repo.EditDocumentVersion(ctx, p, did, id, input)
}

func (l *Library) RestoreDocumentVersion(ctx context.Context, p Principal, did, id, operation string, expected int64) (document.Content, error) {
	if !validResourceID(operation) {
		return document.Content{}, fault.Field("body.operation_id", "操作标识无效")
	}
	if err := p.Require(DocumentsWrite); err != nil {
		return document.Content{}, err
	}
	if !validResourceID(did) {
		return document.Content{}, ScopeMissing()
	}
	return l.repo.RestoreDocumentVersion(ctx, p, did, id, operation, expected)
}
