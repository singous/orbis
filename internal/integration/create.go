package integration

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/document/markdown"
	"orbis.local/orbis/internal/platform/fault"
)

type CreateDocumentInput struct {
	OperationID  string  `json:"operation_id"`
	CollectionID string  `json:"collection_id"`
	ParentID     *string `json:"parent_id"`
	Title        string  `json:"title"`
	Markdown     string  `json:"markdown"`
}
type CreateDocumentCommand struct {
	Principal Principal
	Input     CreateDocumentInput
	Parsed    markdown.Parsed
	Hash      string
	Timestamp int64
}
type CreatedDocument struct {
	DocumentID     string             `json:"document_id"`
	CollectionID   string             `json:"collection_id"`
	OperationID    string             `json:"operation_id"`
	ContentVersion int64              `json:"content_version"`
	Title          string             `json:"title"`
	URL            string             `json:"url"`
	Warnings       []markdown.Warning `json:"warnings"`
	CreatedAtMS    int64              `json:"created_at_ms"`
}

func (l *Library) Create(ctx context.Context, p Principal, input CreateDocumentInput) (CreatedDocument, error) {
	if err := p.Require(DocumentsWrite); err != nil {
		return CreatedDocument{}, err
	}
	if p.Token.DocumentID != nil {
		return CreatedDocument{}, fault.New(fault.Forbidden, "INTEGRATION_SCOPE_FORBIDDEN", "精确文档令牌不能创建其他文档")
	}
	if !validResourceID(input.OperationID) || !validResourceID(input.CollectionID) || (input.ParentID != nil && !validResourceID(*input.ParentID)) {
		return CreatedDocument{}, fault.Field("body", "操作、文集或父文档 ID 不正确")
	}
	input.Title = strings.TrimSpace(input.Title)
	if n := utf8.RuneCountInString(input.Title); n < 1 || n > 240 || strings.ContainsRune(input.Title, 0) {
		return CreatedDocument{}, fault.Field("body.title", "标题须为 1 至 240 个字符")
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return CreatedDocument{}, err
	}
	if len(encoded) > document.MaxAgentOperationBytes {
		return CreatedDocument{}, fault.New(fault.TooLarge, "OPERATIONS_TOO_LARGE", "创建请求不能超过 1 MiB")
	}
	if err := l.acquire(ctx); err != nil {
		return CreatedDocument{}, err
	}
	defer func() { <-l.codecs }()
	parsed, err := markdown.Parse(ctx, input.Markdown, p.Token.WorkspaceID)
	if err != nil {
		return CreatedDocument{}, err
	}
	hash, err := RequestHash("create", "", input)
	if err != nil {
		return CreatedDocument{}, err
	}
	return l.repo.Create(ctx, CreateDocumentCommand{Principal: p, Input: input, Parsed: parsed, Hash: hash, Timestamp: l.clock.Now().UnixMilli()})
}
