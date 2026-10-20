package integration

import (
	"context"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
	"strings"
	"unicode/utf8"
)

const MaxSearchAnchors = 3

type SearchAnchor struct {
	BlockID       string `json:"block_id"`
	BlockRevision int64  `json:"block_revision"`
	Snippet       string `json:"snippet"`
}
type SearchHit struct {
	Document document.Document
	Anchors  []SearchAnchor
}

func (l *Library) Search(ctx context.Context, q LibraryQuery) ([]SearchHit, int64, error) {
	if err := q.Principal.Require(DocumentsRead); err != nil {
		return nil, 0, err
	}
	q.Text = strings.TrimSpace(q.Text)
	if utf8.RuneCountInString(q.Text) > 240 || strings.ContainsRune(q.Text, 0) {
		return nil, 0, fault.Field("query.q", "搜索内容不能超过 240 字符")
	}
	if q.CollectionID != nil && !validResourceID(*q.CollectionID) {
		return nil, 0, fault.Field("query.collection_id", "文集 ID 不正确")
	}
	if q.Text == "" {
		return []SearchHit{}, 0, nil
	}
	return l.repo.Search(ctx, q)
}
