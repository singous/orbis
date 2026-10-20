package command

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf8"

	"orbis.local/orbis/cli/internal/client"
	"orbis.local/orbis/cli/internal/config"
)

const maxInputBytes = 1024 * 1024

func (r Runtime) readFile(path string, maximum int) ([]byte, error) {
	var in io.Reader = r.In
	var f *os.File
	var err error
	if path != "-" {
		f, err = os.Open(path)
		if err != nil {
			return nil, client.Failure("CLI_FILE_UNREADABLE", "无法读取输入文件", 2, nil)
		}
		defer f.Close()
		in = f
	}
	b, err := io.ReadAll(io.LimitReader(in, int64(maximum)+1))
	if err != nil {
		return nil, client.Failure("CLI_FILE_UNREADABLE", "无法读取输入文件", 2, nil)
	}
	if len(b) > maximum {
		return nil, client.Failure("CLI_INPUT_BUDGET_EXCEEDED", "输入超过读取预算", 2, nil)
	}
	return b, nil
}
func (r Runtime) jsonFile(path string) (map[string]any, error) {
	b, err := r.readFile(path, maxInputBytes)
	if err != nil {
		return nil, err
	}
	if !utf8.Valid(b) {
		return nil, client.Failure("CLI_FILE_UNREADABLE", "输入不是有效 UTF-8", 2, nil)
	}
	var result map[string]any
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	if dec.Decode(&result) != nil || result == nil {
		return nil, client.Failure("CLI_INPUT_INVALID", "请求文件必须包含 JSON 对象", 2, nil)
	}
	var extra any
	if dec.Decode(&extra) != io.EOF {
		return nil, client.Failure("CLI_INPUT_INVALID", "请求文件只能包含一个 JSON 对象", 2, nil)
	}
	return result, nil
}
func writeOutput(path string, b []byte) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", client.Failure("CLI_OUTPUT_UNWRITABLE", "无法定位输出文件", 2, nil)
	}
	f, err := os.CreateTemp(filepath.Dir(absolute), ".orbis-output-*")
	if err != nil {
		return "", client.Failure("CLI_OUTPUT_UNWRITABLE", "无法写入输出文件", 2, nil)
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(b); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(f.Name(), absolute)
	}
	if err != nil {
		return "", client.Failure("CLI_OUTPUT_UNWRITABLE", "无法写入输出文件", 2, nil)
	}
	return absolute, nil
}
func sha256hex(b []byte) string { sum := sha256.Sum256(b); return hex.EncodeToString(sum[:]) }
func (r Runtime) files(ctx context.Context, a arguments, api *client.Client) (client.Envelope, error) {
	path := "/documents/" + a.flags["document"] + "/assets"
	if a.command == "upload" {
		if !config.UUID(a.flags["operation-id"]) {
			return client.Envelope{}, client.Failure("CLI_UPLOAD_INPUT_INVALID", "上传需要操作 UUID 与可读文件", 2, nil)
		}
		content, err := r.readFile(a.flags["file"], client.MaxFileBytes)
		if err != nil {
			if fail, ok := err.(*client.Error); ok && fail.Code == "CLI_INPUT_BUDGET_EXCEEDED" {
				fail.Code = "CLI_UPLOAD_BUDGET_EXCEEDED"
			}
			return client.Envelope{}, err
		}
		var buffer bytes.Buffer
		writer := multipart.NewWriter(&buffer)
		name := filepath.Base(a.flags["file"])
		name = strings.NewReplacer("\r", "_", "\n", "_", "\"", "_").Replace(name)
		contentType := mime.TypeByExtension(filepath.Ext(name))
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		header := textproto.MIMEHeader{}
		header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{"name": "file", "filename": name}))
		header.Set("Content-Type", contentType)
		part, err := writer.CreatePart(header)
		if err == nil {
			_, err = part.Write(content)
		}
		if err == nil {
			err = writer.Close()
		}
		if err != nil {
			return client.Envelope{}, client.Failure("CLI_UPLOAD_INPUT_INVALID", "无法编码上传文件", 2, nil)
		}
		result, err := api.Agent(ctx, "POST", path, client.Request{Raw: buffer.Bytes(), ContentType: writer.FormDataContentType(), Query: url.Values{"operation_id": {a.flags["operation-id"]}, "sha256": {sha256hex(content)}, "size_bytes": {strconv.Itoa(len(content))}}})
		if client.MayHaveCommitted(err) {
			result, err = api.Recovered(ctx, a.flags["operation-id"])
			if err != nil {
				return client.Envelope{}, client.Failure("CLI_UPLOAD_RESULT_UNKNOWN", "请查询原始操作 ID，再重试相同上传", 6, map[string]any{"operation_id": a.flags["operation-id"]})
			}
		}
		return result, err
	}
	path += "/" + a.positionals[0]
	result, err := api.Agent(ctx, "GET", path, client.Request{Retries: 2})
	if err != nil || a.command == "get" {
		return result, err
	}
	binary, err := api.Agent(ctx, "GET", path+"/content", client.Request{Retries: 2, Binary: true})
	if err != nil {
		return client.Envelope{}, err
	}
	content, ok := binary.Data.([]byte)
	meta := client.Object(result.Data)
	if !ok || int64(len(content)) != integer(meta["size_bytes"]) || sha256hex(content) != meta["sha256"] {
		return client.Envelope{}, client.Failure("CLI_DOWNLOAD_DIGEST_MISMATCH", "下载内容未通过 SHA-256 校验", 7, nil)
	}
	output, err := writeOutput(a.flags["out"], content)
	if err != nil {
		return client.Envelope{}, err
	}
	meta["path"] = output
	meta["bytes"] = len(content)
	meta["verified"] = true
	return result, nil
}
func integer(v any) int64 {
	switch n := v.(type) {
	case json.Number:
		i, _ := n.Int64()
		return i
	case float64:
		return int64(n)
	case int64:
		return n
	case int:
		return int64(n)
	}
	return -1
}
