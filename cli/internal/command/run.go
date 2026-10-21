package command

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"

	"orbis.local/orbis/cli/internal/client"
	"orbis.local/orbis/cli/internal/config"
)

type Runtime struct {
	In       io.Reader
	Out, Err io.Writer
	Getenv   func(string) string
	Store    config.Store
}

func Default() Runtime {
	return Runtime{In: os.Stdin, Out: os.Stdout, Err: os.Stderr, Getenv: os.Getenv, Store: config.SystemStore{}}
}

var tokenPattern = regexp.MustCompile(`orbis_it_[A-Za-z0-9_-]+`)
var credentialURL = regexp.MustCompile(`(https?://)[^/\s"]+@`)

func (r Runtime) Run(ctx context.Context, argv []string) int {
	machine := false
	for _, v := range argv {
		if v == "--json" || v == "--json=true" {
			machine = true
		}
	}
	a, err := parse(argv)
	if err == nil && a.help {
		fmt.Fprint(r.Out, help)
		key := strings.TrimSpace(a.family + " " + a.command)
		if s, ok := specs[key]; ok {
			fmt.Fprintf(r.Out, "\n当前命令: orbis %s\n", key)
			if s.positionals > 0 {
				fmt.Fprintf(r.Out, "位置参数数量: %d\n", s.positionals)
			}
			for _, option := range strings.Fields(s.values + " " + s.bools) {
				suffix := ""
				if strings.Contains(" "+s.required+" ", " "+option+" ") {
					suffix = " (必填)"
				}
				fmt.Fprintf(r.Out, "  --%s%s\n", option, suffix)
			}
		}
		return 0
	}
	if err == nil && a.version {
		fmt.Fprintln(r.Out, client.Version)
		return 0
	}
	var env client.Envelope
	if err == nil {
		env, err = r.execute(ctx, a)
	}
	exit := 0
	if err != nil {
		var failure *client.Error
		if errors.As(err, &failure) {
			env = failure.Envelope
			exit = failure.ExitCode
			if failure.Uncertain {
				env = client.Network(map[string]any{"state": "unknown", "cause": failure.Code}).Envelope
				exit = 6
			}
		} else if ctx.Err() != nil {
			return 130
		} else {
			env = client.Failure("CLI_INTERNAL_ERROR", "命令执行失败", 7, nil).Envelope
			exit = 7
		}
	}
	secret := r.Getenv("ORBIS_TOKEN")
	redactor := client.Client{Token: secret}
	env.Message = redactor.Redact(env.Message, false).(string)
	env.Data = redactor.Redact(env.Data, false)
	encoded, encodeErr := json.Marshal(env)
	if !machine {
		encoded, encodeErr = json.MarshalIndent(env, "", "  ")
	}
	if encodeErr != nil {
		return 7
	}
	rendered := string(encoded)
	if secret != "" {
		rendered = strings.ReplaceAll(rendered, secret, "[REDACTED]")
	}
	rendered = tokenPattern.ReplaceAllString(rendered, "[REDACTED]")
	rendered = credentialURL.ReplaceAllString(rendered, "${1}[REDACTED]@")
	if exit != 0 && !machine {
		var safe client.Envelope
		_ = json.Unmarshal([]byte(rendered), &safe)
		_, encodeErr = fmt.Fprintln(r.Err, safe.Code+": "+safe.Message)
	} else {
		_, encodeErr = fmt.Fprintln(r.Out, rendered)
	}
	if encodeErr != nil || ctx.Err() != nil {
		return 130
	}
	return exit
}
func (r Runtime) execute(ctx context.Context, a arguments) (client.Envelope, error) {
	c, err := config.Load(a.flags, r.Getenv, r.Store)
	if err != nil {
		return client.Envelope{}, err
	}
	if _, err := waitDuration(a.flags["wait-seconds"]); err != nil {
		return client.Envelope{}, err
	}
	if a.family == "config" {
		if a.command == "set" {
			v, err := config.Save(c, r.Getenv)
			return client.OK(v), err
		}
		return client.OK(map[string]any{"base_url": nullable(c.BaseURL), "workspace_id": nullable(c.Workspace), "profile": c.Profile, "allow_http": c.AllowHTTP, "token_source": c.TokenSource}), nil
	}
	if a.family == "api" {
		return client.OK(map[string]any{"endpoints": endpoints, "prefix": "/api/v1/agent/workspaces/{workspace_id}", "schema_command": "orbis --json schema"}), nil
	}
	if a.family == "auth" && a.command == "logout" {
		if err := config.Validate(c, false); err != nil {
			return client.Envelope{}, err
		}
		err := config.StoreToken(c, "", r.Store)
		return client.OK(map[string]any{"profile": c.Profile, "saved_token_removed": true, "environment_token_active": c.TokenSource == "env"}), err
	}
	if a.family == "auth" && a.command == "login" {
		token, err := readToken(r.In)
		if err != nil {
			return client.Envelope{}, err
		}
		c.Token = token
		c.TokenSource = "stdin"
	}
	if a.family == "doctor" {
		data := map[string]any{"client_version": client.Version, "base_url": nullable(c.BaseURL), "workspace_id": nullable(c.Workspace), "profile": c.Profile, "token_available": c.Token != "", "token_source": c.TokenSource, "network": "unchecked", "missing": []string{}}
		err := config.Validate(c, true)
		if err == nil {
			api := client.New(c.BaseURL, c.Workspace, c.Token, c.Timeout)
			defer api.Close()
			var identity, capabilities client.Envelope
			identity, err = api.Agent(ctx, "GET", "/me", client.Request{Retries: 2})
			if err == nil {
				data["identity"] = identity.Data
				capabilities, err = api.Agent(ctx, "GET", "/capabilities", client.Request{Retries: 2})
				if err == nil {
					data["capabilities"] = capabilities.Data
					data["network"] = "reachable"
				}
			}
		}
		if err != nil {
			var fail *client.Error
			if !errors.As(err, &fail) {
				fail = client.Network(nil)
			}
			data["missing"] = []string{fail.Code}
			data["error"] = fail.Envelope
			return client.Envelope{}, client.Failure("CLI_DOCTOR_FAILED", "实例配置或连接需要检查", fail.ExitCode, data)
		}
		return client.OK(data), nil
	}
	if err := config.Validate(c, true); err != nil {
		return client.Envelope{}, err
	}
	api := client.New(c.BaseURL, c.Workspace, c.Token, c.Timeout)
	defer api.Close()
	if a.family == "auth" {
		identity, err := api.Agent(ctx, "GET", "/me", client.Request{Retries: 2})
		if err != nil {
			return identity, err
		}
		if a.command == "login" {
			if err := config.StoreToken(c, c.Token, r.Store); err != nil {
				return client.Envelope{}, err
			}
			if _, err := config.Save(c, r.Getenv); err != nil {
				return client.Envelope{}, err
			}
			return client.OK(map[string]any{"identity": identity.Data, "token_source": "keyring", "profile": c.Profile}), nil
		}
		return identity, nil
	}
	return r.remote(ctx, a, c, api)
}
func nullable(v string) any {
	if v == "" {
		return nil
	}
	return v
}
func readToken(source io.Reader) (string, error) {
	b, err := io.ReadAll(io.LimitReader(source, 1025))
	if err != nil {
		return "", client.Failure("CLI_TOKEN_INVALID", "无法读取令牌", 3, nil)
	}
	token := strings.TrimSpace(string(b))
	if len(b) > 1024 || !strings.HasPrefix(token, "orbis_it_") || strings.ContainsAny(token, " \r\n\t") {
		return "", client.Failure("CLI_TOKEN_INVALID", "请通过标准输入提供有效且有界的集成令牌", 3, nil)
	}
	return token, nil
}

var endpoints = []string{"GET /capabilities", "GET /me", "GET /workspaces", "GET /collections", "GET /documents", "GET /search", "POST /resolve", "POST /documents", "GET /documents/{document_id}", "GET /documents/{document_id}/outline", "GET /documents/{document_id}/blocks", "GET /documents/{document_id}/children", "GET /documents/{document_id}/content", "GET /documents/{document_id}/blocks/{block_id}", "GET /documents/{document_id}/changes", "GET /documents/{document_id}/export", "POST /documents/{document_id}/operations/preview", "POST /documents/{document_id}/operations", "GET /operations/{operation_id}", "GET /schema", "POST /documents/{document_id}/assets", "GET /documents/{document_id}/assets/{file_id}", "GET /documents/{document_id}/assets/{file_id}/content", "GET /shares", "POST /shares", "POST /shares/{share_id}/revoke", "POST /imports", "GET /imports/{import_id}", "PUT /imports/{import_id}/chunks", "POST /imports/{import_id}/finalize"}
