package httpapi

import (
	"github.com/gin-gonic/gin"
	"orbis.local/orbis/internal/platform/fault"
)

const MaxPublicResponses = 4

// The permit spans serialization and socket writes, bounding retained large reader responses.
func (h *handler) publicResponseLimit(html bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		select {
		case h.publicResponses <- struct{}{}:
			defer func() { <-h.publicResponses }()
			c.Next()
		default:
			err := fault.New(fault.Unavailable, "PUBLIC_READER_BUSY", "公开阅读繁忙，请稍后重试")
			if html {
				h.siteDeliveryError(c, err)
			} else {
				h.fail(c, err)
			}
			c.Abort()
		}
	}
}
