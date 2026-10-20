package config_test

import (
	"strings"
	"testing"

	"orbis.local/orbis/internal/platform/config"
)

func TestStorageConfigurationLimits(t *testing.T) {
	t.Setenv("ORBIS_DATABASE_URL", "postgres://test:test@localhost/orbis_test")
	t.Setenv("ORBIS_SIGNING_KEY", strings.Repeat("test-key", 8))
	t.Setenv("ORBIS_MAIL_TRANSPORT", "disabled")
	t.Setenv("ORBIS_LISTEN_ADDRESS", "127.0.0.1:9202")
	t.Setenv("ORBIS_MAX_BODY_BYTES", "")
	t.Setenv("ORBIS_MAX_UPLOAD_BYTES", "")
	t.Setenv("ORBIS_STORAGE_DIR", "")
	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.MaxUploadBytes != config.DefaultUploadLimit || cfg.StorageDirectory != config.DefaultStorageDirectory {
		t.Fatal("storage defaults are incorrect")
	}
	for _, value := range []string{"0", "-1", "1073741825", "invalid"} {
		t.Setenv("ORBIS_MAX_UPLOAD_BYTES", value)
		if _, err := config.Load(); err == nil {
			t.Fatal("invalid upload limit accepted")
		}
	}
	t.Setenv("ORBIS_MAX_UPLOAD_BYTES", "1073741824")
	t.Setenv("ORBIS_STORAGE_DIR", "/private/objects")
	cfg, err = config.Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.MaxUploadBytes != config.MaxUploadLimit || cfg.StorageDirectory != "/private/objects" {
		t.Fatal("explicit storage configuration was ignored")
	}
}
