package database

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"orbis.local/orbis/migrations"
)

// Open creates a bounded pool and performs the initial ping with the caller context.
func Open(ctx context.Context, databaseURL string) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(databaseURL), &gorm.Config{
		Logger:               logger.Default.LogMode(logger.Silent),
		DisableAutomaticPing: true,
	})
	if err != nil {
		return nil, fmt.Errorf("connect to PostgreSQL")
	}
	pool, err := db.DB()
	if err != nil {
		return nil, err
	}
	pool.SetMaxOpenConns(10)
	pool.SetMaxIdleConns(5)
	pool.SetConnMaxLifetime(30 * time.Minute)
	if err := pool.PingContext(ctx); err != nil {
		return nil, errors.Join(fmt.Errorf("ping PostgreSQL: %w", err), pool.Close())
	}
	return db, nil
}

// CheckSchema rejects absent, dirty, older, and newer migration versions without mutating the database.
func CheckSchema(ctx context.Context, db *gorm.DB) error {
	var state struct {
		Version int
		Dirty   bool
	}
	if err := db.WithContext(ctx).Table("schema_migrations").Take(&state).Error; err != nil {
		return fmt.Errorf("database migrations are required")
	}
	if state.Dirty || state.Version != migrations.Version {
		return fmt.Errorf("database schema is not supported; run the migration command")
	}
	return nil
}
