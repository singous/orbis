package config

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type fakeStore struct {
	value string
	err   error
}

func (s *fakeStore) Get(string, string) (string, error) { return s.value, s.err }
func (s *fakeStore) Set(_, _, v string) error           { s.value = v; return s.err }
func (s *fakeStore) Delete(string, string) error        { s.value = ""; return s.err }
func TestProfileNeverPersistsCredentialsAndFlagsOverrideEnvironment(t *testing.T) {
	dir := t.TempDir()
	env := map[string]string{"ORBIS_CONFIG_DIR": dir, "ORBIS_WORKSPACE_ID": "b2f97637-0128-49f1-be82-f33ba1aedafc", "ORBIS_TOKEN": "orbis_it_no_persist", "ORBIS_BASE_URL": "https://old.example"}
	c, err := Load(map[string]string{"base-url": "https://new.example/api", "profile": "work"}, func(k string) string { return env[k] }, &fakeStore{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Save(c, func(k string) string { return env[k] }); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(filepath.Join(dir, "config.json"))
	if strings.Contains(string(b), "orbis_it_") || !strings.Contains(string(b), "new.example") {
		t.Fatal("incorrect or secret profile")
	}
	info, _ := os.Stat(filepath.Join(dir, "config.json"))
	if info.Mode().Perm()&0077 != 0 {
		t.Fatalf("profile mode too open: %o", info.Mode().Perm())
	}
}
func TestCorruptProfilesAreRejected(t *testing.T) {
	for _, value := range []string{`null`, `[]`, `{"default":null}`, `{"default":{"base_url":null}}`, `{"default":{"allow_http":"false"}}`} {
		t.Run(value, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "config.json")
			if err := os.WriteFile(path, []byte(value), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := Profiles(path); err == nil {
				t.Fatal("accepted malformed profile")
			}
		})
	}
}
func TestValidationRejectsUnsafeInstanceAndMissingWorkspace(t *testing.T) {
	c := Config{BaseURL: "https://orbis.example", Workspace: "b2f97637-0128-49f1-be82-f33ba1aedafc", Token: "secret", Timeout: time.Second}
	for _, base := range []string{"http://orbis.example", "https://user:pass@orbis.example", "https://orbis.example?secret=yes", "https://orbis.example#fragment", "file:///tmp/test", "https://orbis.example:bad"} {
		changed := c
		changed.BaseURL = base
		if Validate(changed, true) == nil {
			t.Fatalf("accepted unsafe URL %s", base)
		}
	}
	c.Workspace = ""
	if Validate(c, true) == nil {
		t.Fatal("missing workspace accepted")
	}
}
func TestUnavailableCredentialStoreHasNoFileFallback(t *testing.T) {
	store := &fakeStore{err: errors.New("unavailable")}
	if err := StoreToken(Config{Profile: "default", BaseURL: "https://orbis.example"}, "synthetic", store); err == nil {
		t.Fatal("credential write silently succeeded")
	}
}

func TestExplicitFalseDisablesSavedHTTPOptIn(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	if err := os.WriteFile(path, []byte(`{"default":{"base_url":"http://orbis.example","workspace_id":"b2f97637-0128-49f1-be82-f33ba1aedafc","allow_http":true}}`), 0600); err != nil {
		t.Fatal(err)
	}
	getenv := func(key string) string {
		if key == "ORBIS_CONFIG_DIR" {
			return dir
		}
		return ""
	}
	inherited, err := Load(map[string]string{}, getenv, &fakeStore{})
	if err != nil || !inherited.AllowHTTP {
		t.Fatal("missing flag did not preserve profile")
	}
	disabled, err := Load(map[string]string{"allow-http": "false"}, getenv, &fakeStore{})
	if err != nil || disabled.AllowHTTP || Validate(disabled, false) == nil {
		t.Fatal("explicit false kept HTTP allowed")
	}
	disabled.BaseURL = "https://orbis.example"
	if _, err := Save(disabled, getenv); err != nil {
		t.Fatal(err)
	}
	reloaded, err := Load(map[string]string{}, getenv, &fakeStore{})
	if err != nil || reloaded.AllowHTTP {
		t.Fatal("disabled opt-in was not persisted")
	}
}
