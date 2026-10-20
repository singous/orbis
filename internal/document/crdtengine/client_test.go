package crdtengine

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
)

const testKey = "a-private-test-key-with-at-least-32-bytes"

func TestTransformPreservesBinaryIdentityAndAuthenticatesInternalRuntime(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/transform" || r.Header.Get("Authorization") != "Bearer "+testKey {
			t.Error("runtime request was not scoped/authenticated")
		}
		var input document.CollaborationTransform
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Error(err)
		}
		if input.State[0] != 1 || input.Update[0] != 2 || len(input.Targets) != 1 {
			t.Error("binary intent or target was lost")
		}
		_ = json.NewEncoder(w).Encode(document.CollaborationTransformResult{State: []byte{1, 2}, StateVector: []byte{0}, Update: []byte{2}, Blocks: []document.Block{}, Changed: true})
	}))
	defer server.Close()
	client, err := New(server.URL, testKey)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	result, err := client.Transform(t.Context(), document.CollaborationTransform{State: []byte{1}, Update: []byte{2}, Targets: []document.CollaborationTarget{{Client: 3, Clock: 4}}})
	if err != nil || len(result.State) != 2 || !result.Changed {
		t.Fatalf("result=%+v err=%v", result, err)
	}
}

func TestTransformMapsSafeFailuresAndPreservesCancellation(t *testing.T) {
	for _, test := range []struct {
		status     int
		body, code string
	}{
		{409, `{"code":"EDIT_TARGET_REMOVED"}`, "COLLABORATION_TARGET_REMOVED"},
		{422, `{"sql":"secret database details"}`, "COLLABORATION_UPDATE_INVALID"},
		{413, `{}`, "COLLABORATION_TOO_LARGE"},
		{401, `{"key":"secret"}`, "COLLABORATION_UNAVAILABLE"},
		{200, `{"state":"AQ==","state_vector":"AA==","blocks":null}`, "COLLABORATION_UNAVAILABLE"},
	} {
		t.Run(test.code+http.StatusText(test.status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(test.status)
				_, _ = w.Write([]byte(test.body))
			}))
			defer server.Close()
			client, err := New(server.URL, testKey)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			_, err = client.Transform(t.Context(), document.CollaborationTransform{})
			var business *fault.Error
			if !errors.As(err, &business) || business.Code != test.code || strings.Contains(err.Error(), "secret") {
				t.Fatalf("unsafe or wrong failure: %v", err)
			}
		})
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer server.Close()
	client, err := New(server.URL, testKey)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := client.Transform(ctx, document.CollaborationTransform{}); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation was lost: %v", err)
	}
}

func TestClientRejectsCredentialURLsAndPlaceholders(t *testing.T) {
	for _, address := range []string{"http://user:password@localhost:9203", "http://localhost:9203/path", "file:///tmp/runtime", "http://localhost:9203?key=secret"} {
		if _, err := New(address, testKey); err == nil {
			t.Errorf("accepted unsafe runtime address %q", address)
		}
	}
	if _, err := New("http://localhost:9203", "REPLACE_WITH_A_LONG_PRIVATE_COLLABORATION_KEY"); err == nil {
		t.Fatal("accepted a template key")
	}
}
