package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestResponseContract(t *testing.T) {
	for _, test := range []struct {
		name, method, path, body string
		status                   int
	}{
		{name: "health", method: "GET", path: "/healthz", status: 200},
		{name: "missing route", method: "GET", path: "/unknown", status: 404},
		{name: "wrong method", method: "DELETE", path: "/healthz", status: 405},
		{name: "unauthenticated", method: "GET", path: "/api/v1/me", status: 401},
		{name: "malformed JSON", method: "POST", path: "/api/v1/auth/login", body: "{", status: 400},
		{name: "trailing JSON", method: "POST", path: "/api/v1/auth/login", body: "{} {}", status: 400},
		{name: "wrong field type", method: "POST", path: "/api/v1/auth/login", body: `{"email":42}`, status: 422},
		{
			name:   "oversized",
			method: "POST",
			path:   "/api/v1/auth/login",
			body:   `{"email":"` + strings.Repeat("x", 2000) + `"}`,
			status: 413,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			router, err := New(Dependencies{
				Logger:         slog.New(slog.NewJSONHandler(io.Discard, nil)),
				MaxBodyBytes:   1024,
				RequestTimeout: time.Second,
			})
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(test.method, test.path, strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)
			if recorder.Code != test.status {
				t.Fatalf("status = %d, want %d", recorder.Code, test.status)
			}
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(recorder.Body.Bytes(), &fields); err != nil {
				t.Fatal(err)
			}
			if len(fields) != 4 || fields["data"] == nil {
				t.Fatal("response envelope is incomplete")
			}
			var id string
			if err := json.Unmarshal(fields["request_id"], &id); err != nil {
				t.Fatal(err)
			}
			if id == "" || id != recorder.Header().Get("X-Request-ID") {
				t.Fatal("request ID does not match header")
			}
		})
	}
}

func TestRecoveryDoesNotExposePanicValue(t *testing.T) {
	var logs bytes.Buffer
	router, err := New(Dependencies{
		Logger: slog.New(slog.NewJSONHandler(&logs, nil)), MaxBodyBytes: 1024, RequestTimeout: time.Second,
		Ready: func(context.Context) error { panic("synthetic-private-panic-value") },
	})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest("GET", "/readyz", nil))
	if recorder.Code != 500 {
		t.Fatal("panic was not recovered")
	}
	if strings.Contains(recorder.Body.String()+logs.String(), "synthetic-private-panic-value") {
		t.Fatal("panic value was exposed")
	}
}
