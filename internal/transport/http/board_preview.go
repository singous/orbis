package httpapi

import (
	"encoding/base64"
	"fmt"
	"io"

	"github.com/gin-gonic/gin"

	"orbis.local/orbis/internal/asset"
	"orbis.local/orbis/internal/board"
	"orbis.local/orbis/internal/platform/fault"
)

const maxBoardPreviewAssetBytes = 8 << 20

func (h *handler) boardPreview(c *gin.Context) {
	revision, err := boardSequence(c, "revision")
	if err != nil {
		h.fail(c, err)
		return
	}
	sc := boardScope(c)
	meta, err := h.deps.Boards.Get(c.Request.Context(), sc, revision)
	if err != nil {
		h.fail(c, err)
		return
	}
	pageID := c.Query("page_id")
	if pageID == "" && len(meta.Pages) > 0 {
		pageID = meta.Pages[0].ID
	}
	var frame *string
	if value := c.Query("frame_id"); value != "" {
		frame = &value
	}
	if !board.ValidID(pageID) || (frame != nil && !board.ValidID(*frame)) {
		h.fail(c, board.Invalid("画板预览范围无效"))
		return
	}
	etag := fmt.Sprintf(`"board-v1-%s-%s-%d-%s"`, meta.ID, pageID, meta.Revision, c.Query("frame_id"))
	found := false
	for _, page := range meta.Pages {
		if page.ID == pageID {
			found = true
		}
	}
	if !found {
		h.fail(c, fault.Missing())
		return
	}
	if frame == nil && c.GetHeader("If-None-Match") == etag {
		c.Header("ETag", etag)
		c.Header("Cache-Control", "private, no-cache")
		c.Status(304)
		return
	}
	used := int64(0)
	resolved := map[string]string{}
	view, err := h.deps.Boards.Preview(c.Request.Context(), sc, pageID, meta.Revision, frame, func(id string) (string, error) {
		if value, ok := resolved[id]; ok {
			return value, nil
		}
		row, err := h.deps.Assets.File(c.Request.Context(), asset.Scope{ActorID: sc.ActorID, WorkspaceID: sc.WorkspaceID}, id)
		if err != nil {
			return "", err
		}
		if used+row.SizeBytes > maxBoardPreviewAssetBytes {
			return "", board.Limit()
		}
		reader, err := h.deps.Assets.Open(c.Request.Context(), row)
		if err != nil {
			return "", err
		}
		data, err := io.ReadAll(io.LimitReader(reader, maxBoardPreviewAssetBytes-used+1))
		closeErr := reader.Close()
		if err != nil {
			return "", err
		}
		if closeErr != nil {
			return "", closeErr
		}
		used += int64(len(data))
		if used > maxBoardPreviewAssetBytes {
			return "", board.Limit()
		}
		value := "data:" + row.MediaType + ";base64," + base64.StdEncoding.EncodeToString(data)
		resolved[id] = value
		return value, nil
	})
	if err != nil {
		h.fail(c, err)
		return
	}
	c.Header("ETag", etag)
	c.Header("Cache-Control", "private, no-cache")
	c.Header("Content-Security-Policy", "default-src 'none'; img-src data:; style-src 'unsafe-inline'")
	if c.Request.Method == "HEAD" {
		c.Header("Content-Type", "image/svg+xml")
		c.Status(200)
		return
	}
	c.Data(200, "image/svg+xml; charset=utf-8", []byte(view.SVG))
}
