package httpapi

import (
	"io"
	"log/slog"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type stalledResponse struct {
	*httptest.ResponseRecorder
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (w *stalledResponse) Write(data []byte) (int, error) {
	w.once.Do(func() { close(w.started) })
	<-w.release
	return w.ResponseRecorder.Write(data)
}
func TestPublicResponseBudgetIncludesWritingAndRecovers(t *testing.T) {
	h := &handler{deps: Dependencies{Logger: slog.New(slog.NewJSONHandler(io.Discard, nil)), MaxBodyBytes: 1024, RequestTimeout: time.Second}, publicResponses: make(chan struct{}, 1)}
	router := gin.New()
	router.Use(h.requestContext())
	router.GET("/reader", h.publicResponseLimit(false), func(c *gin.Context) { success(c, 200, gin.H{"content": "body"}) })
	first := &stalledResponse{ResponseRecorder: httptest.NewRecorder(), started: make(chan struct{}), release: make(chan struct{})}
	var release sync.Once
	t.Cleanup(func() { release.Do(func() { close(first.release) }) })
	done := make(chan struct{})
	go func() { router.ServeHTTP(first, httptest.NewRequest("GET", "/reader", nil)); close(done) }()
	select {
	case <-first.started:
	case <-time.After(5 * time.Second):
		t.Fatal("reader did not start writing")
	}
	blocked := httptest.NewRecorder()
	router.ServeHTTP(blocked, httptest.NewRequest("GET", "/reader", nil))
	if blocked.Code != 503 {
		t.Fatal("response permit was released before writing finished")
	}
	release.Do(func() { close(first.release) })
	<-done
	next := httptest.NewRecorder()
	router.ServeHTTP(next, httptest.NewRequest("GET", "/reader", nil))
	if next.Code != 200 {
		t.Fatal("completed response retained its permit")
	}
}
