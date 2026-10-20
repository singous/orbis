package database

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
)

const advisoryAcquireTimeout = 5 * time.Second

var ErrAdvisoryBusy = errors.New("advisory resource already owned")

// WithAdvisoryOwner retains its transaction lock until work actually returns, even after the work context is canceled.
// Its separate resource context never authorizes business I/O; work must continue using the original caller context.
func WithAdvisoryOwner(ctx context.Context, db *gorm.DB, key int64, work func() error) (result error) {
	if err := ctx.Err(); err != nil {
		return err
	}
	resource, cancel := context.WithCancel(context.WithoutCancel(ctx))
	defer cancel()
	timer := time.AfterFunc(advisoryAcquireTimeout, cancel)
	guard := db.WithContext(resource).Begin()
	if !timer.Stop() {
		_ = guard.Rollback().Error
		return fmt.Errorf("acquire advisory connection: %w", context.DeadlineExceeded)
	}
	if guard.Error != nil {
		return guard.Error
	}
	defer func() { result = errors.Join(result, guard.Rollback().Error) }()
	var admitted bool
	if err := guard.WithContext(ctx).Raw("SELECT pg_try_advisory_xact_lock(?)", key).Scan(&admitted).Error; err != nil {
		return err
	}
	if !admitted {
		return ErrAdvisoryBusy
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return work()
}
