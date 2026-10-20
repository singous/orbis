package client

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const workspace = "31b48bf3-e8b5-42e9-aefe-8eb277332676"
const operation = "e46d6eaf-c1de-4b99-8977-ce5e01ad9d1d"
const secret = "orbis_it_synthetic_secret"

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(status int, data any) *http.Response {
	b, _ := json.Marshal(data)
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(string(b))), Header: make(http.Header)}
}
func envelope(data any) Envelope {
	return Envelope{Code: "OK", Message: "成功", RequestID: "request", Data: data}
}
func fakeClient(fn transportFunc) *Client {
	c := New("https://orbis.example/api", workspace, secret, time.Second)
	c.HTTP.Transport = fn
	return c
}
func failCode(t *testing.T, err error, code string, exit int) {
	t.Helper()
	var e *Error
	if !errors.As(err, &e) || e.Code != code || e.ExitCode != exit {
		t.Fatalf("got %v; want %s exit %d", err, code, exit)
	}
}
func TestWorkspaceScopeAndRedaction(t *testing.T) {
	c := fakeClient(func(r *http.Request) (*http.Response, error) {
		if r.Header.Get("Authorization") != "Bearer "+secret || r.URL.String() != "https://orbis.example/api/v1/agent/workspaces/"+workspace+"/documents?page_size=2" {
			t.Fatal("scope or headers changed")
		}
		return response(200, envelope(map[string]any{"token": secret, "text": "echo " + secret, "items": []any{}})), nil
	})
	env, err := c.Agent(t.Context(), "GET", "/documents", Request{Query: map[string][]string{"page_size": {"2"}}})
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(env)
	if strings.Contains(string(b), secret) {
		t.Fatal("credential leaked")
	}
}
func TestRawRequestsCannotEscapeWorkspace(t *testing.T) {
	c := fakeClient(func(*http.Request) (*http.Response, error) {
		t.Fatal("forbidden path reached transport")
		return nil, nil
	})
	for _, path := range []string{"https://foreign.example/path", "//foreign.example/path", "/documents", c.Scope + "/../me", c.Scope + "/%2e%2e/me", c.Scope + "/me#secret", c.Scope + "/me\\../me", c.Scope + "/me\x7f", strings.Replace(c.Scope, workspace, operation, 1) + "/me"} {
		t.Run(path, func(t *testing.T) {
			_, err := c.Do(t.Context(), "GET", path, Request{})
			failCode(t, err, "CLI_PATH_FORBIDDEN", 2)
		})
	}
}
func TestLostResponseRecoversOriginalReceipt(t *testing.T) {
	var calls []string
	c := fakeClient(func(r *http.Request) (*http.Response, error) {
		calls = append(calls, r.Method+" "+r.URL.Path)
		if len(calls) == 1 {
			return nil, io.ErrUnexpectedEOF
		}
		return response(200, envelope(map[string]any{"state": "completed", "result": map[string]any{"content_version": 8}})), nil
	})
	env, err := c.Idempotent(t.Context(), "/documents/"+operation+"/operations", map[string]any{"operation_id": operation, "expected_version": 7})
	if err != nil || Object(env.Data)["content_version"] != json.Number("8") || len(calls) != 2 || !strings.HasSuffix(calls[1], operation) {
		t.Fatalf("recovery failed: %v %v %v", env, err, calls)
	}
}
func TestReceiptAbsenceRetriesExactOriginalBytes(t *testing.T) {
	var bodies []string
	c := fakeClient(func(r *http.Request) (*http.Response, error) {
		b, _ := io.ReadAll(r.Body)
		bodies = append(bodies, string(b))
		switch len(bodies) {
		case 1:
			return nil, io.EOF
		case 2:
			return response(404, Envelope{Code: "OPERATION_NOT_FOUND", Message: "无记录"}), nil
		default:
			return response(200, envelope(map[string]any{"saved": true})), nil
		}
	})
	_, err := c.Idempotent(t.Context(), "/documents/"+operation+"/operations", map[string]any{"operation_id": operation, "expected_version": 7})
	if err != nil || len(bodies) != 3 || bodies[0] != bodies[2] {
		t.Fatalf("intent changed: %v %v", bodies, err)
	}
}
func TestUnknownOutcomeRemainsUnknownAfterLaterRejection(t *testing.T) {
	n := 0
	c := fakeClient(func(r *http.Request) (*http.Response, error) {
		n++
		switch n {
		case 1:
			return nil, io.EOF
		case 2:
			return response(404, Envelope{Code: "OPERATION_NOT_FOUND", Message: "无记录"}), nil
		default:
			return response(403, Envelope{Code: "FORBIDDEN", Message: "权限已撤销"}), nil
		}
	})
	_, err := c.Idempotent(t.Context(), "/documents/"+operation+"/operations", map[string]any{"operation_id": operation})
	failCode(t, err, "CLI_NETWORK_ERROR", 6)
	if n != 3 {
		t.Fatal("unexpected retry")
	}
}
func TestPendingReceiptNeverResubmits(t *testing.T) {
	for _, state := range []string{"pending", "completed"} {
		t.Run(state, func(t *testing.T) {
			n := 0
			c := fakeClient(func(r *http.Request) (*http.Response, error) {
				n++
				if n == 1 {
					return nil, io.EOF
				}
				return response(200, envelope(map[string]any{"state": state, "result": nil})), nil
			})
			_, err := c.Idempotent(t.Context(), "/documents/"+operation+"/operations", map[string]any{"operation_id": operation})
			failCode(t, err, "CLI_NETWORK_ERROR", 6)
			if n != 2 {
				t.Fatal("pending receipt resubmitted")
			}
		})
	}
}
func TestConflictAndAuthenticationNeverRetry(t *testing.T) {
	for _, status := range []int{401, 403, 409, 422} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			n := 0
			c := fakeClient(func(r *http.Request) (*http.Response, error) {
				n++
				return response(status, Envelope{Code: "DENIED", Message: secret, Data: map[string]any{"token": secret}}), nil
			})
			_, err := c.Idempotent(t.Context(), "/documents/"+operation+"/operations", map[string]any{"operation_id": operation})
			failCode(t, err, "DENIED", ExitCode(status))
			if n != 1 || strings.Contains(err.Error(), secret) {
				t.Fatal("retry or secret leak")
			}
		})
	}
}
func TestLongRetryAfterIsPreserved(t *testing.T) {
	n := 0
	c := fakeClient(func(r *http.Request) (*http.Response, error) {
		n++
		res := response(429, Envelope{Code: "RATE_LIMIT_EXCEEDED", Message: "稍后再试"})
		res.Header.Set("Retry-After", "120")
		return res, nil
	})
	_, err := c.Agent(t.Context(), "GET", "/me", Request{Retries: 2})
	failCode(t, err, "RATE_LIMIT_EXCEEDED", 6)
	if n != 1 || Object(err.(*Error).Data)["retry_after"] != "120" {
		t.Fatal("long backoff violated")
	}
}
func TestSchemaPropertyNamesArePreserved(t *testing.T) {
	c := fakeClient(func(r *http.Request) (*http.Response, error) {
		return response(200, envelope(map[string]any{"properties": map[string]any{"token": map[string]any{"type": "string"}}, "example": secret})), nil
	})
	env, err := c.Agent(t.Context(), "GET", "/schema", Request{})
	if err != nil {
		t.Fatal(err)
	}
	data := Object(env.Data)
	if Object(Object(data["properties"])["token"])["type"] != "string" || data["example"] == secret {
		t.Fatal("schema was corrupted or credential leaked")
	}
}
func TestInvalidEnvelopeAndReadBudget(t *testing.T) {
	for _, tc := range []struct{ name, body, code string }{{"missing fields", `{"code":"OK"}`, "CLI_RESPONSE_INVALID"}, {"oversize", strings.Repeat("x", MaxResponseBytes+1), "CLI_RESPONSE_BUDGET_EXCEEDED"}} {
		t.Run(tc.name, func(t *testing.T) {
			c := fakeClient(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(tc.body)), Header: make(http.Header)}, nil
			})
			_, err := c.Agent(t.Context(), "GET", "/me", Request{})
			if e, ok := err.(*Error); !ok || e.Code != tc.code {
				t.Fatalf("got %v", err)
			}
		})
	}
}
func TestRedirectCannotForwardCredentials(t *testing.T) {
	var received atomic.Bool
	foreign := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { received.Store(true) }))
	defer foreign.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, foreign.URL, http.StatusTemporaryRedirect)
	}))
	defer origin.Close()
	c := New(origin.URL, workspace, secret, time.Second)
	defer c.Close()
	_, err := c.Agent(t.Context(), "GET", "/me", Request{})
	failCode(t, err, "CLI_HTTP_ERROR", 7)
	if received.Load() {
		t.Fatal("followed redirect")
	}
}
func TestCancellationStopsRetryWait(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	c := fakeClient(func(r *http.Request) (*http.Response, error) { cancel(); return nil, io.EOF })
	_, err := c.Agent(ctx, "GET", "/me", Request{Retries: 2})
	failCode(t, err, "CLI_NETWORK_ERROR", 6)
}

func TestUnusableWriteResponsesRecoverOriginalReceipt(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
	}{{"html", 200, "<html>proxy response</html>"}, {"missing fields", 201, `{"code":"CREATED"}`}, {"oversize", 200, strings.Repeat("x", MaxResponseBytes+1)}, {"gateway failure", 502, "upstream closed"}}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			c := fakeClient(func(r *http.Request) (*http.Response, error) {
				calls++
				if calls == 1 {
					return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body)), Header: make(http.Header)}, nil
				}
				if r.Method != "GET" || !strings.HasSuffix(r.URL.Path, "/operations/"+operation) {
					t.Fatal("write response did not query original receipt")
				}
				return response(200, envelope(map[string]any{"state": "completed", "result": map[string]any{"content_version": 8}})), nil
			})
			env, err := c.Idempotent(t.Context(), "/documents/"+workspace+"/operations", map[string]any{"operation_id": operation, "expected_version": 7})
			if err != nil || Object(env.Data)["content_version"] != json.Number("8") || calls != 2 {
				t.Fatalf("recovery failed: %v %v %d", env, err, calls)
			}
		})
	}
}

func TestUnusableWriteResponseKeepsIDWhenReceiptCannotBeConfirmed(t *testing.T) {
	calls := 0
	c := fakeClient(func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("invalid")), Header: make(http.Header)}, nil
	})
	_, err := c.Idempotent(t.Context(), "/documents/"+workspace+"/operations", map[string]any{"operation_id": operation})
	failCode(t, err, "CLI_NETWORK_ERROR", 6)
	if Object(err.(*Error).Data)["operation_id"] != operation || calls != 2 {
		t.Fatal("unknown result lost original intent")
	}
}
