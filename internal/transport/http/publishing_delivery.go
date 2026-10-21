package httpapi

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"orbis.local/orbis/internal/document/markdown"
	"orbis.local/orbis/internal/document/publicview"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/publishing"
	"orbis.local/orbis/internal/publishing/reader"
)

func (h *handler) readerAsset(c *gin.Context) {
	kind := "js"
	media := "application/javascript; charset=utf-8"
	if strings.HasSuffix(c.FullPath(), ".css") {
		kind = "css"
		media = "text/css; charset=utf-8"
	}
	data := reader.Asset(kind)
	etag := fmt.Sprintf(`"%x"`, sha256.Sum256(data))
	c.Header("Cache-Control", "public, max-age=0, must-revalidate")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("ETag", etag)
	if c.GetHeader("If-None-Match") == etag {
		c.Status(http.StatusNotModified)
		return
	}
	c.Header("Content-Length", strconv.Itoa(len(data)))
	c.Data(http.StatusOK, media, data)
}
func publicHTMLHeaders(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http:; media-src 'self' https: http:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
}
func (h *handler) siteDeliveryError(c *gin.Context, err error) {
	status, code, message := http.StatusInternalServerError, "INTERNAL_ERROR", "服务内部错误"
	var business *fault.Error
	if errors.As(err, &business) {
		code, message = business.Code, business.Message
		switch business.Kind {
		case fault.NotFound:
			status = 404
		case fault.Conflict:
			status = 409
		case fault.Validation:
			status = 422
		case fault.Invalid:
			status = 400
		case fault.Unavailable:
			status = 503
		case fault.TooLarge:
			status = 413
		case fault.Forbidden:
			status = 403
		case fault.Unauthenticated:
			status = 401
		}
	} else if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		status, code, message = http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "请求未完成，请稍后重试"
	} else {
		h.deps.Logger.ErrorContext(c.Request.Context(), "Public site delivery failed", "request_id", c.GetString(requestIDKey), "error", err)
	}
	publicHTMLHeaders(c)
	c.Header("X-Robots-Tag", "noindex, nofollow")
	c.Data(status, "text/html; charset=utf-8", reader.Error(code, message))
}
func (h *handler) siteWeb(c *gin.Context) {
	publicHTMLHeaders(c)
	query, err := publicSiteQuery(c)
	if err != nil {
		h.siteDeliveryError(c, err)
		return
	}
	manifest, err := h.deps.Publishing.Manifest(c.Request.Context(), query)
	if err != nil {
		h.siteDeliveryError(c, err)
		return
	}
	query.ExpectedReleaseID = manifest.ReleaseID
	base := h.deps.PublicBaseURL
	if base == "" {
		base = publishing.DefaultPublicBaseURL
	}
	switch query.PageSlug {
	case "sitemap.xml":
		data, err := reader.Sitemap(manifest, base)
		if err != nil {
			h.siteDeliveryError(c, err)
			return
		}
		c.Data(200, "application/xml; charset=utf-8", data)
		return
	case "robots.txt":
		c.Data(200, "text/plain; charset=utf-8", reader.Robots(manifest, base))
		return
	case "llms.txt":
		c.Data(200, "text/plain; charset=utf-8", reader.LLMs(manifest, base))
		return
	case "llms-full.txt":
		var output strings.Builder
		fmt.Fprintf(&output, "# %s\n\n%s\n\n", manifest.Name, manifest.Description)
		for _, metadata := range manifest.Pages {
			pageQuery := query
			pageQuery.PageSlug = metadata.Slug
			page, err := h.deps.Publishing.Page(c.Request.Context(), pageQuery)
			if err != nil {
				h.siteDeliveryError(c, err)
				return
			}
			data, err := h.siteMarkdown(c, pageQuery, page)
			if err != nil {
				h.siteDeliveryError(c, err)
				return
			}
			if output.Len()+len(data)+len(metadata.Title)+16 > publishing.MaxSnapshotBytes {
				h.siteDeliveryError(c, fault.New(fault.TooLarge, "SITE_EXPORT_TOO_LARGE", "站点机器阅读导出超过 32 MiB"))
				return
			}
			fmt.Fprintf(&output, "## %s\n\n", metadata.Title)
			output.Write(data)
			output.WriteString("\n\n")
		}
		c.Data(200, "text/plain; charset=utf-8", []byte(output.String()))
		return
	}
	if strings.HasPrefix(query.PageSlug, "pages/") && strings.HasSuffix(query.PageSlug, ".md") {
		query.PageSlug = strings.TrimSuffix(strings.TrimPrefix(query.PageSlug, "pages/"), ".md")
		page, err := h.deps.Publishing.Page(c.Request.Context(), query)
		if err != nil {
			h.siteDeliveryError(c, err)
			return
		}
		data, err := h.siteMarkdown(c, query, page)
		if err != nil {
			h.siteDeliveryError(c, err)
			return
		}
		c.Header("Content-Disposition", `inline; filename="page.md"`)
		c.Data(200, "text/markdown; charset=utf-8", data)
		return
	}
	if target, exists := manifest.Redirects[query.PageSlug]; exists {
		canonical := false
		for _, page := range manifest.Pages {
			if page.Slug == query.PageSlug {
				canonical = true
				break
			}
		}
		if !canonical {
			c.Redirect(http.StatusTemporaryRedirect, "/s/"+manifest.Slug+"/"+target)
			return
		}
	}
	page, err := h.deps.Publishing.Page(c.Request.Context(), query)
	if err != nil {
		h.siteDeliveryError(c, err)
		return
	}
	text, err := singleQuery(c, "q", "")
	if err != nil {
		h.siteDeliveryError(c, err)
		return
	}
	var results []publishing.SearchEntry
	if text != "" {
		pageSize, _ := pagination.New(1, pagination.MaxSize)
		matches, err := h.deps.Publishing.Search(c.Request.Context(), query, text, pageSize)
		if err != nil {
			h.siteDeliveryError(c, err)
			return
		}
		results = matches.Items
	}
	data, err := reader.HTML(manifest, page, base, results, text)
	if err != nil {
		h.siteDeliveryError(c, err)
		return
	}
	c.Header("X-Site-Release-ID", *manifest.ReleaseID)
	c.Data(200, "text/html; charset=utf-8", data)
}
func (h *handler) siteMarkdown(c *gin.Context, query publishing.PublicQuery, page publishing.Page) ([]byte, error) {
	blocks, err := h.deps.Publishing.HydrateTables(c.Request.Context(), query, page.Blocks)
	if err != nil {
		return nil, err
	}
	document, tables, err := publicview.MarkdownBlocks(blocks)
	if err != nil {
		return nil, err
	}
	data, err := markdown.Render(c.Request.Context(), document, "", tables)
	if err != nil {
		return nil, err
	}
	return data, nil
}

func (h *handler) publicSiteTableHTML(c *gin.Context) {
	query, err := publicSiteQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	number, err := integerQuery(c, "page", 1)
	if err != nil {
		h.fail(c, err)
		return
	}
	page, err := pagination.New(int(number), pagination.MaxSize)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Publishing.Table(c.Request.Context(), publishing.TableQuery{PublicQuery: query, TableID: c.Param("table_id"), Page: page})
	if err != nil {
		h.fail(c, err)
		return
	}
	data, err := reader.TableHTML(result, page.Number, "/api/v1/public/sites/"+query.Slug+"/tables/"+c.Param("table_id")+"/html")
	if err != nil {
		h.fail(c, err)
		return
	}
	publicHTMLHeaders(c)
	c.Data(http.StatusOK, "text/html; charset=utf-8", data)
}
