package command

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strconv"
	"strings"

	"orbis.local/orbis/cli/internal/client"
	"orbis.local/orbis/cli/internal/config"
)

const maxBoardExportBytes = 32 * 1024 * 1024

func (r Runtime) boards(ctx context.Context, a arguments, api *client.Client) (client.Envelope, error) {
	f := a.flags
	get := func(path string, query url.Values) (client.Envelope, error) {
		return api.Agent(ctx, "GET", path, client.Request{Query: query, Retries: 2})
	}
	if a.command == "templates" {
		return get("/board-templates", nil)
	}
	if a.command == "catalog" {
		return get("/board-catalog", nil)
	}
	if a.command == "create" {
		body, err := r.jsonFile(f["file"])
		if err != nil {
			return client.Envelope{}, err
		}
		return api.Idempotent(ctx, "/boards", body)
	}
	if a.command == "list" {
		q := url.Values{}
		for _, key := range []string{"page", "page-size", "collection"} {
			if f[key] != "" {
				target := strings.ReplaceAll(key, "-", "_")
				if key == "collection" {
					target = "collection_id"
				}
				q.Set(target, f[key])
			}
		}
		return get("/boards", q)
	}
	id := a.positionals[0]
	if !config.UUID(id) {
		return client.Envelope{}, argError()
	}
	path := "/boards/" + id
	query := url.Values{}
	for _, key := range []string{"revision", "after", "before", "cursor"} {
		if f[key] != "" {
			query.Set(key, f[key])
		}
	}
	switch a.command {
	case "template":
		return r.applyBoardTemplate(ctx, a, api)
	case "get":
		return get(path, query)
	case "elements":
		if !config.UUID(f["board-page"]) {
			return client.Envelope{}, argError()
		}
		return get(path+"/pages/"+f["board-page"]+"/elements", query)
	case "changes", "history":
		return get(path+"/"+a.command, query)
	case "apply":
		body, err := r.jsonFile(f["file"])
		if err != nil {
			return client.Envelope{}, err
		}
		return api.Idempotent(ctx, path+"/commands", body)
	case "export":
		meta, err := get(path, query)
		if err != nil {
			return meta, err
		}
		board := client.Object(meta.Data)
		revision := integer(board["revision"])
		pages, ok := board["pages"].([]any)
		if !ok || revision < 1 {
			return client.Envelope{}, client.Failure("CLI_RESPONSE_INVALID", "画板元数据无效", 7, nil)
		}
		elements := []any{}
		budget := 0
		for _, raw := range pages {
			pageID, ok := client.Object(raw)["id"].(string)
			if !ok || !config.UUID(pageID) {
				return client.Envelope{}, client.Failure("CLI_RESPONSE_INVALID", "画板页面无效", 7, nil)
			}
			cursor := ""
			seen := map[string]bool{}
			for {
				response, err := get(path+"/pages/"+pageID+"/elements", url.Values{"revision": {strconv.FormatInt(revision, 10)}, "cursor": {cursor}})
				if err != nil {
					return response, err
				}
				data := client.Object(response.Data)
				items, ok := data["items"].([]any)
				if !ok || integer(data["revision"]) != revision {
					return client.Envelope{}, client.Failure("CLI_RESPONSE_INVALID", "画板分页版本无效", 7, nil)
				}
				encoded, err := json.Marshal(items)
				if err != nil {
					return client.Envelope{}, err
				}
				budget += len(encoded)
				if budget > maxBoardExportBytes || len(elements)+len(items) > 50_000 {
					return client.Envelope{}, client.Failure("CLI_RESPONSE_BUDGET_EXCEEDED", "画板超过导出预算，请按页面读取", 2, nil)
				}
				elements = append(elements, items...)
				if data["has_more"] != true {
					break
				}
				cursor, ok = data["next_cursor"].(string)
				if !ok || cursor == "" || seen[cursor] {
					return client.Envelope{}, client.Failure("CLI_RESPONSE_INVALID", "画板游标无效", 7, nil)
				}
				seen[cursor] = true
			}
		}
		assets := []map[string]any{}
		seenAssets := map[string]bool{}
		imageBytes := 0
		did, _ := board["document_id"].(string)
		if !config.UUID(did) {
			return client.Envelope{}, client.Failure("CLI_RESPONSE_INVALID", "画板所属文档无效", 7, nil)
		}
		for _, raw := range elements {
			id, _ := client.Object(client.Object(raw)["structure"])["asset_id"].(string)
			if id == "" || seenAssets[id] {
				continue
			}
			seenAssets[id] = true
			if !config.UUID(id) {
				return client.Envelope{}, client.Failure("CLI_RESPONSE_INVALID", "图片标识无效", 7, nil)
			}
			filePath := "/documents/" + did + "/assets/" + id
			info, err := get(filePath, nil)
			if err != nil {
				return info, err
			}
			detail := client.Object(info.Data)
			media, _ := detail["media_type"].(string)
			switch media {
			case "image/png", "image/jpeg", "image/webp", "image/gif":
			default:
				return client.Envelope{}, client.Failure("CLI_RESPONSE_INVALID", "图片格式不支持可编辑导出", 2, nil)
			}
			file, err := api.Agent(ctx, "GET", filePath+"/content", client.Request{Binary: true, Retries: 2})
			if err != nil {
				return file, err
			}
			data, ok := file.Data.([]byte)
			if !ok {
				return client.Envelope{}, client.Failure("CLI_RESPONSE_INVALID", "图片下载无效", 7, nil)
			}
			imageBytes += len(data)
			if imageBytes > 16*1024*1024 {
				return client.Envelope{}, client.Failure("CLI_RESPONSE_BUDGET_EXCEEDED", "图片超过 16 MiB 导出预算", 2, nil)
			}
			assets = append(assets, map[string]any{"id": id, "media_type": media, "data": base64.StdEncoding.EncodeToString(data)})
		}
		rendered, err := json.Marshal(map[string]any{"format": "orbis.board", "schema_version": 1, "board": board, "elements": elements, "assets": assets})
		if err != nil {
			return client.Envelope{}, err
		}
		if len(rendered) > maxBoardExportBytes {
			return client.Envelope{}, client.Failure("CLI_RESPONSE_BUDGET_EXCEEDED", "画板超过导出预算", 2, nil)
		}
		output, err := writeOutput(f["out"], rendered)
		if err != nil {
			return client.Envelope{}, err
		}
		meta.Data = map[string]any{"path": output, "bytes": len(rendered), "revision": revision, "elements": len(elements)}
		return meta, nil
	}
	return client.Envelope{}, argError()
}
