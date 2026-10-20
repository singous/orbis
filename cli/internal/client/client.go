package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const Version = "0.1.0"
const MaxResponseBytes = 12 * 1024 * 1024
const MaxFileBytes = 20 * 1024 * 1024

type Client struct {
	BaseURL, Scope, Token string
	HTTP                  *http.Client
}
type Request struct {
	Body        any
	Raw         []byte
	Query       url.Values
	ContentType string
	ChunkSHA256 string
	Retries     int
	Binary      bool
}

func New(base, workspace, token string, timeout time.Duration) *Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.MaxConnsPerHost = 2
	transport.ResponseHeaderTimeout = timeout
	return &Client{BaseURL: strings.TrimRight(base, "/"), Scope: "/api/v1/agent/workspaces/" + workspace, Token: token, HTTP: &http.Client{Transport: transport, Timeout: timeout, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}}
}
func (c *Client) Close() { c.HTTP.CloseIdleConnections() }
func (c *Client) Agent(ctx context.Context, method, path string, in Request) (Envelope, error) {
	return c.Do(ctx, method, c.Scope+path, in)
}
func (c *Client) Redact(value any, fields bool) any {
	switch v := value.(type) {
	case string:
		if c.Token != "" {
			return strings.ReplaceAll(v, c.Token, "[REDACTED]")
		}
		return v
	case []any:
		for i, item := range v {
			v[i] = c.Redact(item, fields)
		}
	case map[string]any:
		for k, item := range v {
			secret := false
			switch strings.ToLower(k) {
			case "token", "access_token", "refresh_token", "authorization", "password", "secret":
				secret = true
			}
			if fields && secret {
				v[k] = "[REDACTED]"
			} else {
				v[k] = c.Redact(item, fields)
			}
		}
	}
	return value
}
func (c *Client) safe(e Envelope, fields bool) Envelope {
	e.Message = c.Redact(e.Message, false).(string)
	e.Data = c.Redact(e.Data, fields)
	return e
}
func (c *Client) Do(ctx context.Context, method, path string, in Request) (Envelope, error) {
	raw, env, err := c.request(ctx, method, path, in)
	if in.Binary && err == nil {
		env.Data = raw
	}
	return env, err
}
func (c *Client) request(ctx context.Context, method, path string, in Request) ([]byte, Envelope, error) {
	bad := func() ([]byte, Envelope, error) {
		return nil, Envelope{}, Failure("CLI_PATH_FORBIDDEN", "请求必须位于当前实例与工作空间的 Agent API 范围内", 2, nil)
	}
	parsed, err := url.Parse(path)
	if err != nil || parsed.IsAbs() || parsed.Host != "" || !strings.HasPrefix(parsed.Path, c.Scope+"/") || parsed.RawPath != "" || strings.ContainsAny(path, "\\\r\n\x00") || strings.Contains(parsed.EscapedPath(), "%") || parsed.Fragment != "" {
		return bad()
	}
	for _, r := range path {
		if r < 32 || r == 127 {
			return bad()
		}
	}
	for _, part := range strings.Split(parsed.Path, "/") {
		if part == "." || part == ".." {
			return bad()
		}
	}
	api := c.BaseURL
	u, _ := url.Parse(api)
	if !strings.HasSuffix(u.Path, "/api") {
		api += "/api"
	}
	target := api + strings.TrimPrefix(path, "/api")
	if len(in.Query) > 0 {
		sep := "?"
		if parsed.RawQuery != "" {
			sep = "&"
		}
		target += sep + in.Query.Encode()
	}
	encoded := in.Raw
	if in.Body != nil {
		encoded, err = json.Marshal(in.Body)
		if err != nil {
			return nil, Envelope{}, Failure("CLI_INPUT_INVALID", "请求必须为有效 JSON", 2, nil)
		}
	}
	for attempt := 0; attempt <= in.Retries; attempt++ {
		req, err := http.NewRequestWithContext(ctx, method, target, bytes.NewReader(encoded))
		if err != nil {
			return nil, Envelope{}, Failure("CLI_URL_INVALID", "请求地址无效", 2, nil)
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Authorization", "Bearer "+c.Token)
		req.Header.Set("User-Agent", "orbis-cli/"+Version)
		if encoded != nil {
			ctype := in.ContentType
			if ctype == "" {
				ctype = "application/json"
			}
			req.Header.Set("Content-Type", ctype)
		}
		if in.ChunkSHA256 != "" {
			req.Header.Set("X-Chunk-SHA256", in.ChunkSHA256)
		}
		response, err := c.HTTP.Do(req)
		if err != nil {
			if method == http.MethodGet && attempt < in.Retries && ctx.Err() == nil {
				if err = wait(ctx, time.Duration(200*(1<<attempt))*time.Millisecond); err == nil {
					continue
				}
			}
			return nil, Envelope{}, Network(nil)
		}
		budget := MaxResponseBytes
		if in.Binary && response.StatusCode >= 200 && response.StatusCode < 300 {
			budget = MaxFileBytes
		}
		b, readErr := io.ReadAll(io.LimitReader(response.Body, int64(budget)+1))
		closeErr := response.Body.Close()
		if readErr != nil || closeErr != nil {
			if method == http.MethodGet && attempt < in.Retries && ctx.Err() == nil {
				if err := wait(ctx, time.Duration(200*(1<<attempt))*time.Millisecond); err == nil {
					continue
				}
			}
			return nil, Envelope{}, Network(nil)
		}
		if len(b) > budget {
			failure := Failure("CLI_RESPONSE_BUDGET_EXCEEDED", "响应超过客户端读取预算，请使用分页接口", 2, nil)
			failure.Uncertain = method != http.MethodGet && (response.StatusCode >= 500 || response.StatusCode >= 200 && response.StatusCode < 300)
			return nil, Envelope{}, failure
		}
		if response.StatusCode >= 200 && response.StatusCode < 300 && in.Binary {
			return b, Envelope{}, nil
		}
		var payload map[string]json.RawMessage
		valid := json.Unmarshal(b, &payload) == nil && payload != nil
		for _, key := range []string{"code", "message", "request_id", "data"} {
			if _, ok := payload[key]; !ok {
				valid = false
			}
		}
		var env Envelope
		if valid {
			dec := json.NewDecoder(bytes.NewReader(b))
			dec.UseNumber()
			valid = dec.Decode(&env) == nil && env.Code != ""
		}
		env = c.safe(env, parsed.Path != c.Scope+"/schema")
		if response.StatusCode >= 200 && response.StatusCode < 300 {
			if !valid {
				failure := Failure("CLI_RESPONSE_INVALID", "服务端返回了无效 API 响应", 7, nil)
				failure.Uncertain = method != http.MethodGet
				return nil, Envelope{}, failure
			}
			return nil, env, nil
		}
		if !valid {
			env = Envelope{Code: "CLI_HTTP_ERROR", Message: "服务端返回 HTTP " + strconv.Itoa(response.StatusCode)}
		}
		if response.StatusCode == 429 && method == http.MethodGet && attempt < in.Retries {
			hint := response.Header.Get("Retry-After")
			if hint == "" {
				hint = "1"
			}
			delay, ok := retryAfter(hint)
			if ok && delay <= 3*time.Second {
				if err := wait(ctx, delay); err == nil {
					continue
				}
				return nil, Envelope{}, Network(nil)
			}
			env.Data = map[string]any{"retry_after": hint, "server_data": env.Data}
		}
		return nil, Envelope{}, &Error{Envelope: env, ExitCode: ExitCode(response.StatusCode), Uncertain: method != http.MethodGet && response.StatusCode >= 500}
	}
	return nil, Envelope{}, Network(nil)
}
func retryAfter(raw string) (time.Duration, bool) {
	if seconds, err := strconv.ParseFloat(raw, 64); err == nil {
		if math.IsNaN(seconds) || math.IsInf(seconds, 0) {
			return time.Second, true
		}
		if seconds < 0.1 {
			seconds = 0.1
		}
		if seconds > 3 {
			return 0, false
		}
		return time.Duration(seconds * float64(time.Second)), true
	}
	if t, err := http.ParseTime(raw); err == nil {
		d := time.Until(t)
		if d < 100*time.Millisecond {
			d = 100 * time.Millisecond
		}
		return d, true
	}
	return time.Second, true
}
func wait(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
func (c *Client) Recovered(ctx context.Context, operation string) (Envelope, error) {
	env, err := c.Agent(ctx, "GET", "/operations/"+operation, Request{Retries: 2})
	if err != nil {
		return env, err
	}
	data := Object(env.Data)
	if data["state"] != "completed" || data["result"] == nil {
		return Envelope{}, Network(map[string]any{"operation_id": operation, "state": data["state"]})
	}
	env.Data = data["result"]
	return env, nil
}
func (c *Client) Idempotent(ctx context.Context, path string, body map[string]any) (Envelope, error) {
	operation, ok := body["operation_id"].(string)
	if !ok || !uuid(operation) {
		return Envelope{}, Failure("CLI_OPERATION_ID_REQUIRED", "写入需要稳定的操作 UUID", 2, nil)
	}
	frozen, err := json.Marshal(body)
	if err != nil {
		return Envelope{}, Failure("CLI_INPUT_INVALID", "请求必须为 JSON 对象", 2, nil)
	}
	uncertain := false
	for attempt := 0; attempt < 2; attempt++ {
		env, err := c.Agent(ctx, "POST", path, Request{Raw: frozen})
		if err == nil {
			return env, nil
		}
		if MayHaveCommitted(err) {
			uncertain = true
			result, observed := c.Recovered(ctx, operation)
			if observed == nil {
				return result, nil
			}
			var fail *Error
			if !errors.As(observed, &fail) || fail.Code != "OPERATION_NOT_FOUND" {
				return Envelope{}, Network(map[string]any{"operation_id": operation})
			}
			if attempt == 1 {
				return Envelope{}, Network(map[string]any{"operation_id": operation})
			}
		} else {
			if uncertain {
				return Envelope{}, Network(map[string]any{"operation_id": operation})
			}
			return Envelope{}, err
		}
	}
	return Envelope{}, Network(map[string]any{"operation_id": operation})
}
func uuid(v string) bool {
	if len(v) != 36 {
		return false
	}
	for i, r := range v {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if r != '-' {
				return false
			}
		} else if !strings.ContainsRune("0123456789abcdefABCDEF", r) {
			return false
		}
	}
	return true
}
