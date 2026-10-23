package command

import (
	"context"
	"encoding/json"
	"net/url"

	"orbis.local/orbis/cli/internal/client"
	"orbis.local/orbis/cli/internal/config"
)

func (r Runtime) versions(ctx context.Context, a arguments, api *client.Client) (client.Envelope, error) {
	f := a.flags
	if !config.UUID(f["document"]) {
		return client.Envelope{}, argError()
	}
	path := "/documents/" + f["document"] + "/versions"
	if len(a.positionals) > 0 {
		if !config.UUID(a.positionals[0]) {
			return client.Envelope{}, argError()
		}
		path += "/" + a.positionals[0]
	}
	query := url.Values{}
	for _, key := range []string{"page-size", "cursor"} {
		if f[key] != "" {
			name := key
			if name == "page-size" {
				name = "page_size"
			}
			query.Set(name, f[key])
		}
	}
	if f["operation-id"] != "" && !config.UUID(f["operation-id"]) {
		return client.Envelope{}, argError()
	}
	switch a.command {
	case "list":
		return api.Agent(ctx, "GET", path, client.Request{Query: query})
	case "get":
		return api.Agent(ctx, "GET", path+"/content", client.Request{})
	case "compare":
		if !config.UUID(f["from"]) {
			return client.Envelope{}, argError()
		}
		query.Set("from_id", f["from"])
		return api.Agent(ctx, "GET", path+"/compare", client.Request{Query: query})
	case "save":
		return api.Agent(ctx, "POST", path, client.Request{Body: map[string]any{"operation_id": f["operation-id"], "source_revision": json.Number(f["source-revision"]), "name": f["name"], "description": f["description"]}})
	case "rename":
		return api.Agent(ctx, "PUT", path, client.Request{Body: map[string]any{"operation_id": f["operation-id"], "expected_metadata_version": json.Number(f["expected-metadata-version"]), "name": f["name"], "description": f["description"]}})
	case "restore":
		return api.Agent(ctx, "POST", path+"/restore", client.Request{Body: map[string]any{"operation_id": f["operation-id"], "expected_revision": json.Number(f["expected-revision"])}})
	default:
		return client.Envelope{}, argError()
	}
}
