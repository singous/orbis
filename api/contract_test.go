package api_test

import (
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/getkin/kin-openapi/openapi3"

	"orbis.local/orbis/api"
	httpapi "orbis.local/orbis/internal/transport/http"
)

func TestContractMatchesRegisteredRoutes(t *testing.T) {
	loader := openapi3.NewLoader()
	spec, err := loader.LoadFromData(api.Contract)
	if err != nil {
		t.Fatal(err)
	}
	if err := spec.Validate(t.Context()); err != nil {
		t.Fatal(err)
	}
	router, err := httpapi.New(httpapi.Dependencies{
		Logger:         slog.New(slog.NewJSONHandler(io.Discard, nil)),
		MaxBodyBytes:   1024,
		RequestTimeout: time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, route := range router.Routes() {
		path := route.Path
		parts := strings.Split(path, "/")
		for i, part := range parts {
			if strings.HasPrefix(part, ":") || strings.HasPrefix(part, "*") {
				parts[i] = "{" + strings.TrimLeft(part, ":*") + "}"
			}
		}
		path = strings.Join(parts, "/")
		item := spec.Paths.Find(path)
		if item == nil || item.GetOperation(route.Method) == nil {
			t.Errorf("route %s %s has no contract", route.Method, path)
		}
		count++
	}
	declared := 0
	for _, item := range spec.Paths.Map() {
		declared += len(item.Operations())
	}
	if count != declared {
		t.Fatalf("contract declares %d routes; router has %d", declared, count)
	}
}
