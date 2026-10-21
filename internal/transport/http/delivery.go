package httpapi

import (
	"fmt"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"orbis.local/orbis/internal/asset"
	"orbis.local/orbis/internal/platform/fault"
)

func secureContentHeaders(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Security-Policy", "default-src 'none'; sandbox; frame-ancestors 'none'")
}
func (h *handler) deliverAsset(c *gin.Context, row asset.Record) {
	content, err := h.deps.Assets.Open(c.Request.Context(), row)
	if err != nil {
		h.fail(c, err)
		return
	}
	defer func() {
		if err := content.Close(); err != nil {
			h.deps.Logger.WarnContext(
				c.Request.Context(),
				"Close asset content failed",
				"asset_id",
				row.ID,
				"request_id",
				c.GetString(requestIDKey),
			)
		}
	}()
	size, err := content.Seek(0, io.SeekEnd)
	if err != nil || size != row.SizeBytes {
		h.fail(c, fault.New(fault.Unavailable, "ASSET_UNAVAILABLE", "文件内容暂时不可用"))
		return
	}
	if _, err := content.Seek(0, io.SeekStart); err != nil {
		h.fail(c, err)
		return
	}
	media, disposition := "application/octet-stream", "attachment"
	if asset.InlineType(row.MediaType) {
		media, disposition = row.MediaType, "inline"
	} else if row.MediaType == "text/plain" {
		media = "text/plain; charset=utf-8"
	}
	c.Header("Content-Type", media)
	c.Header("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": row.Filename}))
	c.Header("ETag", `"`+row.SHA256+`"`)
	writer := &deliveryWriter{ResponseWriter: c.Writer}
	// ServeContent owns conditional requests and multipart ranges. Its pre-stream errors are translated below.
	http.ServeContent(writer, c.Request, row.Filename, time.UnixMilli(row.CreatedAtMS), content)
	if writer.failure == 0 {
		return
	}
	c.Header("Content-Length", "")
	c.Header("Content-Type", "")
	c.Header("Content-Disposition", "")
	secureContentHeaders(c)
	switch writer.failure {
	case http.StatusRequestedRangeNotSatisfiable:
		if invalidRange(c.GetHeader("Range")) {
			c.Header("Content-Range", "")
			h.fail(c, fault.New(fault.Invalid, "INVALID_RANGE", "Range 请求头格式无效"))
			return
		}
		c.Header("Content-Range", fmt.Sprintf("bytes */%d", row.SizeBytes))
		h.fail(c, fault.New(fault.RangeNotSatisfiable, "RANGE_NOT_SATISFIABLE", "请求的文件范围无法满足"))
	case http.StatusPreconditionFailed:
		h.fail(c, fault.New(fault.PreconditionFailed, "PRECONDITION_FAILED", "文件条件请求不满足"))
	default:
		h.fail(c, fmt.Errorf("serve asset content failed with status %d", writer.failure))
	}
}

type deliveryWriter struct {
	http.ResponseWriter
	failure int
}

func (w *deliveryWriter) WriteHeader(status int) {
	if status >= 400 {
		w.failure = status
		return
	}
	w.ResponseWriter.WriteHeader(status)
}
func (w *deliveryWriter) Write(data []byte) (int, error) {
	if w.failure != 0 {
		return len(data), nil
	}
	return w.ResponseWriter.Write(data)
}
func invalidRange(value string) bool {
	if !strings.HasPrefix(value, "bytes=") {
		return true
	}
	parts := strings.Split(strings.TrimPrefix(value, "bytes="), ",")
	for _, part := range parts {
		start, end, ok := strings.Cut(strings.TrimSpace(part), "-")
		if !ok || (start == "" && end == "") {
			return true
		}
		a, b := int64(0), int64(0)
		var err error
		if start != "" {
			a, err = strconv.ParseInt(start, 10, 64)
			if err != nil || a < 0 {
				return true
			}
		}
		if end != "" {
			b, err = strconv.ParseInt(end, 10, 64)
			if err != nil || b < 0 {
				return true
			}
		}
		if start != "" && end != "" && a > b {
			return true
		}
	}
	return false
}

type headWriter struct{ gin.ResponseWriter }

func (w headWriter) Write(data []byte) (int, error)       { w.WriteHeaderNow(); return len(data), nil }
func (w headWriter) WriteString(data string) (int, error) { w.WriteHeaderNow(); return len(data), nil }
