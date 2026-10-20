package httpapi

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"orbis.local/orbis/internal/publishing"
)

type siteDTO struct {
	publishing.Config
	ID                 string  `json:"id"`
	WorkspaceID        string  `json:"workspace_id"`
	Version            int64   `json:"version"`
	PublishedReleaseID *string `json:"published_release_id"`
	PublishedSlug      *string `json:"published_slug"`
	CreatedAtMS        int64   `json:"created_at_ms"`
	UpdatedAtMS        int64   `json:"updated_at_ms"`
}

func siteResponse(site publishing.Site) siteDTO {
	return siteDTO{Config: site.Config, ID: site.ID, WorkspaceID: site.WorkspaceID, Version: site.Version, PublishedReleaseID: site.PublishedReleaseID, PublishedSlug: site.PublishedSlug, CreatedAtMS: site.CreatedAtMS, UpdatedAtMS: site.UpdatedAtMS}
}
func siteScope(c *gin.Context) publishing.Scope {
	return publishing.Scope{ActorID: actor(c).UserID, WorkspaceID: c.Param("workspace_id"), SiteID: c.Param("site_id")}
}
func (h *handler) sites(c *gin.Context) {
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	items, total, err := h.deps.Publishing.List(c.Request.Context(), siteScope(c), page)
	if err != nil {
		h.fail(c, err)
		return
	}
	rows := make([]siteDTO, 0, len(items))
	for _, site := range items {
		rows = append(rows, siteResponse(site))
	}
	listResponse(c, rows, total, page)
}
func (h *handler) createSite(c *gin.Context) {
	var input publishing.Config
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	site, err := h.deps.Publishing.Create(c.Request.Context(), siteScope(c), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusCreated, siteResponse(site))
}
func (h *handler) site(c *gin.Context) {
	site, err := h.deps.Publishing.Get(c.Request.Context(), siteScope(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, siteResponse(site))
}
func (h *handler) updateSite(c *gin.Context) {
	var input struct {
		publishing.Config
		ExpectedVersion int64 `json:"expected_version"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	site, err := h.deps.Publishing.Update(c.Request.Context(), siteScope(c), input.Config, input.ExpectedVersion)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, siteResponse(site))
}
func (h *handler) siteSources(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	result, err := h.deps.Publishing.Sources(c.Request.Context(), siteScope(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}
func (h *handler) previewSite(c *gin.Context) {
	privatePublicHeaders(c)
	result, err := h.deps.Publishing.Preview(c.Request.Context(), siteScope(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}
func siteMutation(result publishing.Mutation) gin.H {
	return gin.H{"site": siteResponse(result.Site), "release": result.Release}
}
func (h *handler) publishSite(c *gin.Context) {
	var input publishing.PublishInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Publishing.Publish(c.Request.Context(), siteScope(c), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusCreated, siteMutation(result))
}
func (h *handler) activateSite(c *gin.Context) {
	var input publishing.ActivateInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Publishing.Activate(c.Request.Context(), siteScope(c), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, siteMutation(result))
}
func (h *handler) siteReleases(c *gin.Context) {
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	items, total, err := h.deps.Publishing.Releases(c.Request.Context(), siteScope(c), page)
	if err != nil {
		h.fail(c, err)
		return
	}
	listResponse(c, items, total, page)
}
func privatePublicHeaders(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Robots-Tag", "noindex, nofollow")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")
}
func publicSiteQuery(c *gin.Context) (publishing.PublicQuery, error) {
	result := publishing.PublicQuery{Slug: c.Param("slug"), PageSlug: strings.TrimPrefix(c.Param("page_slug"), "/")}
	if strings.Contains(strings.ToLower(c.Request.URL.RawPath), "%25") {
		return result, publishing.MissingPage()
	}
	if _, exists := c.Request.URL.Query()["release_id"]; exists {
		value, err := singleQuery(c, "release_id", "")
		if err != nil {
			return result, err
		}
		result.ExpectedReleaseID = &value
	}
	return result, nil
}
func (h *handler) publicSite(c *gin.Context) {
	privatePublicHeaders(c)
	c.Header("X-Robots-Tag", "")
	query, err := publicSiteQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Publishing.Manifest(c.Request.Context(), query)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}
func (h *handler) publicSitePage(c *gin.Context) {
	privatePublicHeaders(c)
	c.Header("X-Robots-Tag", "")
	query, err := publicSiteQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Publishing.Page(c.Request.Context(), query)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}
func (h *handler) publicSiteSearch(c *gin.Context) {
	privatePublicHeaders(c)
	query, err := publicSiteQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	text, err := singleQuery(c, "q", "")
	if err != nil {
		h.fail(c, err)
		return
	}
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Publishing.Search(c.Request.Context(), query, text, page)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"release_id": result.ReleaseID, "items": result.Items, "pagination": pageInfo{Page: page.Number, PageSize: page.Size, Total: result.Total}})
}
func (h *handler) publicSiteTable(c *gin.Context) {
	privatePublicHeaders(c)
	query, err := publicSiteQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Publishing.Table(c.Request.Context(), publishing.TableQuery{PublicQuery: query, TableID: c.Param("table_id"), Page: page})
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"release_id": result.ReleaseID, "table_id": result.TableID, "title": result.Title, "fields": result.Fields, "view": result.View, "groups": result.Groups, "items": result.Items, "pagination": pageInfo{Page: page.Number, PageSize: page.Size, Total: result.Total}})
}
func (h *handler) publicSiteAsset(c *gin.Context) {
	privatePublicHeaders(c)
	query, err := publicSiteQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	record, err := h.deps.Publishing.Asset(c.Request.Context(), query, c.Param("asset_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	h.deliverAsset(c, record)
}
func (h *handler) publicTablePreview(c *gin.Context) {
	query, err := tableQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	query.Page, err = pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Tables.PublicRecords(c.Request.Context(), query)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"title": result.Data.Title, "fields": result.Data.Fields, "view": result.Data.View, "groups": result.Data.Groups, "items": result.Data.Records, "content_version": result.ContentVersion, "table_version": result.TableVersion, "pagination": pageInfo{Page: query.Page.Number, PageSize: query.Page.Size, Total: result.Total}})
}

func (h *handler) publicSiteAssetDigest(c *gin.Context) {
	privatePublicHeaders(c)
	query, err := publicSiteQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	record, err := h.deps.Publishing.AssetByDigest(c.Request.Context(), query, c.Param("digest"))
	if err != nil {
		h.fail(c, err)
		return
	}
	h.deliverAsset(c, record)
}
