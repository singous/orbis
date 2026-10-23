package command

import (
	"context"
	"crypto/sha256"
	"encoding/hex"

	"orbis.local/orbis/cli/internal/client"
	"orbis.local/orbis/cli/internal/config"
)

// Template identities derive from the original operation ID, so process restarts
// and uncertain responses produce exactly the same command intent.
func templateID(operation, original string) string {
	digest := sha256.Sum256([]byte(operation + "\x00" + original))
	digest[6] = (digest[6] & 15) | 64
	digest[8] = (digest[8] & 63) | 128
	value := hex.EncodeToString(digest[:16])
	return value[:8] + "-" + value[8:12] + "-" + value[12:16] + "-" + value[16:20] + "-" + value[20:]
}
func (r Runtime) applyBoardTemplate(ctx context.Context, a arguments, api *client.Client) (client.Envelope, error) {
	page, operation := a.flags["board-page"], a.flags["operation-id"]
	if !config.UUID(page) || !config.UUID(operation) {
		return client.Envelope{}, argError()
	}
	catalog, err := api.Agent(ctx, "GET", "/board-templates", client.Request{Retries: 2})
	if err != nil {
		return catalog, err
	}
	templates, ok := client.Object(catalog.Data)["templates"].([]any)
	if !ok {
		return client.Envelope{}, client.Failure("CLI_RESPONSE_INVALID", "模板目录无效", 7, nil)
	}
	var selected map[string]any
	for _, raw := range templates {
		candidate := client.Object(raw)
		if candidate["id"] == a.flags["template"] {
			selected = candidate
			break
		}
	}
	if selected == nil {
		return client.Envelope{}, client.Failure("CLI_TEMPLATE_NOT_FOUND", "找不到指定的画板模板", 2, nil)
	}
	if integer(selected["version"]) != 1 {
		return client.Envelope{}, client.Failure("CLI_TEMPLATE_VERSION_UNSUPPORTED", "模板版本不受支持，请更新客户端", 2, nil)
	}
	elements, ok := selected["elements"].([]any)
	if !ok || len(elements) == 0 || len(elements) > 500 {
		return client.Envelope{}, client.Failure("CLI_RESPONSE_INVALID", "模板内容无效或过大", 7, nil)
	}
	ids := map[string]string{}
	for _, raw := range elements {
		e := client.Object(raw)
		id, _ := e["id"].(string)
		if !config.UUID(id) {
			return client.Envelope{}, client.Failure("CLI_RESPONSE_INVALID", "模板图元标识无效", 7, nil)
		}
		ids[id] = templateID(operation, id)
		members, _ := client.Object(e["structure"])["members"].([]any)
		for _, rawMember := range members {
			member := client.Object(rawMember)
			id, _ := member["id"].(string)
			if !config.UUID(id) {
				return client.Envelope{}, client.Failure("CLI_RESPONSE_INVALID", "模板成员标识无效", 7, nil)
			}
			ids[id] = templateID(operation, id)
		}
	}
	for _, raw := range elements {
		e := client.Object(raw)
		e["id"] = ids[e["id"].(string)]
		e["page_id"] = page
		e["version"] = 0
		e["versions"] = map[string]int{"geometry": 0, "style": 0, "text": 0, "structure": 0}
		structure := client.Object(e["structure"])
		if id, ok := structure["parent_id"].(string); ok {
			structure["parent_id"] = ids[id]
		}
		members, _ := structure["members"].([]any)
		for _, rawMember := range members {
			member := client.Object(rawMember)
			member["id"] = ids[member["id"].(string)]
		}
		for _, side := range []string{"start", "end"} {
			endpoint := client.Object(structure[side])
			if endpoint == nil {
				continue
			}
			if id, ok := endpoint["element_id"].(string); ok {
				endpoint["element_id"] = ids[id]
			}
			if port, ok := endpoint["port"].(string); ok {
				for original, replacement := range ids {
					if port == "left:"+original {
						endpoint["port"] = "left:" + replacement
					}
					if port == "right:"+original {
						endpoint["port"] = "right:" + replacement
					}
				}
			}
		}
	}
	return api.Idempotent(ctx, "/boards/"+a.positionals[0]+"/commands", map[string]any{"operation_id": operation, "schema_version": 1, "commands": []any{map[string]any{"type": "elements.create", "elements": elements}}})
}
