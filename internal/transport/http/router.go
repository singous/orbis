package httpapi

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"orbis.local/orbis/api"
	"orbis.local/orbis/internal/asset"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/identity"
	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/publishing"
	"orbis.local/orbis/internal/search"
	"orbis.local/orbis/internal/sharing"
	"orbis.local/orbis/internal/table"
	"orbis.local/orbis/internal/workspace"
)

type SetupService interface {
	Status(context.Context) (bool, error)
	Initialize(context.Context, string, string, string, string) (identity.User, workspace.Workspace, error)
}

type Dependencies struct {
	CollaborationSockets *CollaborationSockets
	Imports              *integration.Imports
	Library              *integration.Library
	IntegrationTokens    *integration.Tokens
	Preferences          *identity.Preferences
	Sharing              *sharing.Service
	Publishing           *publishing.Service
	PublicBaseURL        string
	Search               *search.Service
	Transfers            *integration.Transfers
	Tables               *table.Service
	Assets               *asset.Service
	MaxUploadBytes       int64
	Identity             *identity.Service
	Workspaces           *workspace.Service
	Actions              *workspace.Actions
	Documents            *document.Service
	Catalog              *document.Catalog
	Comments             *document.Comments
	Setup                SetupService
	Ready                func(context.Context) error
	Logger               *slog.Logger
	MaxBodyBytes         int64
	RequestTimeout       time.Duration
}

type handler struct {
	deps            Dependencies
	publicResponses chan struct{}
}

// New installs the common JSON contract and routes without starting network listeners.
func New(deps Dependencies) (*gin.Engine, error) {
	h := &handler{deps: deps, publicResponses: make(chan struct{}, MaxPublicResponses)}
	r := gin.New()
	r.HandleMethodNotAllowed = true
	r.RedirectTrailingSlash = false
	r.RedirectFixedPath = false
	if err := r.SetTrustedProxies(nil); err != nil {
		return nil, fmt.Errorf("configure trusted proxies: %w", err)
	}
	r.Use(h.requestContext())
	r.NoRoute(func(c *gin.Context) { h.fail(c, fault.Missing()) })
	r.NoMethod(func(c *gin.Context) {
		c.AbortWithStatusJSON(http.StatusMethodNotAllowed, response[any]{
			Code: "METHOD_NOT_ALLOWED", Message: "请求方法不受支持", RequestID: c.GetString(requestIDKey), Data: nil,
		})
	})
	r.GET("/healthz", func(c *gin.Context) { success(c, http.StatusOK, gin.H{"status": "ok"}) })
	r.GET("/readyz", func(c *gin.Context) {
		if err := deps.Ready(c.Request.Context()); err != nil {
			h.fail(c, fault.New(fault.Unavailable, "SERVICE_UNAVAILABLE", "服务暂时不可用"))
			return
		}
		success(c, http.StatusOK, gin.H{"status": "ready"})
	})
	r.GET("/openapi.json", func(c *gin.Context) { c.Data(http.StatusOK, "application/json", api.Contract) })
	v1 := r.Group("/api/v1")
	v1.GET("/workspaces/:workspace_id/documents/:document_id/collaboration/socket", h.pathIDs(), h.documentCollaborationSocket)

	r.GET("/s/:slug", h.publicResponseLimit(true), h.siteWeb)
	r.HEAD("/s/:slug", h.publicResponseLimit(true), h.siteWeb)
	r.GET("/s/:slug/*page_slug", h.publicResponseLimit(true), h.siteWeb)
	r.HEAD("/s/:slug/*page_slug", h.publicResponseLimit(true), h.siteWeb)
	r.GET("/public/sites/:slug/assets/:digest", h.publicSiteAssetDigest)
	r.HEAD("/public/sites/:slug/assets/:digest", h.publicSiteAssetDigest)
	v1.GET("/public/reader.js", h.readerAsset)
	v1.HEAD("/public/reader.js", h.readerAsset)
	v1.GET("/public/reader.css", h.readerAsset)
	v1.HEAD("/public/reader.css", h.readerAsset)

	v1.GET("/public/shares/:token/directory", h.shareDirectory)
	v1.GET("/public/shares/:token/documents/:document_id", h.sharedDocument)
	v1.GET("/public/shares/:token/documents/:document_id/content", h.publicResponseLimit(false), h.sharedContent)
	v1.GET("/public/shares/:token/documents/:document_id/children", h.publicResponseLimit(false), h.sharedChildren)
	v1.GET("/public/shares/:token/documents/:document_id/blocks", h.publicResponseLimit(false), h.sharedBlocks)
	v1.GET("/public/shares/:token/documents/:document_id/blocks/:block_id", h.publicResponseLimit(false), h.sharedBlock)
	v1.GET("/public/shares/:token/documents/:document_id/tables/:table_id/records", h.publicResponseLimit(false), h.sharedTable)
	v1.GET("/public/shares/:token/documents/:document_id/assets/:asset_id", h.sharedAsset)
	v1.HEAD("/public/shares/:token/documents/:document_id/assets/:asset_id", h.sharedAsset)
	v1.GET("/public/sites/:slug/manifest", h.publicSite)
	v1.GET("/public/sites/:slug/search", h.publicSiteSearch)
	v1.GET("/public/sites/:slug/pages/*page_slug", h.publicResponseLimit(false), h.publicSitePage)
	v1.GET("/public/sites/:slug/tables/:table_id/html", h.publicResponseLimit(true), h.publicSiteTableHTML)
	v1.HEAD("/public/sites/:slug/tables/:table_id/html", h.publicResponseLimit(true), h.publicSiteTableHTML)
	v1.GET("/public/sites/:slug/tables/:table_id/records", h.publicResponseLimit(false), h.publicSiteTable)
	v1.GET("/public/sites/:slug/assets/:asset_id", h.publicSiteAsset)
	v1.HEAD("/public/sites/:slug/assets/:asset_id", h.publicSiteAsset)
	v1.GET("/setup", h.setupStatus)
	v1.POST("/setup", h.setup)
	v1.POST("/auth/login", h.login)
	v1.POST("/auth/refresh", h.refresh)
	v1.POST("/invitations/inspect", h.inspectInvitation)
	v1.POST("/invitations/accept", h.acceptInvitation)
	v1.POST("/ownership-transfers/confirm", h.confirmOwnership)

	agent := v1.Group("/agent/workspaces/:workspace_id", h.pathIDs(), h.authenticateIntegration())
	agent.POST("/imports", h.agentBeginImport)
	agent.GET("/imports/:import_id", h.agentImportStatus)
	agent.PUT("/imports/:import_id/chunks", h.agentImportChunk)
	agent.POST("/imports/:import_id/finalize", h.agentFinalizeImport)
	agent.GET("/me", h.agentMe)
	agent.GET("/workspaces", h.agentWorkspaces)
	agent.GET("/capabilities", h.agentCapabilities)
	agent.GET("/schema", h.agentSchema)
	agent.GET("/collections", h.agentCollections)
	agent.GET("/documents", h.agentDocuments)
	agent.GET("/search", h.agentSearch)
	agent.POST("/documents", h.agentCreate)
	agent.GET("/documents/:document_id/export", h.agentExport)
	agent.POST("/resolve", h.agentResolve)
	agent.GET("/documents/:document_id", h.agentDocument)
	agent.GET("/documents/:document_id/content", h.agentContent)
	agent.GET("/documents/:document_id/blocks", h.agentBlocks)
	agent.GET("/documents/:document_id/children", h.agentBlocks)
	agent.GET("/documents/:document_id/blocks/:block_id", h.agentBlock)
	agent.GET("/documents/:document_id/outline", h.agentOutline)
	agent.GET("/documents/:document_id/changes", h.agentChanges)
	agent.POST("/documents/:document_id/operations", h.agentApply)
	agent.POST("/documents/:document_id/operations/preview", h.agentPreview)
	agent.GET("/operations/:operation_id", h.agentOperation)
	agent.GET("/shares", h.agentShares)
	agent.POST("/shares", h.agentCreateShare)
	agent.POST("/shares/:share_id/revoke", h.agentRevokeShare)
	agent.POST("/documents/:document_id/assets", h.agentUpload)
	agent.GET("/documents/:document_id/assets/:asset_id", h.agentFile)
	agent.GET("/documents/:document_id/assets/:asset_id/content", h.agentFileContent)
	agent.HEAD("/documents/:document_id/assets/:asset_id/content", h.agentFileContent)
	private := v1.Group("", h.authenticate())
	private.GET("/me", h.me)
	private.PUT("/me/workspace-preference", h.setWorkspacePreference)
	private.PATCH("/me", h.updateProfile)
	private.PUT("/me/avatar", h.setAvatar)
	private.DELETE("/me/avatar", h.clearAvatar)
	private.GET("/me/avatar", h.avatar)
	private.HEAD("/me/avatar", h.avatar)
	private.POST("/auth/logout", h.logout)
	private.GET("/workspaces", h.workspaces)
	private.POST("/workspaces", h.createWorkspace)
	scope := private.Group("/workspaces/:workspace_id", h.pathIDs())

	scope.GET("/integration-tokens", h.integrationTokens)
	scope.POST("/integration-tokens", h.createIntegrationToken)
	scope.POST("/integration-tokens/:token_id/revoke", h.revokeIntegrationToken)
	scope.GET("/shares", h.shares)
	scope.POST("/shares", h.createShare)
	scope.POST("/shares/:share_id/revoke", h.revokeShare)
	scope.GET("/sites", h.sites)
	scope.POST("/sites", h.createSite)
	scope.GET("/sites/:site_id", h.site)
	scope.PUT("/sites/:site_id", h.updateSite)
	scope.GET("/sites/:site_id/sources", h.siteSources)
	scope.GET("/sites/:site_id/preview", h.previewSite)
	scope.POST("/sites/:site_id/publish", h.publishSite)
	scope.POST("/sites/:site_id/activation", h.activateSite)
	scope.GET("/sites/:site_id/releases", h.siteReleases)
	scope.GET("/documents/:document_id/tables/:table_id/public-records", h.publicTablePreview)
	scope.GET("/search", h.search)
	scope.POST("/collections/:collection_id/imports/markdown", h.importMarkdown)
	scope.GET("/documents/:document_id/export/markdown", h.exportDocument)
	scope.HEAD("/documents/:document_id/export/markdown", h.exportDocument)
	scope.GET("/assets", h.assets)
	scope.POST("/collection-icons", h.uploadCollectionIcon)
	scope.POST("/assets", h.uploadAsset)
	scope.GET("/assets/:asset_id", h.asset)
	scope.GET("/assets/:asset_id/content", h.assetContent)
	scope.HEAD("/assets/:asset_id/content", h.assetContent)
	scope.GET("/invitations", h.invitations)
	scope.POST("/invitations", h.invite)
	scope.POST("/invitations/:invitation_id/resend", h.resendInvitation)
	scope.POST("/invitations/:invitation_id/revoke", h.revokeInvitation)
	scope.GET("/ownership-transfers/current", h.currentOwnership)
	scope.POST("/ownership-transfers", h.transferOwnership)
	scope.POST("/ownership-transfers/:transfer_id/resend", h.resendOwnership)
	scope.POST("/ownership-transfers/:transfer_id/cancel", h.cancelOwnership)
	scope.GET("/members", h.members)
	scope.GET("/mail-status", h.mailStatus)
	scope.PATCH("/members/:user_id", h.changeMember)
	scope.DELETE("/members/:user_id", h.removeMember)
	scope.GET("/collection-groups", h.groups)
	scope.POST("/collection-groups", h.createGroup)
	scope.GET("/collection-groups/:group_id", h.group)
	scope.PATCH("/collection-groups/:group_id", h.updateGroup)
	scope.PUT("/collection-groups/:group_id/archive", h.archiveGroup)
	scope.GET("/collections", h.collections)
	scope.POST("/collections", h.createCollection)
	scope.GET("/collections/:collection_id", h.collection)
	scope.PATCH("/collections/:collection_id", h.updateCollection)
	scope.GET("/collections/:collection_id/children", h.children)
	scope.PUT("/collections/:collection_id/order", h.reorderDocuments)
	scope.PUT("/collections/:collection_id/archive", h.archiveCollection)
	scope.GET("/collections/:collection_id/documents", h.documents)
	scope.POST("/collections/:collection_id/documents", h.createDocument)
	scope.POST("/documents/:document_id/tables", h.createTable)
	scope.GET("/documents/:document_id/tables/:table_id", h.tableMetadata)
	scope.GET("/documents/:document_id/tables/:table_id/records", h.tableRecords)
	scope.POST("/documents/:document_id/tables/:table_id/changes", h.changeTable)
	scope.GET("/documents/:document_id/tables/:table_id/export", h.exportTable)
	scope.HEAD("/documents/:document_id/tables/:table_id/export", h.exportTable)
	scope.GET("/documents/:document_id", h.document)
	scope.GET("/documents/:document_id/comments", h.comments)
	scope.POST("/documents/:document_id/comments", h.createComment)
	scope.PATCH("/documents/:document_id/comments/:comment_id", h.updateComment)
	scope.GET("/documents", h.workspaceDocuments)
	scope.GET("/documents/archive", h.archivedDocuments)
	scope.PATCH("/documents/:document_id/location", h.moveDocument)
	scope.PUT("/documents/:document_id/archive", h.archiveDocument)
	scope.GET("/documents/:document_id/content", h.content)
	scope.PUT("/documents/:document_id/content", h.writeContent)
	scope.GET("/documents/:document_id/revisions", h.revisions)
	scope.POST("/documents/:document_id/restore", h.restore)
	scope.GET("/documents/:document_id/blocks", h.blocks)
	scope.GET("/documents/:document_id/blocks/:block_id", h.readDocumentBlock)
	scope.GET("/documents/:document_id/children", h.childrenBlocks)
	scope.GET("/documents/:document_id/outline", h.documentOutline)
	scope.GET("/documents/:document_id/changes", h.documentChanges)
	scope.POST("/documents/:document_id/operations", h.applyDocumentCommands)
	scope.POST("/documents/:document_id/operations/preview", h.previewDocumentCommands)
	scope.GET("/documents/:document_id/operations/:operation_id", h.documentCommandReceipt)
	scope.POST("/documents/:document_id/collaboration", h.enableDocumentCollaboration)
	scope.GET("/documents/:document_id/collaboration", h.documentCollaboration)
	scope.POST("/documents/:document_id/collaboration/updates", h.updateDocumentCollaboration)
	return r, nil
}

func (h *handler) fail(c *gin.Context, err error) { failure(c, h.deps.Logger, err) }

func (h *handler) requestContext() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method == http.MethodHead {
			c.Writer = headWriter{ResponseWriter: c.Writer}
		}
		started := time.Now()
		requestID := uuid.NewString()
		c.Set(requestIDKey, requestID)
		c.Header("X-Request-ID", requestID)
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Cache-Control", "no-store")
		if c.FullPath() == "/api/v1/me/avatar" || c.FullPath() == "/api/v1/workspaces/:workspace_id/assets/:asset_id/content" {
			secureContentHeaders(c)
		}
		ctx := c.Request.Context()
		cancel := func() {}
		if c.FullPath() != collaborationSocketPath {
			ctx, cancel = context.WithTimeout(ctx, h.deps.RequestTimeout)
		}
		defer cancel()
		c.Request = c.Request.WithContext(ctx)
		bodyLimit := h.deps.MaxBodyBytes
		if c.FullPath() == "/api/v1/workspaces/:workspace_id/documents/:document_id/collaboration/updates" {
			bodyLimit = int64(document.MaxCollaborationUpdateBytes*4/3 + collaborationEnvelopeBytes)
		}
		if c.FullPath() == "/api/v1/agent/workspaces/:workspace_id/documents/:document_id/assets" && c.Request.Method == http.MethodPost {
			bodyLimit = min(h.deps.MaxUploadBytes, integration.MaxAgentUploadBytes) + MultipartOverhead
		}
		if c.FullPath() == "/api/v1/workspaces/:workspace_id/assets" && c.Request.Method == http.MethodPost {
			bodyLimit = h.deps.MaxUploadBytes + MultipartOverhead
		}
		if c.FullPath() == "/api/v1/workspaces/:workspace_id/collection-icons" && c.Request.Method == http.MethodPost {
			bodyLimit = asset.MaxCollectionIconBytes + MultipartOverhead
		}
		if c.FullPath() == "/api/v1/me/avatar" && c.Request.Method == http.MethodPut {
			bodyLimit = asset.MaxAvatarBytes + MultipartOverhead
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, bodyLimit)
		defer func() {
			if recovered := recover(); recovered != nil {
				h.deps.Logger.ErrorContext(
					ctx,
					"Request panicked",
					"request_id",
					requestID,
					"panic_type",
					fmt.Sprintf("%T", recovered),
					"stack",
					string(debug.Stack()),
				)
				if !c.Writer.Written() {
					c.AbortWithStatusJSON(http.StatusInternalServerError, response[any]{
						Code: "INTERNAL_ERROR", Message: "服务内部错误", RequestID: requestID, Data: nil,
					})
				}
				c.Abort()
			}
			route := c.FullPath()
			if route == "" {
				route = "unmatched"
			}
			h.deps.Logger.InfoContext(
				ctx,
				"HTTP request completed",
				"request_id",
				requestID,
				"method",
				c.Request.Method,
				"route",
				route,
				"status",
				c.Writer.Status(),
				"duration_ms",
				time.Since(started).Milliseconds(),
			)
		}()
		c.Next()
	}
}

const actorKey = "orbis.actor"

func (h *handler) authenticate() gin.HandlerFunc {
	return func(c *gin.Context) {
		parts := strings.Fields(c.GetHeader("Authorization"))
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			h.fail(c, fault.Auth())
			return
		}
		actor, err := h.deps.Identity.Authenticate(c.Request.Context(), parts[1])
		if err != nil {
			h.fail(c, err)
			return
		}
		c.Set(actorKey, actor)
		c.Next()
	}
}

func actor(c *gin.Context) identity.Actor { return c.MustGet(actorKey).(identity.Actor) }

func (h *handler) pathIDs() gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := validPathIDs(c); err != nil {
			h.fail(c, err)
			return
		}
		c.Next()
	}
}
