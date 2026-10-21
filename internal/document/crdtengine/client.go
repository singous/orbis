// Package crdtengine connects the Go transaction owner to the stateless Yjs runtime.
package crdtengine

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
)

const maxResponseBytes = 96 << 20
const requestTimeout = 15 * time.Second

type Client struct {
	endpoint, key string
	http          *http.Client
}

func New(address, key string) (*Client, error) {
	u, err := url.Parse(address)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, fmt.Errorf("invalid collaboration engine address")
	}
	if len(key) < 32 || strings.HasPrefix(key, "REPLACE_") || strings.ContainsAny(key, "\r\n") {
		return nil, fmt.Errorf("collaboration key must contain at least 32 bytes")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxConnsPerHost = 4
	transport.MaxIdleConnsPerHost = 4
	u.Path = "/transform"
	return &Client{endpoint: u.String(), key: key, http: &http.Client{Transport: transport, Timeout: requestTimeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func (c *Client) Close() { c.http.CloseIdleConnections() }

func (c *Client) Transform(ctx context.Context, input document.CollaborationTransform) (document.CollaborationTransformResult, error) {
	var result document.CollaborationTransformResult
	body, err := json.Marshal(input)
	if err != nil {
		return result, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return result, document.CollaborationUnavailable()
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.key)
	response, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		return result, document.CollaborationUnavailable()
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusConflict {
		var problem struct {
			Code string `json:"code"`
		}
		_ = json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&problem)
		if problem.Code == "EDIT_TARGET_REMOVED" {
			return result, fault.New(fault.Conflict, "COLLABORATION_TARGET_REMOVED", "另一个编辑端已更新、移动或删除修改目标，本机草稿仍保留，请先导出后处理")
		}
		return result, fault.New(fault.Conflict, "COLLABORATION_UPDATE_CONFLICT", "正文结构已变化，本机草稿仍保留")
	}
	if response.StatusCode == http.StatusBadRequest || response.StatusCode == http.StatusUnprocessableEntity {
		return result, fault.New(fault.Validation, "COLLABORATION_UPDATE_INVALID", "正文协同更新无效，本机修改仍保留")
	}
	if response.StatusCode == http.StatusRequestEntityTooLarge {
		return result, fault.New(fault.TooLarge, "COLLABORATION_TOO_LARGE", "正文协同数据超过容量限制，本机修改仍保留")
	}
	if response.StatusCode != http.StatusOK {
		return result, document.CollaborationUnavailable()
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil || len(data) > maxResponseBytes {
		return result, document.CollaborationUnavailable()
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return result, document.CollaborationUnavailable()
	}
	if len(result.State) > document.MaxCollaborationStateBytes {
		return result, fault.New(fault.TooLarge, "COLLABORATION_TOO_LARGE", "正文协同数据超过容量限制，本机修改仍保留")
	}
	if len(result.State) == 0 || len(result.StateVector) == 0 || result.Blocks == nil {
		return result, document.CollaborationUnavailable()
	}
	return result, nil
}
