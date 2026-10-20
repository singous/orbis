package integration

import (
	"context"
	"encoding/json"

	"orbis.local/orbis/internal/document/markdown"
	"orbis.local/orbis/internal/platform/fault"
)

const MaxAgentExportBytes = 8 << 20

type LibraryExport struct {
	DocumentID        string          `json:"document_id"`
	ContentVersion    int64           `json:"content_version"`
	Format            string          `json:"format"`
	Complete          bool            `json:"complete"`
	Content           any             `json:"content"`
	Losses            []markdown.Loss `json:"losses"`
	PreservesBlockIDs bool            `json:"preserves_block_ids"`
}

func (l *Library) Export(ctx context.Context, q LibraryQuery, format string) (LibraryExport, error) {
	if err := q.Principal.Require(DocumentsRead); err != nil {
		return LibraryExport{}, err
	}
	if q.Version < 1 || !validResourceID(q.DocumentID) {
		return LibraryExport{}, fault.Field("query.version", "导出须明确指定文档快照版本")
	}
	if format != "json" && format != "markdown" {
		return LibraryExport{}, fault.Field("query.format", "仅支持 json 或 markdown")
	}
	if err := l.acquire(ctx); err != nil {
		return LibraryExport{}, err
	}
	defer func() { <-l.codecs }()
	q.Format = format
	snapshot, err := l.repo.Export(ctx, q)
	if err != nil {
		return LibraryExport{}, err
	}
	result := LibraryExport{DocumentID: q.DocumentID, ContentVersion: snapshot.Content.Revision.Version, Format: format, Complete: true, Losses: []markdown.Loss{}, PreservesBlockIDs: format == "json"}
	if format == "json" {
		encoded, err := json.Marshal(snapshot.Content.Blocks)
		if err != nil {
			return LibraryExport{}, err
		}
		if len(encoded) > MaxAgentExportBytes {
			return LibraryExport{}, fault.New(fault.TooLarge, "EXPORT_BUDGET_EXCEEDED", "文档超过 8 MiB 同步导出预算，请分页读取")
		}
		result.Content = snapshot.Content.Blocks
	} else {
		data, err := markdown.RenderWithAssetURL(ctx, snapshot.Content.Blocks, snapshot.Tables, func(id string) string {
			return "/api/v1/agent/workspaces/" + q.Principal.Token.WorkspaceID + "/documents/" + q.DocumentID + "/assets/" + id + "/content"
		})
		if err != nil {
			return LibraryExport{}, err
		}
		if len(data) > MaxAgentExportBytes {
			return LibraryExport{}, fault.New(fault.TooLarge, "EXPORT_BUDGET_EXCEEDED", "文档超过 8 MiB 同步导出预算，请分页读取")
		}
		result.Content = string(data)
		result.Losses = markdown.Losses(snapshot.Content.Blocks)
	}
	return result, nil
}
