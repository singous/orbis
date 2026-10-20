// Package tasks owns durable import dispatch, queue workers and their shutdown.
package tasks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
)

const importConcurrency = 2

const importTaskType = "orbis:markdown-import"

type ImportRepository interface {
	DispatchImports(context.Context, func(context.Context, string, bool) error) error
	ProcessImport(context.Context, string) error
}
type Imports struct {
	slots     chan struct{}
	server    *asynq.Server
	redis     *redis.Client
	client    *asynq.Client
	inspector *asynq.Inspector
	queue     string
	repo      ImportRepository
	logger    *slog.Logger
	cancel    context.CancelFunc
	done      chan struct{}
	mu        sync.Mutex
	stopping  bool
	workers   sync.WaitGroup
	closeOnce sync.Once
	closeErr  error
}
type importTask struct {
	ImportID string `json:"import_id"`
}

func StartImports(ctx context.Context, redisURL, namespace string, repo ImportRepository, logger *slog.Logger) (*Imports, error) {
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, errors.New("invalid import Redis configuration")
	}
	options.DialTimeout = 2 * time.Second
	options.ReadTimeout = 2 * time.Second
	options.WriteTimeout = 2 * time.Second
	options.ContextTimeoutEnabled = true
	options.MaxRetries = -1
	client := redis.NewClient(options)
	ping, cancelPing := context.WithTimeout(ctx, 3*time.Second)
	defer cancelPing()
	if err := client.Ping(ping).Err(); err != nil {
		_ = client.Close()
		return nil, errors.New("connect import Redis")
	}
	owner, cancel := context.WithCancel(context.Background())
	runtime := &Imports{redis: client, repo: repo, queue: "orbis-imports-" + namespace, logger: logger, cancel: cancel, done: make(chan struct{}), slots: make(chan struct{}, importConcurrency)}
	runtime.client = asynq.NewClientFromRedisClient(client)
	runtime.inspector = asynq.NewInspectorFromRedisClient(client)
	runtime.server = asynq.NewServerFromRedisClient(client, asynq.Config{Concurrency: importConcurrency, Queues: map[string]int{runtime.queue: 1}, BaseContext: func() context.Context { return owner }, ShutdownTimeout: 5 * time.Second, Logger: queueLogger{logger}, LogLevel: asynq.WarnLevel, RetryDelayFunc: func(n int, _ error, _ *asynq.Task) time.Duration {
		return min(time.Duration(n+1)*time.Second, time.Minute)
	}, ErrorHandler: asynq.ErrorHandlerFunc(func(ctx context.Context, task *asynq.Task, err error) {
		var input importTask
		if json.Unmarshal(task.Payload(), &input) == nil {
			logger.WarnContext(ctx, "import task will retry", "import_id", input.ImportID)
		}
	})})
	mux := asynq.NewServeMux()
	mux.HandleFunc(importTaskType, runtime.process)
	if err := runtime.server.Start(mux); err != nil {
		cancel()
		_ = client.Close()
		return nil, fmt.Errorf("start import workers")
	}
	go runtime.dispatch(owner)
	return runtime, nil
}
func (r *Imports) process(ctx context.Context, task *asynq.Task) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case r.slots <- struct{}{}:
	case <-ctx.Done():
		return ctx.Err()
	}
	defer func() { <-r.slots }()
	r.mu.Lock()
	if r.stopping {
		r.mu.Unlock()
		return context.Canceled
	}
	r.workers.Add(1)
	r.mu.Unlock()
	defer r.workers.Done()
	var input importTask
	if err := json.Unmarshal(task.Payload(), &input); err != nil {
		return asynq.SkipRetry
	}
	if _, err := uuid.Parse(input.ImportID); err != nil {
		return asynq.SkipRetry
	}
	return r.repo.ProcessImport(ctx, input.ImportID)
}
func (r *Imports) dispatch(ctx context.Context) {
	defer close(r.done)
	timer := time.NewTicker(time.Second)
	defer timer.Stop()
	for {
		if err := r.repo.DispatchImports(ctx, r.ensureQueued); err != nil && ctx.Err() == nil {
			r.logger.WarnContext(ctx, "import outbox dispatch deferred")
		}
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
	}
}
func (r *Imports) ensureQueued(ctx context.Context, id string, dispatched bool) error {
	taskID := "import:" + id
	if dispatched {
		info, err := r.inspector.GetTaskInfo(r.queue, taskID)
		if err == nil {
			switch info.State {
			case asynq.TaskStateArchived:
				return r.inspector.RunTask(r.queue, taskID)
			case asynq.TaskStateCompleted:
				if err := r.inspector.DeleteTask(r.queue, taskID); err != nil {
					return err
				}
			default:
				return nil
			}
		} else if !errors.Is(err, asynq.ErrTaskNotFound) {
			return err
		}
	}
	payload, err := json.Marshal(importTask{ImportID: id})
	if err != nil {
		return err
	}
	_, err = r.client.EnqueueContext(ctx, asynq.NewTask(importTaskType, payload), asynq.Queue(r.queue), asynq.TaskID(taskID), asynq.MaxRetry(20), asynq.Timeout(5*time.Minute), asynq.Retention(24*time.Hour))
	if errors.Is(err, asynq.ErrTaskIDConflict) {
		return nil
	}
	return err
}
func (r *Imports) Close() error {
	if r == nil {
		return nil
	}
	r.closeOnce.Do(func() {
		r.mu.Lock()
		r.stopping = true
		r.mu.Unlock()
		r.cancel()
		r.server.Stop()
		r.server.Shutdown()
		<-r.done
		// Asynq can return timed-out handlers to Redis; join our actual handlers before closing their stores.
		r.workers.Wait()
		r.closeErr = r.redis.Close()
	})
	return r.closeErr
}

// Queue internals may contain arbitrary handler errors. Application logs identify the import separately without raw causes.
type queueLogger struct{ logger *slog.Logger }

func (l queueLogger) Debug(...interface{}) {}
func (l queueLogger) Info(...interface{})  {}
func (l queueLogger) Warn(...interface{})  { l.logger.Warn("queue runtime warning") }
func (l queueLogger) Error(...interface{}) { l.logger.Error("queue runtime error") }
func (l queueLogger) Fatal(...interface{}) { l.logger.Error("queue runtime fatal event") }
