package config

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/zalando/go-keyring"
	"orbis.local/orbis/cli/internal/client"
)

type Config struct {
	BaseURL     string
	Workspace   string
	Token       string
	TokenSource string
	Profile     string
	AllowHTTP   bool
	Timeout     time.Duration
}
type Profile struct {
	BaseURL   string `json:"base_url"`
	Workspace string `json:"workspace_id"`
	AllowHTTP bool   `json:"allow_http"`
}
type Store interface {
	Get(string, string) (string, error)
	Set(string, string, string) error
	Delete(string, string) error
}
type SystemStore struct{}

func (SystemStore) Get(s, u string) (string, error) { return keyring.Get(s, u) }
func (SystemStore) Set(s, u, p string) error        { return keyring.Set(s, u, p) }
func (SystemStore) Delete(s, u string) error        { return keyring.Delete(s, u) }
func CredentialName(profile, base string) string {
	sum := sha256.Sum256([]byte(base))
	return profile + ":" + hex.EncodeToString(sum[:])
}
func Path(getenv func(string) string) (string, error) {
	dir := getenv("ORBIS_CONFIG_DIR")
	if dir == "" {
		h, err := os.UserHomeDir()
		if err != nil {
			return "", client.Failure("CLI_CONFIG_INVALID", "无法定位配置目录", 2, nil)
		}
		dir = filepath.Join(h, ".config", "orbis")
	}
	return filepath.Join(dir, "config.json"), nil
}
func Profiles(path string) (map[string]Profile, error) {
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return map[string]Profile{}, nil
	}
	if err != nil {
		return nil, client.Failure("CLI_CONFIG_INVALID", "无法读取配置文件", 2, map[string]any{"path": path})
	}
	var raw map[string]json.RawMessage
	if json.Unmarshal(b, &raw) != nil || raw == nil {
		return nil, client.Failure("CLI_CONFIG_INVALID", "配置文件必须是 JSON 对象", 2, nil)
	}
	result := map[string]Profile{}
	for name, b := range raw {
		var fields map[string]json.RawMessage
		if json.Unmarshal(b, &fields) != nil || fields == nil {
			return nil, client.Failure("CLI_CONFIG_INVALID", "配置项格式无效", 2, nil)
		}
		var p Profile
		for key, target := range map[string]any{"base_url": &p.BaseURL, "workspace_id": &p.Workspace, "allow_http": &p.AllowHTTP} {
			if raw, present := fields[key]; present {
				if string(raw) == "null" || json.Unmarshal(raw, target) != nil {
					return nil, client.Failure("CLI_CONFIG_INVALID", "配置项类型无效", 2, nil)
				}
			}
		}
		result[name] = p
	}
	return result, nil
}
func Load(flags map[string]string, getenv func(string) string, store Store) (Config, error) {
	path, err := Path(getenv)
	if err != nil {
		return Config{}, err
	}
	profiles, err := Profiles(path)
	if err != nil {
		return Config{}, err
	}
	first := func(values ...string) string {
		for _, v := range values {
			if v != "" {
				return v
			}
		}
		return ""
	}
	name := first(flags["profile"], getenv("ORBIS_PROFILE"), "default")
	saved := profiles[name]
	timeout := 15.0
	if raw := flags["timeout"]; raw != "" {
		if json.Unmarshal([]byte(raw), &timeout) != nil || math.IsNaN(timeout) || math.IsInf(timeout, 0) || timeout <= 0 || timeout > 60 {
			return Config{}, client.Failure("CLI_TIMEOUT_INVALID", "请求超时必须大于零且不超过 60 秒", 2, nil)
		}
	}
	allowHTTP := saved.AllowHTTP
	if value, supplied := flags["allow-http"]; supplied {
		allowHTTP = value == "true"
	}
	c := Config{BaseURL: strings.TrimRight(first(flags["base-url"], getenv("ORBIS_BASE_URL"), saved.BaseURL), "/"), Workspace: first(flags["workspace"], getenv("ORBIS_WORKSPACE_ID"), saved.Workspace), Profile: name, AllowHTTP: allowHTTP, Timeout: time.Duration(timeout * float64(time.Second))}
	c.Token = getenv("ORBIS_TOKEN")
	if c.Token != "" {
		c.TokenSource = "env"
	} else if c.BaseURL != "" && store != nil {
		c.Token, _ = store.Get("orbis-cli", CredentialName(name, c.BaseURL))
		if c.Token != "" {
			c.TokenSource = "keyring"
		}
	}
	if c.TokenSource == "" {
		c.TokenSource = "missing"
	}
	return c, nil
}
func UUID(v string) bool {
	if len(v) != 36 {
		return false
	}
	for i, c := range v {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
		} else if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}
func Validate(c Config, auth bool) error {
	if c.BaseURL == "" {
		return client.Failure("CLI_CONFIG_MISSING", "请配置 ORBIS_BASE_URL 或使用 config set", 2, nil)
	}
	u, err := url.Parse(c.BaseURL)
	if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || strings.ContainsAny(c.BaseURL, "\r\n\x00") {
		return client.Failure("CLI_URL_INVALID", "实例地址必须为不含凭据、查询和片段的 HTTP(S) URL", 2, nil)
	}
	if u.Scheme == "http" && !c.AllowHTTP {
		return client.Failure("CLI_HTTPS_REQUIRED", "可信开发实例使用 HTTP 时须显式指定 --allow-http", 2, nil)
	}
	if !UUID(c.Workspace) {
		return client.Failure("CLI_WORKSPACE_REQUIRED", "请使用 --workspace 或 ORBIS_WORKSPACE_ID 指定工作空间 UUID", 2, nil)
	}
	if auth && c.Token == "" {
		return client.Failure("CLI_AUTH_MISSING", "请配置 ORBIS_TOKEN 或运行 auth login --token-stdin", 3, nil)
	}
	return nil
}
func Save(c Config, getenv func(string) string) (any, error) {
	if err := Validate(c, false); err != nil {
		return nil, err
	}
	path, err := Path(getenv)
	if err != nil {
		return nil, err
	}
	all, err := Profiles(path)
	if err != nil {
		return nil, err
	}
	all[c.Profile] = Profile{c.BaseURL, c.Workspace, c.AllowHTTP}
	b, err := json.MarshalIndent(all, "", "  ")
	if err != nil {
		return nil, err
	}
	if os.MkdirAll(filepath.Dir(path), 0700) != nil {
		return nil, client.Failure("CLI_CONFIG_INVALID", "无法创建配置目录", 2, nil)
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".config-*")
	if err != nil {
		return nil, client.Failure("CLI_CONFIG_INVALID", "无法保存配置", 2, nil)
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(b); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(f.Name(), path)
	}
	if err != nil {
		return nil, client.Failure("CLI_CONFIG_INVALID", "无法保存配置", 2, nil)
	}
	return map[string]any{"profile": c.Profile, "path": path, "base_url": c.BaseURL, "workspace_id": c.Workspace, "allow_http": c.AllowHTTP}, nil
}
func StoreToken(c Config, token string, store Store) error {
	var err error
	if token == "" {
		err = store.Delete("orbis-cli", CredentialName(c.Profile, c.BaseURL))
		if errors.Is(err, keyring.ErrNotFound) {
			err = nil
		}
	} else {
		err = store.Set("orbis-cli", CredentialName(c.Profile, c.BaseURL), token)
	}
	if err != nil {
		return client.Failure("CLI_CREDENTIAL_STORE_UNAVAILABLE", "系统凭据存储不可用，请通过密钥管理器提供 ORBIS_TOKEN", 3, nil)
	}
	return nil
}
