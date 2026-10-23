package tasks

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
	"orbis.local/orbis/internal/platform/clock"
)

const (
	versionTaskType         = "orbis:document-version"
	versionDispatchInterval = 10 * time.Second
	versionTaskTimeout      = 30 * time.Second
	versionQueueUnique      = 45 * time.Second
)

type VersionRepository interface {
	DueVersions(context.Context, int64) ([]string, error)
	VersionDispatched(context.Context, string, int64) error
	CaptureAutomatic(context.Context, string, int64) error
}

type Versions struct {
	repo      VersionRepository
	clock     clock.Clock
	logger    *slog.Logger
	redis     *redis.Client
	client    *asynq.Client
	server    *asynq.Server
	queue     string
	cancel    context.CancelFunc
	done      chan struct{}
	mu        sync.Mutex
	stopping  bool
	workers   sync.WaitGroup
	closeOnce sync.Once
	closeErr  error
}

func StartVersions(ctx context.Context, redisURL, namespace string, repo VersionRepository, c clock.Clock, logger *slog.Logger) (*Versions, error) {
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, errors.New("invalid version Redis configuration")
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
		return nil, errors.New("connect version Redis")
	}
	owner, cancel := context.WithCancel(context.WithoutCancel(ctx))
	r := &Versions{repo: repo, clock: c, logger: logger, redis: client, client: asynq.NewClientFromRedisClient(client), queue: "orbis-versions-" + namespace, cancel: cancel, done: make(chan struct{})}
	r.server = asynq.NewServerFromRedisClient(client, asynq.Config{Concurrency: 1, Queues: map[string]int{r.queue: 1}, BaseContext: func() context.Context { return owner }, ShutdownTimeout: 5 * time.Second, Logger: queueLogger{logger}, LogLevel: asynq.WarnLevel})
	mux := asynq.NewServeMux()
	mux.HandleFunc(versionTaskType, r.process)
	if err := r.server.Start(mux); err != nil {
		cancel()
		_ = client.Close()
		return nil, errors.New("start document version worker")
	}
	go r.dispatch(owner)
	return r, nil
}

func (r *Versions) process(ctx context.Context, task *asynq.Task) error {
	r.mu.Lock()
	if r.stopping {
		r.mu.Unlock()
		return context.Canceled
	}
	r.workers.Add(1)
	r.mu.Unlock()
	defer r.workers.Done()
	var id string
	if err := json.Unmarshal(task.Payload(), &id); err != nil {
		return asynq.SkipRetry
	}
	if _, err := uuid.Parse(id); err != nil {
		return asynq.SkipRetry
	}
	return r.repo.CaptureAutomatic(ctx, id, r.clock.Now().UnixMilli())
}

func (r *Versions) dispatch(ctx context.Context) {
	defer close(r.done)
	ticker := time.NewTicker(versionDispatchInterval)
	defer ticker.Stop()
	for {
		batch, cancel := context.WithTimeout(ctx, versionTaskTimeout)
		if err := r.dispatchBatch(batch); err != nil && ctx.Err() == nil {
			r.logger.WarnContext(ctx, "document version dispatch deferred")
		}
		cancel()
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (r *Versions) dispatchBatch(ctx context.Context) error {
	now := r.clock.Now().UnixMilli()
	ids, err := r.repo.DueVersions(ctx, now)
	if err != nil {
		return err
	}
	for _, id := range ids {
		payload, err := json.Marshal(id)
		if err != nil {
			return err
		}
		_, err = r.client.EnqueueContext(ctx, asynq.NewTask(versionTaskType, payload), asynq.Queue(r.queue), asynq.Unique(versionQueueUnique), asynq.Timeout(versionTaskTimeout), asynq.MaxRetry(3))
		if err != nil && !errors.Is(err, asynq.ErrDuplicateTask) {
			return err
		}
		if err := r.repo.VersionDispatched(ctx, id, now); err != nil {
			return err
		}
	}
	return nil
}

func (r *Versions) Close() error {
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
		r.workers.Wait()
		r.closeErr = r.redis.Close()
	})
	return r.closeErr
}
