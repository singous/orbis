package command

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"math"
	"net/url"
	"os"
	"strconv"
	"time"
	"unicode/utf8"

	"orbis.local/orbis/cli/internal/client"
	"orbis.local/orbis/cli/internal/config"
)

const maxImportBytes = 32 * 1024 * 1024
const inlineImportBytes = 512 * 1024
const maxChunkBytes = 1024 * 1024

func waitDuration(raw string) (time.Duration, error) {
	seconds := 60.0
	var err error
	if raw != "" {
		seconds, err = strconv.ParseFloat(raw, 64)
	}
	if err != nil || math.IsNaN(seconds) || math.IsInf(seconds, 0) || seconds < 0 || seconds > 300 {
		return 0, client.Failure("CLI_WAIT_INVALID", "导入等待必须为零至 300 秒", 2, nil)
	}
	return time.Duration(seconds * float64(time.Second)), nil
}
func importPending(state map[string]any) error {
	return client.Failure("CLI_IMPORT_PENDING", "导入仍在进行，请查询原始导入 ID", 6, state)
}
func sleep(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
func waitImport(ctx context.Context, api *client.Client, id string, duration time.Duration) (client.Envelope, error) {
	deadline := time.Now().Add(duration)
	for {
		env, err := api.Agent(ctx, "GET", "/imports/"+id, client.Request{Retries: 2})
		if err != nil {
			if client.IsNetwork(err) {
				return client.Envelope{}, importPending(map[string]any{"id": id, "state": "unknown"})
			}
			return env, err
		}
		state := client.Object(env.Data)
		switch state["state"] {
		case "completed":
			result := client.Object(state["result"])
			if result == nil {
				return client.Envelope{}, client.Failure("CLI_RESPONSE_INVALID", "导入完成响应缺少结果", 7, nil)
			}
			result["import_id"] = id
			env.Data = result
			return env, nil
		case "failed":
			code, _ := state["error_code"].(string)
			if code == "" {
				code = "CLI_IMPORT_FAILED"
			}
			return client.Envelope{}, client.Failure(code, "导入失败，未创建文档", 2, state)
		case "uploading", "queued", "processing":
		default:
			return client.Envelope{}, client.Failure("CLI_RESPONSE_INVALID", "导入状态无效", 7, nil)
		}
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return client.Envelope{}, importPending(state)
		}
		if remaining > 200*time.Millisecond {
			remaining = 200 * time.Millisecond
		}
		if err := sleep(ctx, remaining); err != nil {
			return client.Envelope{}, importPending(state)
		}
	}
}
func finalize(ctx context.Context, api *client.Client, state map[string]any, duration time.Duration) (client.Envelope, error) {
	id, ok := state["id"].(string)
	if !ok || !config.UUID(id) {
		return client.Envelope{}, client.Failure("CLI_RESPONSE_INVALID", "导入响应缺少有效 ID", 7, nil)
	}
	if state["state"] == "uploading" {
		_, err := api.Agent(ctx, "POST", "/imports/"+id+"/finalize", client.Request{})
		if err != nil {
			if !client.MayHaveCommitted(err) {
				return client.Envelope{}, err
			}
			observed, err := api.Agent(ctx, "GET", "/imports/"+id, client.Request{Retries: 2})
			if err != nil {
				return client.Envelope{}, importPending(map[string]any{"import_id": id, "operation_id": state["operation_id"], "state": "unknown"})
			}
			state = client.Object(observed.Data)
			if state["state"] == "uploading" {
				return client.Envelope{}, importPending(state)
			}
		}
	}
	return waitImport(ctx, api, id, duration)
}
func fingerprint(ctx context.Context, path string, maximum int64) (os.FileInfo, string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, "", client.Failure("CLI_FILE_UNREADABLE", "无法读取 Markdown 源文件", 2, nil)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return nil, "", client.Failure("CLI_FILE_UNREADABLE", "Markdown 源必须为普通文件", 2, nil)
	}
	if info.Size() < 0 || info.Size() > maximum {
		return nil, "", client.Failure("CLI_IMPORT_BUDGET_EXCEEDED", "Markdown 超过导入预算", 2, map[string]any{"bytes": info.Size(), "max_bytes": maximum})
	}
	digest := sha256.New()
	buffer := make([]byte, 64*1024)
	var total int64
	for {
		if ctx.Err() != nil {
			return nil, "", client.Network(nil)
		}
		n, err := f.Read(buffer)
		total += int64(n)
		if total > maximum {
			return nil, "", client.Failure("CLI_SOURCE_CHANGED", "Markdown 增长后超过导入预算", 2, nil)
		}
		_, _ = digest.Write(buffer[:n])
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, "", client.Failure("CLI_FILE_UNREADABLE", "无法读取 Markdown 源文件", 2, nil)
		}
	}
	current, err := os.Stat(path)
	if err != nil || current.Size() != info.Size() || !current.ModTime().Equal(info.ModTime()) || !os.SameFile(info, current) {
		return nil, "", client.Failure("CLI_SOURCE_CHANGED", "计算摘要期间 Markdown 发生变化", 2, nil)
	}
	return info, hex.EncodeToString(digest.Sum(nil)), nil
}
func (r Runtime) createDocument(ctx context.Context, a arguments, api *client.Client) (client.Envelope, error) {
	if !config.UUID(a.flags["operation-id"]) {
		return client.Envelope{}, client.Failure("CLI_OPERATION_ID_INVALID", "操作 ID 必须为 UUID", 2, nil)
	}
	if a.flags["file"] == "-" {
		f, err := os.CreateTemp("", "orbis-import-*.md")
		if err != nil {
			return client.Envelope{}, client.Failure("CLI_FILE_UNREADABLE", "无法创建临时导入文件", 2, nil)
		}
		defer os.Remove(f.Name())
		written, err := io.Copy(f, io.LimitReader(r.In, maxImportBytes+1))
		closeErr := f.Close()
		if err != nil || closeErr != nil {
			return client.Envelope{}, client.Failure("CLI_FILE_UNREADABLE", "无法读取标准输入", 2, nil)
		}
		if written > maxImportBytes {
			return client.Envelope{}, client.Failure("CLI_IMPORT_BUDGET_EXCEEDED", "标准输入超过 32 MiB", 2, nil)
		}
		a.flags["file"] = f.Name()
		return r.createDocument(ctx, a, api)
	}
	if path := a.flags["file"]; path != "" {
		stat, err := os.Stat(path)
		if err != nil {
			return client.Envelope{}, client.Failure("CLI_FILE_UNREADABLE", "无法读取 Markdown 源文件", 2, nil)
		}
		if stat.Size() > inlineImportBytes {
			return r.staged(ctx, a, api)
		}
	}
	markdown := ""
	if a.flags["file"] != "" {
		b, err := r.readFile(a.flags["file"], maxInputBytes)
		if err != nil {
			return client.Envelope{}, err
		}
		if !utf8.Valid(b) {
			return client.Envelope{}, client.Failure("CLI_FILE_UNREADABLE", "Markdown 必须为 UTF-8", 2, nil)
		}
		markdown = string(b)
	}
	body := map[string]any{"operation_id": a.flags["operation-id"], "collection_id": a.flags["collection"], "title": a.flags["title"], "parent_id": nullable(a.flags["parent"]), "markdown": markdown}
	if a.flags["dry-run"] == "true" {
		return client.OK(map[string]any{"preview": "local", "request": body, "server_validation": "not performed"}), nil
	}
	return api.Idempotent(ctx, "/documents", body)
}
func (r Runtime) staged(ctx context.Context, a arguments, api *client.Client) (client.Envelope, error) {
	maximum := int64(maxImportBytes)
	dry := a.flags["dry-run"] == "true"
	if !dry {
		env, err := api.Agent(ctx, "GET", "/capabilities", client.Request{Retries: 2})
		if err != nil {
			return env, err
		}
		capabilities := client.Object(env.Data)
		if client.Object(capabilities["features"])["large_markdown_import"] != true {
			return client.Envelope{}, client.Failure("CLI_CAPABILITY_UNSUPPORTED", "实例不支持可恢复的 Markdown 导入", 8, nil)
		}
		if value := integer(client.Object(capabilities["limits"])["import_bytes"]); value >= 0 && value < maximum {
			maximum = value
		}
	}
	info, digest, err := fingerprint(ctx, a.flags["file"], maximum)
	if err != nil {
		return client.Envelope{}, err
	}
	body := map[string]any{"operation_id": a.flags["operation-id"], "collection_id": a.flags["collection"], "parent_id": nullable(a.flags["parent"]), "title": a.flags["title"], "size_bytes": info.Size(), "sha256": digest}
	if dry {
		return client.OK(map[string]any{"flow": "staged", "request": body, "server_validation": "not performed"}), nil
	}
	env, err := api.Agent(ctx, "POST", "/imports", client.Request{Body: body})
	if client.MayHaveCommitted(err) {
		env, err = api.Agent(ctx, "POST", "/imports", client.Request{Body: body})
		if err != nil {
			return client.Envelope{}, client.Network(map[string]any{"operation_id": a.flags["operation-id"], "state": "unknown", "flow": "staged"})
		}
	}
	if err != nil {
		return env, err
	}
	state := client.Object(env.Data)
	duration, _ := waitDuration(a.flags["wait-seconds"])
	if state["state"] != "uploading" {
		return finalize(ctx, api, state, duration)
	}
	id, _ := state["id"].(string)
	chunk := integer(state["chunk_bytes"])
	if !config.UUID(id) || chunk < 1 || chunk > maxChunkBytes || integer(state["size_bytes"]) != info.Size() {
		return client.Envelope{}, client.Failure("CLI_RESPONSE_INVALID", "导入响应预算无效", 7, nil)
	}
	source, err := os.Open(a.flags["file"])
	if err != nil {
		return client.Envelope{}, client.Failure("CLI_FILE_UNREADABLE", "无法读取 Markdown 源文件", 2, nil)
	}
	defer source.Close()
	for state["state"] == "uploading" {
		offset := integer(state["received_bytes"])
		if offset == info.Size() {
			break
		}
		if offset < 0 || offset > info.Size() {
			return client.Envelope{}, client.Failure("CLI_RESPONSE_INVALID", "导入偏移量无效", 7, nil)
		}
		size := chunk
		if size > info.Size()-offset {
			size = info.Size() - offset
		}
		content := make([]byte, int(size))
		if _, err := source.ReadAt(content, offset); err != nil {
			return client.Envelope{}, client.Failure("CLI_SOURCE_CHANGED", "上传期间 Markdown 变短", 2, nil)
		}
		request := client.Request{Raw: content, ContentType: "application/octet-stream", ChunkSHA256: sha256hex(content), Query: url.Values{"offset": {strconv.FormatInt(offset, 10)}}}
		uploaded, err := api.Agent(ctx, "PUT", "/imports/"+id+"/chunks", request)
		wasUncertain := client.MayHaveCommitted(err)
		if wasUncertain {
			uploaded, err = api.Agent(ctx, "GET", "/imports/"+id, client.Request{Retries: 2})
			if err != nil {
				return client.Envelope{}, importPending(state)
			}
			observed := client.Object(uploaded.Data)
			if integer(observed["received_bytes"]) == offset && observed["state"] == "uploading" {
				uploaded, err = api.Agent(ctx, "PUT", "/imports/"+id+"/chunks", request)
			}
		}
		if err != nil {
			if wasUncertain || client.MayHaveCommitted(err) {
				return client.Envelope{}, importPending(state)
			}
			return client.Envelope{}, err
		}
		state = client.Object(uploaded.Data)
		if integer(state["received_bytes"]) <= offset {
			return client.Envelope{}, importPending(state)
		}
	}
	current, currentDigest, err := fingerprint(ctx, a.flags["file"], maximum)
	if err != nil {
		return client.Envelope{}, err
	}
	if current.Size() != info.Size() || !current.ModTime().Equal(info.ModTime()) || digest != currentDigest || !os.SameFile(info, current) {
		return client.Envelope{}, client.Failure("CLI_SOURCE_CHANGED", "上传期间 Markdown 发生变化，请勿复用该操作 ID", 2, nil)
	}
	return finalize(ctx, api, state, duration)
}
