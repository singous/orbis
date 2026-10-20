//go:build integration

// Package testenv provisions one fresh database per integration test.
package testenv

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
	"gorm.io/gorm"

	"orbis.local/orbis/api"
	"orbis.local/orbis/internal/app"
	"orbis.local/orbis/internal/platform/config"
	"orbis.local/orbis/internal/platform/database"
	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/internal/workspace"
	"orbis.local/orbis/migrations"
)

const Password = "isolated-test-password-2026"

type Environment struct {
	EnableQueue        func(*testing.T)
	UseLegacySecrets   func(*testing.T, string, string)
	CleanupImports     func(context.Context) (int, error)
	StopApplication    func(*testing.T)
	RestartApplication func(*testing.T)
	Handler            http.Handler
	DB                 *gorm.DB
	URL                string
	Clock              *Clock
	OutboxDir          string
	StorageDir         string
	contract           routers.Router
}

type Clock struct{ milliseconds atomic.Int64 }

func (c *Clock) Now() time.Time                 { return time.UnixMilli(c.milliseconds.Load()).UTC() }
func (c *Clock) Advance(duration time.Duration) { c.milliseconds.Add(duration.Milliseconds()) }

type Result struct {
	Body      []byte
	Status    int
	Code      string
	RequestID string
	Data      json.RawMessage
	Header    http.Header
}

func New(t *testing.T) *Environment {
	t.Helper()
	return newEnvironment(t, false, config.DefaultUploadLimit, false, false)
}

func NewWithCollaboration(t *testing.T) *Environment {
	t.Helper()
	if os.Getenv("ORBIS_TEST_COLLABORATION_URL") == "" || os.Getenv("ORBIS_TEST_COLLABORATION_KEY") == "" {
		t.Skip("set ORBIS_TEST_COLLABORATION_IMAGE to exercise CRDT with an owned test engine")
	}
	return newEnvironment(t, false, config.DefaultUploadLimit, false, true)
}

func NewWithMail(t *testing.T) *Environment {
	t.Helper()
	return newEnvironment(t, true, config.DefaultUploadLimit, false, false)
}

func NewWithUploadLimit(t *testing.T, limit int64) *Environment {
	t.Helper()
	return newEnvironment(t, false, limit, false, false)
}

func NewWithQueue(t *testing.T) *Environment {
	t.Helper()
	return newEnvironment(t, false, config.DefaultUploadLimit, true, false)
}

func newEnvironment(t *testing.T, enableMail bool, uploadLimit int64, enableQueue, enableCollaboration bool) *Environment {
	t.Helper()
	dsn := os.Getenv("ORBIS_TEST_DATABASE_URL")
	marker := os.Getenv("ORBIS_TEST_CLUSTER_ID")
	if dsn == "" || !strings.HasPrefix(marker, "orbis_test_") {
		t.Fatal("use tools/testenv integration to provision an isolated database")
	}
	u, err := url.Parse(dsn)
	if err != nil || u.Path != "/orbis_test" {
		t.Fatal("test database URL must name the disposable orbis_test database")
	}
	admin, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal("open test PostgreSQL")
	}
	t.Cleanup(func() {
		if err := admin.Close(); err != nil {
			t.Error(err)
		}
	})
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	var actual string
	if err := admin.QueryRowContext(ctx, "SHOW cluster_name").Scan(&actual); err != nil {
		t.Fatal(err)
	}
	if actual != marker {
		t.Fatal("refusing to run tests on a cluster not owned by the test runner")
	}
	name := "orbis_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	// The identifier is generated locally from a UUID, never from a user value.
	if _, err := admin.ExecContext(ctx, `CREATE DATABASE "`+name+`"`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		if _, err := admin.ExecContext(cleanup, `DROP DATABASE "`+name+`" WITH (FORCE)`); err != nil {
			t.Error(err)
		}
	})
	u.Path = "/" + name
	if err := migrations.Up(u.String()); err != nil {
		t.Fatal(err)
	}
	key, err := security.RandomToken()
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		Address: "127.0.0.1:0", DatabaseURL: u.String(), SigningKey: key,
		AccessTTL: 15 * time.Minute, RefreshTTL: 24 * time.Hour,
		ReadTimeout: 5 * time.Second, WriteTimeout: 10 * time.Second, ShutdownTimeout: 5 * time.Second,
		MaxBodyBytes: config.DefaultBodyLimit, StorageDirectory: filepath.Join(t.TempDir(), "objects"), MaxUploadBytes: uploadLimit,
	}
	if enableQueue {
		cfg.RedisURL = os.Getenv("ORBIS_TEST_REDIS_URL")
		if cfg.RedisURL == "" {
			t.Fatal("disposable test Redis is required")
		}
	}
	if enableCollaboration {
		cfg.CollaborationURL = os.Getenv("ORBIS_TEST_COLLABORATION_URL")
		cfg.CollaborationKey = os.Getenv("ORBIS_TEST_COLLABORATION_KEY")
		engine, err := url.Parse(cfg.CollaborationURL)
		if err != nil || engine.Scheme != "http" || engine.Hostname() != "127.0.0.1" || engine.User != nil || len(cfg.CollaborationKey) < 32 {
			t.Fatal("collaboration tests require the owned loopback engine and synthetic key")
		}
	}
	wallClock := &Clock{}
	wallClock.milliseconds.Store(time.Now().UnixMilli())
	outbox := ""
	if enableMail {
		outbox = filepath.Join(t.TempDir(), "mail")
		cfg.Mail = config.Mail{Transport: "outbox", OutboxDir: outbox, PublicBaseURL: "https://orbis.example.test"}
	}
	application, err := app.NewWithClock(ctx, cfg, slog.New(slog.NewJSONHandler(io.Discard, nil)), wallClock)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := application.Close(); err != nil {
			t.Error(err)
		}
	})
	db, err := database.Open(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := pool.Close(); err != nil {
			t.Error(err)
		}
	})
	spec, err := openapi3.NewLoader().LoadFromData(api.Contract)
	if err != nil {
		t.Fatal(err)
	}
	contract, err := newContractRouter(spec)
	if err != nil {
		t.Fatal(err)
	}
	environment := &Environment{Handler: application.Handler, DB: db, URL: u.String(), contract: contract, Clock: wallClock, OutboxDir: outbox, StorageDir: cfg.StorageDirectory}
	environment.CleanupImports = func(ctx context.Context) (int, error) { return application.CleanupImports(ctx) }
	stopped := false
	environment.StopApplication = func(t *testing.T) {
		t.Helper()
		if !stopped {
			if err := application.Close(); err != nil {
				t.Fatal(err)
			}
			stopped = true
		}
	}
	environment.RestartApplication = func(t *testing.T) {
		t.Helper()
		environment.StopApplication(t)
		next, err := app.NewWithClock(t.Context(), cfg, slog.New(slog.NewJSONHandler(io.Discard, nil)), wallClock)
		if err != nil {
			t.Fatal(err)
		}
		application = next
		environment.Handler = next.Handler
		stopped = false
	}
	environment.EnableQueue = func(t *testing.T) {
		t.Helper()
		cfg.RedisURL = os.Getenv("ORBIS_TEST_REDIS_URL")
		if cfg.RedisURL == "" {
			t.Fatal("disposable Redis is required")
		}
		environment.RestartApplication(t)
	}
	environment.UseLegacySecrets = func(t *testing.T, refresh, action string) {
		t.Helper()
		cfg.LegacyRefreshSecret = refresh
		cfg.LegacyActionSecret = action
		environment.RestartApplication(t)
	}
	return environment
}

// Mail reads a synthetic capability from the local delivery transport, never from API output.
func (e *Environment) Mail(t *testing.T, actionID string) workspace.ActionMail {
	t.Helper()
	files, err := os.ReadDir(e.OutboxDir)
	if err != nil {
		t.Fatal(err)
	}
	sort.Slice(files, func(i, j int) bool {
		a, aErr := files[i].Info()
		b, bErr := files[j].Info()
		if aErr != nil || bErr != nil {
			return files[i].Name() > files[j].Name()
		}
		return a.ModTime().After(b.ModTime())
	})
	for _, file := range files {
		if filepath.Ext(file.Name()) != ".json" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(e.OutboxDir, file.Name()))
		if err != nil {
			t.Fatal(err)
		}
		var message workspace.ActionMail
		if err := json.Unmarshal(data, &message); err != nil {
			t.Fatal(err)
		}
		if message.ActionID == actionID {
			return message
		}
	}
	t.Fatal("action email was not delivered")
	return workspace.ActionMail{}
}

func (e *Environment) Do(method, path, token string, body any) (Result, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return Result{}, err
	}
	request := httptest.NewRequest(method, path, bytes.NewReader(data))
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	return e.DoRequest(request)
}

// DoRequest validates JSON, binary, and bodyless responses against the same public contract.
func (e *Environment) DoRequest(request *http.Request) (Result, error) {
	recorder := httptest.NewRecorder()
	e.Handler.ServeHTTP(recorder, request)
	route, params, err := e.contract.FindRoute(request)
	if err != nil {
		return Result{}, fmt.Errorf("find API contract: %w", err)
	}
	validation := &openapi3filter.ResponseValidationInput{
		RequestValidationInput: &openapi3filter.RequestValidationInput{
			Request: request, PathParams: params, Route: route,
		},
		Status: recorder.Code, Header: recorder.Header(),
		Options: &openapi3filter.Options{IncludeResponseStatus: true},
	}
	validation.SetBodyBytes(recorder.Body.Bytes())
	if err := openapi3filter.ValidateResponse(request.Context(), validation); err != nil {
		return Result{}, fmt.Errorf("API response violates contract: %w", err)
	}
	if request.Method == http.MethodHead || recorder.Code == http.StatusNotModified {
		if recorder.Body.Len() != 0 {
			return Result{}, fmt.Errorf("bodyless response contains bytes")
		}
		return Result{Status: recorder.Code, RequestID: recorder.Header().Get("X-Request-ID"), Header: recorder.Header().Clone()}, nil
	}
	if !strings.HasPrefix(recorder.Header().Get("Content-Type"), "application/json") {
		return Result{Status: recorder.Code, RequestID: recorder.Header().Get("X-Request-ID"), Body: recorder.Body.Bytes(), Header: recorder.Header().Clone()}, nil
	}
	var envelope struct {
		Code      string          `json:"code"`
		RequestID string          `json:"request_id"`
		Data      json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		return Result{}, fmt.Errorf("decode API response: %w", err)
	}
	return Result{Status: recorder.Code, Code: envelope.Code, RequestID: envelope.RequestID,
		Data: envelope.Data, Header: recorder.Header(), Body: recorder.Body.Bytes()}, nil
}

func (e *Environment) Call(t *testing.T, method, path, token string, body any, status int) Result {
	t.Helper()
	result, err := e.Do(
		method,
		path,
		token,
		body,
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != status {
		t.Fatalf(
			"%s %s: status %d, code %s; want %d",
			method,
			path,
			result.Status,
			result.Code,
			status,
		)
	}
	if result.RequestID == "" || result.Header.Get("X-Request-ID") != result.RequestID {
		t.Fatal("request ID is missing or inconsistent")
	}
	return result
}

func Decode[T any](t *testing.T, result Result) T {
	t.Helper()
	var value T
	if err := json.Unmarshal(result.Data, &value); err != nil {
		t.Fatal(err)
	}
	return value
}

type Session struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	User         struct {
		ID string `json:"id"`
	} `json:"user"`
}

func (e *Environment) Login(t *testing.T, email string) Session {
	t.Helper()
	return Decode[Session](t, e.Call(
		t,
		"POST",
		"/api/v1/auth/login",
		"",
		map[string]any{
			"email": email, "password": Password,
		},
		http.StatusOK,
	))
}

func (e *Environment) Owner(t *testing.T) (Session, string) {
	t.Helper()
	result := e.Call(
		t,
		"POST",
		"/api/v1/setup",
		"",
		map[string]any{
			"email": "owner@example.test", "password": Password,
			"display_name": "Test Owner", "workspace_name": "Test Workspace",
		},
		http.StatusCreated,
	)
	data := Decode[struct {
		Workspace struct {
			ID string `json:"id"`
		} `json:"workspace"`
	}](t, result)
	return e.Login(t, "owner@example.test"), data.Workspace.ID
}

func (e *Environment) AddUser(t *testing.T, email string) Session {
	t.Helper()
	hash, err := security.NewPasswords().Hash(t.Context(), Password)
	if err != nil {
		t.Fatal(err)
	}
	now := e.Clock.Now().UnixMilli()
	if err := e.DB.Exec(
		"INSERT INTO users (id,email,password_hash,display_name,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?)",
		uuid.NewString(),
		email,
		hash,
		"Test User",
		now,
		now,
	).Error; err != nil {
		t.Fatal(err)
	}
	return e.Login(t, email)
}
