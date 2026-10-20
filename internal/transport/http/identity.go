package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (h *handler) setupStatus(c *gin.Context) {
	initialized, err := h.deps.Setup.Status(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"initialized": initialized})
}

func (h *handler) setup(c *gin.Context) {
	var input struct {
		Email         string `json:"email"`
		Password      string `json:"password"`
		DisplayName   string `json:"display_name"`
		WorkspaceName string `json:"workspace_name"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	user, workspace, err := h.deps.Setup.Initialize(
		c.Request.Context(),
		input.Email,
		input.Password,
		input.DisplayName,
		input.WorkspaceName,
	)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusCreated, gin.H{"user": userResponse(user), "workspace": workspaceResponse(workspace)})
}

func (h *handler) login(c *gin.Context) {
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	tokens, err := h.deps.Identity.Login(c.Request.Context(), input.Email, input.Password)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, tokensResponse(tokens))
}

func (h *handler) refresh(c *gin.Context) {
	var input struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	tokens, err := h.deps.Identity.Refresh(c.Request.Context(), input.RefreshToken)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, tokensResponse(tokens))
}

func (h *handler) logout(c *gin.Context) {
	if err := h.deps.Identity.Logout(c.Request.Context(), actor(c)); err != nil {
		h.fail(c, err)
		return
	}
	success[any](c, http.StatusOK, nil)
}

func (h *handler) me(c *gin.Context) {
	user, err := h.deps.Identity.Me(c.Request.Context(), actor(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, userResponse(user))
}

func (h *handler) workspaces(c *gin.Context) {
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	items, total, err := h.deps.Workspaces.List(c.Request.Context(), actor(c).UserID, page)
	if err != nil {
		h.fail(c, err)
		return
	}
	rows := make([]workspaceDTO, 0, len(items))
	for _, item := range items {
		rows = append(rows, workspaceResponse(item))
	}
	listResponse(
		c,
		rows,
		total,
		page,
	)
}

func (h *handler) createWorkspace(c *gin.Context) {
	var input struct {
		Name string `json:"name"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	workspace, err := h.deps.Workspaces.Create(c.Request.Context(), actor(c).UserID, input.Name)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusCreated, workspaceResponse(workspace))
}
