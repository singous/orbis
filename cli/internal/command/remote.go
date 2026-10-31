package command

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"

	"orbis.local/orbis/cli/internal/client"
	"orbis.local/orbis/cli/internal/config"
)

func (r Runtime) remote(ctx context.Context, a arguments, c config.Config, api *client.Client) (client.Envelope, error) {
	f := a.flags
	query := url.Values{}
	for _, key := range []string{"page", "page-size", "cursor", "version", "since-version"} {
		if v := f[key]; v != "" {
			query.Set(strings.ReplaceAll(key, "-", "_"), v)
		}
	}
	if query.Get("page_size") == "" {
		query.Set("page_size", "20")
	}
	if query.Get("page") == "" && !strings.Contains(" blocks outline changes ", " "+a.family+" ") && a.command != "outline" && a.command != "changes" {
		query.Set("page", "1")
	}
	get := func(path string, q url.Values) (client.Envelope, error) {
		return api.Agent(ctx, "GET", path, client.Request{Query: q, Retries: 2})
	}
	switch a.family {
	case "versions":
		return r.versions(ctx, a, api)
	case "capabilities", "schema":
		return get("/"+a.family, nil)
	case "workspaces", "collections":
		return get("/"+a.family, query)
	case "documents":
		switch a.command {
		case "list":
			if f["collection"] != "" {
				query.Set("collection_id", f["collection"])
			}
			return get("/documents", query)
		case "search":
			query.Set("q", a.positionals[0])
			return get("/search", query)
		case "resolve":
			id := f["id"]
			if f["url"] != "" {
				u, err := url.Parse(f["url"])
				base, _ := url.Parse(c.BaseURL)
				if err != nil || u.Scheme != base.Scheme || u.Host != base.Host || u.User != nil {
					return client.Envelope{}, client.Failure("CLI_FOREIGN_INSTANCE", "文档 URL 必须属于当前实例", 2, nil)
				}
				parts := strings.Split(strings.Trim(u.Path, "/"), "/")
				if len(parts) != 2 || parts[0] != "documents" {
					return client.Envelope{}, client.Failure("CLI_DOCUMENT_URL_INVALID", "文档 URL 格式应为 /documents/{document_id}", 2, nil)
				}
				id = parts[1]
			}
			body := map[string]any{"title": f["title"]}
			if id != "" {
				if !config.UUID(id) {
					return client.Envelope{}, client.Failure("CLI_NOTE_ID_INVALID", "文档 ID 必须是 UUID", 2, nil)
				}
				body = map[string]any{"document_id": id}
			}
			return api.Agent(ctx, "POST", "/resolve", client.Request{Body: body})
		case "create", "import":
			return r.createDocument(ctx, a, api)
		case "get":
			return get("/documents/"+a.positionals[0], nil)
		case "outline", "changes":
			return get("/documents/"+a.positionals[0]+"/"+a.command, query)
		case "export":
			format := f["format"]
			if format == "" {
				format = "json"
			}
			result, err := get("/documents/"+a.positionals[0]+"/export", url.Values{"version": {f["version"]}, "format": {format}})
			if err != nil {
				return result, err
			}
			data := client.Object(result.Data)
			if data == nil {
				return client.Envelope{}, client.Failure("CLI_RESPONSE_INVALID", "导出响应无效", 7, nil)
			}
			var rendered []byte
			if format == "json" {
				rendered, err = json.MarshalIndent(data["content"], "", "  ")
			} else if text, ok := data["content"].(string); ok {
				rendered = []byte(text)
			} else {
				return client.Envelope{}, client.Failure("CLI_RESPONSE_INVALID", "Markdown 导出响应无效", 7, nil)
			}
			if err != nil {
				return client.Envelope{}, err
			}
			output, err := writeOutput(f["out"], rendered)
			if err != nil {
				return client.Envelope{}, err
			}
			delete(data, "content")
			data["path"] = output
			data["bytes"] = len(rendered)
			return result, nil
		}
	case "imports":
		result, err := get("/imports/"+a.positionals[0], nil)
		if err != nil || a.command == "get" {
			return result, err
		}
		duration, _ := waitDuration(f["wait-seconds"])
		return finalize(ctx, api, client.Object(result.Data), duration)
	case "blocks":
		path := "/documents/" + f["document"]
		if a.command == "list" {
			if f["parent"] != "" {
				query.Set("parent_id", f["parent"])
			}
			return get(path+"/children", query)
		}
		q := url.Values{}
		if f["version"] != "" {
			q.Set("version", f["version"])
		}
		return get(path+"/blocks/"+a.positionals[0], q)
	case "operations":
		if a.command == "get" {
			return get("/operations/"+a.positionals[0], nil)
		}
		body, err := r.jsonFile(f["file"])
		if err != nil {
			return client.Envelope{}, err
		}
		path := "/documents/" + f["document"] + "/operations"
		if a.command == "preview" {
			return api.Agent(ctx, "POST", path+"/preview", client.Request{Body: body})
		}
		return api.Idempotent(ctx, path, body)
	case "boards":
		return r.boards(ctx, a, api)
	case "files":
		return r.files(ctx, a, api)
	case "shares":
		switch a.command {
		case "list":
			query.Set("collection_id", f["collection"])
			return get("/shares", query)
		case "create":
			var expiry any
			if f["expires-at-ms"] != "" {
				expiry = json.Number(f["expires-at-ms"])
			}
			return api.Agent(ctx, "POST", "/shares", client.Request{Body: map[string]any{"collection_id": f["collection"], "root_document_id": nullable(f["root-document"]), "expires_at_ms": expiry, "acknowledge_public_scope": true}})
		case "revoke":
			return api.Agent(ctx, "POST", "/shares/"+a.positionals[0]+"/revoke", client.Request{Body: map[string]any{"expected_version": json.Number(f["expected-version"])}})
		}
	case "request":
		in := client.Request{Retries: 2}
		if a.command == "post" {
			body, err := r.jsonFile(f["file"])
			if err != nil {
				return client.Envelope{}, err
			}
			in.Body = body
			in.Retries = 0
		}
		return api.Do(ctx, strings.ToUpper(a.command), a.positionals[0], in)
	}
	return client.Envelope{}, client.Failure("CLI_COMMAND_UNSUPPORTED", "命令不可用", 8, nil)
}
