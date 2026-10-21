package config

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const DefaultAddress = "127.0.0.1:9202"
const DefaultBodyLimit = 8 << 20
const DefaultUploadLimit int64 = 32 << 20
const MaxUploadLimit int64 = 1 << 30
const DefaultStorageDirectory = ".dev/storage"
const minimumSigningKeyBytes = 32

type Config struct {
	CollaborationURL    string
	CollaborationKey    string
	LegacyRefreshSecret string
	LegacyActionSecret  string
	RedisURL            string
	Address             string
	DatabaseURL         string
	SigningKey          string
	AccessTTL           time.Duration
	RefreshTTL          time.Duration
	ReadTimeout         time.Duration
	WriteTimeout        time.Duration
	ShutdownTimeout     time.Duration
	MaxBodyBytes        int64
	Mail                Mail
	StorageDirectory    string
	MaxUploadBytes      int64
}

// Load uses only explicit environment variables and validates all required runtime settings.
func Load() (Config, error) {
	c := Config{LegacyRefreshSecret: os.Getenv("ORBIS_LEGACY_REFRESH_SECRET"), LegacyActionSecret: os.Getenv("ORBIS_LEGACY_ACTION_SECRET"), RedisURL: os.Getenv("ORBIS_REDIS_URL"), Address: ListenAddress(), DatabaseURL: os.Getenv("ORBIS_DATABASE_URL"),
		SigningKey: os.Getenv("ORBIS_SIGNING_KEY"), AccessTTL: 15 * time.Minute,
		RefreshTTL: 30 * 24 * time.Hour, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second,
		ShutdownTimeout: 15 * time.Second, MaxBodyBytes: DefaultBodyLimit, Mail: loadMail(), StorageDirectory: DefaultStorageDirectory, MaxUploadBytes: DefaultUploadLimit}
	if v := os.Getenv("ORBIS_MAX_BODY_BYTES"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 1024 || n > 64<<20 {
			return c, fmt.Errorf("ORBIS_MAX_BODY_BYTES must be between 1024 and 67108864")
		}
		c.MaxBodyBytes = n
	}
	c.CollaborationURL = os.Getenv("ORBIS_COLLABORATION_URL")
	c.CollaborationKey = os.Getenv("ORBIS_COLLABORATION_KEY")
	if v := os.Getenv("ORBIS_STORAGE_DIR"); v != "" {
		c.StorageDirectory = v
	}
	if v := os.Getenv("ORBIS_MAX_UPLOAD_BYTES"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return c, fmt.Errorf("ORBIS_MAX_UPLOAD_BYTES must be an integer")
		}
		c.MaxUploadBytes = n
	}
	return c, c.Validate()
}

// Validate rejects unusable limits and missing or placeholder credentials.
func (c Config) Validate() error {
	if c.CollaborationURL != "" {
		u, err := url.Parse(c.CollaborationURL)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
			return fmt.Errorf("ORBIS_COLLABORATION_URL must identify an HTTP service origin")
		}
		if len(c.CollaborationKey) < 32 || strings.HasPrefix(c.CollaborationKey, "REPLACE_") || strings.ContainsAny(c.CollaborationKey, "\r\n") {
			return fmt.Errorf("ORBIS_COLLABORATION_KEY must contain at least 32 bytes")
		}
	} else if c.CollaborationKey != "" {
		return fmt.Errorf("ORBIS_COLLABORATION_URL is required with its key")
	}
	if _, _, err := net.SplitHostPort(c.Address); err != nil {
		return fmt.Errorf("invalid listen address")
	}
	if err := ValidateDatabaseURL(c.DatabaseURL); err != nil {
		return err
	}
	if len(c.SigningKey) < minimumSigningKeyBytes || strings.HasPrefix(c.SigningKey, "REPLACE_") {
		return fmt.Errorf("ORBIS_SIGNING_KEY must contain at least 32 bytes")
	}
	if c.AccessTTL <= 0 || c.RefreshTTL <= c.AccessTTL {
		return fmt.Errorf("invalid session lifetimes")
	}
	if c.MaxBodyBytes <= 0 || c.ReadTimeout <= 0 || c.WriteTimeout <= 0 || c.ShutdownTimeout <= 0 {
		return fmt.Errorf("invalid server limits")
	}
	if strings.TrimSpace(c.StorageDirectory) == "" || strings.ContainsRune(c.StorageDirectory, 0) {
		return fmt.Errorf("ORBIS_STORAGE_DIR must be a directory")
	}
	if c.MaxUploadBytes < 1 || c.MaxUploadBytes > MaxUploadLimit {
		return fmt.Errorf("ORBIS_MAX_UPLOAD_BYTES must be between 1 and 1073741824")
	}
	if c.RedisURL != "" {
		u, err := url.Parse(c.RedisURL)
		if err != nil || u.Host == "" || (u.Scheme != "redis" && u.Scheme != "rediss") {
			return fmt.Errorf("ORBIS_REDIS_URL must be a Redis URL")
		}
	}
	for name, value := range map[string]string{"ORBIS_LEGACY_REFRESH_SECRET": c.LegacyRefreshSecret, "ORBIS_LEGACY_ACTION_SECRET": c.LegacyActionSecret} {
		if value != "" && (len(value) < 16 || len(value) > 4096) {
			return fmt.Errorf("%s must contain 16 to 4096 bytes when enabled", name)
		}
	}
	return c.Mail.Validate()
}

// ListenAddress is shared by server startup and the container readiness probe.
func ListenAddress() string {
	if value := os.Getenv("ORBIS_LISTEN_ADDRESS"); value != "" {
		return value
	}
	return DefaultAddress
}

// ValidateDatabaseURL reports invalid configuration without echoing credential-bearing input.
func ValidateDatabaseURL(value string) error {
	u, err := url.Parse(value)
	if err != nil || u == nil {
		return fmt.Errorf("ORBIS_DATABASE_URL must be an explicit PostgreSQL URL")
	}
	validScheme := u.Scheme == "postgres" || u.Scheme == "postgresql"
	if !validScheme || u.Host == "" || len(u.Path) < 2 {
		return fmt.Errorf("ORBIS_DATABASE_URL must be an explicit PostgreSQL URL")
	}
	return nil
}
