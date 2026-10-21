package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
)

func readQuery(c *gin.Context) (document.ReadQuery, string, error) {
	q := document.ReadQuery{Scope: directoryScope(c), BlockID: c.Param("block_id")}
	version, err := integerQuery(c, "version", 0)
	if err != nil {
		return q, "", err
	}
	q.Version = version
	size, err := integerQuery(c, "page_size", pagination.DefaultSize)
	if err != nil {
		return q, "", err
	}
	if size > pagination.MaxSize {
		return q, "", fault.Field("query.page_size", "每页数量不能超过 100")
	}
	q.Limit = int(size)
	cursor, err := singleQuery(c, "cursor", "")
	return q, cursor, err
}

const MaxBlockWindowPayloadBytes = 128 << 10

func blockResponse(item document.BlockRecord) (blockRecordDTO, error) {
	var payload document.Payload
	if err := json.Unmarshal(item.Payload, &payload); err != nil {
		return blockRecordDTO{}, err
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return blockRecordDTO{}, err
	}
	return blockRecordDTO{ID: item.ID, ParentID: item.ParentID, Position: item.Position, Payload: &payload, BlockType: payload.Type, PayloadLoaded: true, PayloadBytes: len(encoded), BlockRevision: item.Revision, ChildCount: item.ChildCount}, nil
}

// Window metadata remains complete even when a payload needs an explicit single-block read.
func blockWindowResponse(items []document.BlockRecord) ([]blockRecordDTO, error) {
	rows := make([]blockRecordDTO, 0, len(items))
	remaining := MaxBlockWindowPayloadBytes
	for _, item := range items {
		if item.PayloadByteCount != nil && *item.PayloadByteCount > remaining {
			var metadata struct {
				Type string `json:"type"`
			}
			if err := json.Unmarshal(item.Payload, &metadata); err != nil {
				return nil, err
			}
			rows = append(rows, blockRecordDTO{ID: item.ID, ParentID: item.ParentID, Position: item.Position, BlockType: metadata.Type, PayloadBytes: *item.PayloadByteCount, BlockRevision: item.Revision, ChildCount: item.ChildCount})
			continue
		}
		row, err := blockResponse(item)
		if err != nil {
			return nil, err
		}
		if row.PayloadBytes > remaining {
			row.Payload = nil
			row.PayloadLoaded = false
		} else {
			remaining -= row.PayloadBytes
		}
		rows = append(rows, row)
	}
	return rows, nil
}

func (h *handler) childrenBlocks(c *gin.Context) {
	q, cursor, err := readQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	if _, exists := c.Request.URL.Query()["parent_id"]; exists {
		value, err := singleQuery(c, "parent_id", "")
		if err != nil {
			h.fail(c, err)
			return
		}
		q.ParentID = &value
	}
	result, err := h.deps.Documents.ChildrenBlocks(c.Request.Context(), q, cursor)
	if err != nil {
		h.fail(c, err)
		return
	}
	rows, err := blockWindowResponse(result.Items)
	if err != nil {
		h.fail(c, err)
		return
	}

	success(c, http.StatusOK, gin.H{"items": rows, "version": result.Version, "pagination": gin.H{"next_cursor": result.NextCursor, "has_more": result.HasMore}})
}
func (h *handler) readDocumentBlock(c *gin.Context) {
	q, _, err := readQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	item, version, err := h.deps.Documents.ReadBlock(c.Request.Context(), q)
	if err != nil {
		h.fail(c, err)
		return
	}
	row, err := blockResponse(item)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"version": version, "item": row})
}
func (h *handler) documentOutline(c *gin.Context) {
	q, cursor, err := readQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Documents.Outline(c.Request.Context(), q, cursor)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"items": result.Items, "version": result.Version, "pagination": gin.H{"next_cursor": result.NextCursor, "has_more": result.HasMore}})
}
func (h *handler) documentChanges(c *gin.Context) {
	q, cursor, err := readQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	q.SinceVersion, err = integerQuery(c, "since_version", 0)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Documents.Changes(c.Request.Context(), q, cursor)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"items": result.Items, "version": result.Version, "since_version": result.SinceVersion, "pagination": gin.H{"next_cursor": result.NextCursor, "has_more": result.HasMore}})
}
