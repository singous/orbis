package httpapi

import (
	"context"
	"errors"
	"io"
	"mime/multipart"
	"net/http"

	"github.com/gin-gonic/gin"

	"orbis.local/orbis/internal/asset"
	"orbis.local/orbis/internal/platform/fault"
)

const MultipartOverhead int64 = 1 << 20

type assetDTO struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspace_id"`
	OwnerID     string `json:"owner_id"`
	Filename    string `json:"filename"`
	MediaType   string `json:"media_type"`
	SizeBytes   int64  `json:"size_bytes"`
	SHA256      string `json:"sha256"`
	CreatedAtMS int64  `json:"created_at_ms"`
}

func assetResponse(row asset.Record) assetDTO {
	wid := ""
	if row.WorkspaceID != nil {
		wid = *row.WorkspaceID
	}
	return assetDTO{
		ID:          row.ID,
		WorkspaceID: wid,
		OwnerID:     row.OwnerID,
		Filename:    row.Filename,
		MediaType:   row.MediaType,
		SizeBytes:   row.SizeBytes,
		SHA256:      row.SHA256,
		CreatedAtMS: row.CreatedAtMS,
	}
}
func assetScope(c *gin.Context) asset.Scope {
	return asset.Scope{ActorID: actor(c).UserID, WorkspaceID: c.Param("workspace_id")}
}
func (h *handler) assets(c *gin.Context) {
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	items, total, err := h.deps.Assets.List(c.Request.Context(), assetScope(c), page)
	if err != nil {
		h.fail(c, err)
		return
	}
	rows := make([]assetDTO, 0, len(items))
	for _, item := range items {
		rows = append(rows, assetResponse(item))
	}
	listResponse(c, rows, total, page)
}
func (h *handler) asset(c *gin.Context) {
	row, err := h.deps.Assets.File(c.Request.Context(), assetScope(c), c.Param("asset_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, assetResponse(row))
}
func (h *handler) uploadAsset(c *gin.Context) {
	part, reader, err := uploadPart(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	row, err := h.deps.Assets.Upload(c.Request.Context(), assetScope(c), part.FileName(), part.Header.Get("Content-Type"), reader)
	if err != nil {
		h.fail(c, uploadFailure(err))
		return
	}
	success(c, http.StatusCreated, assetResponse(row))
}
func (h *handler) assetContent(c *gin.Context) {
	secureContentHeaders(c)
	row, err := h.deps.Assets.File(c.Request.Context(), assetScope(c), c.Param("asset_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	h.deliverAsset(c, row)
}
func (h *handler) avatar(c *gin.Context) {
	secureContentHeaders(c)
	row, err := h.deps.Assets.Avatar(c.Request.Context(), actor(c).UserID)
	if err != nil {
		h.fail(c, err)
		return
	}
	h.deliverAsset(c, row)
}
func (h *handler) setAvatar(c *gin.Context) {
	expected, err := integerQuery(c, "expected_version", 0)
	if err != nil {
		h.fail(c, err)
		return
	}
	_, reader, err := uploadPart(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	user, err := h.deps.Assets.SetAvatar(c.Request.Context(), actor(c).UserID, expected, reader)
	if err != nil {
		h.fail(c, uploadFailure(err))
		return
	}
	success(c, http.StatusOK, userResponse(user))
}
func (h *handler) clearAvatar(c *gin.Context) {
	var input struct {
		ExpectedVersion int64 `json:"expected_version"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	user, err := h.deps.Assets.ClearAvatar(c.Request.Context(), actor(c).UserID, input.ExpectedVersion)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, userResponse(user))
}

type singlePart struct {
	part     *multipart.Part
	reader   *multipart.Reader
	finished bool
}

func uploadPart(c *gin.Context) (*multipart.Part, io.Reader, error) {
	reader, err := c.Request.MultipartReader()
	if err != nil {
		return nil, nil, fault.New(fault.Invalid, "INVALID_CONTENT_TYPE", "请求必须使用 multipart/form-data")
	}
	part, err := reader.NextPart()
	if err != nil {
		return nil, nil, multipartFailure(err)
	}
	if part.FormName() != "file" || part.FileName() == "" {
		return nil, nil, fault.Field("body.file", "请提供一个名为 file 的文件字段")
	}
	return part, &singlePart{part: part, reader: reader}, nil
}
func (r *singlePart) Read(p []byte) (int, error) {
	if r.finished {
		return 0, io.EOF
	}
	n, err := r.part.Read(p)
	if err == io.EOF {
		r.finished = true
		_, nextErr := r.reader.NextPart()
		if nextErr == nil {
			return n, fault.Field("body.file", "一次只能上传一个文件，不能包含其他字段")
		}
		if !errors.Is(nextErr, io.EOF) {
			return n, multipartFailure(nextErr)
		}
	} else if err != nil {
		return n, multipartFailure(err)
	}
	return n, err
}
func uploadFailure(err error) error {
	var oversized *http.MaxBytesError
	if errors.As(err, &oversized) {
		return fault.New(fault.TooLarge, "REQUEST_TOO_LARGE", "请求体超出大小限制")
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return fault.New(fault.Invalid, "INVALID_REQUEST", "上传请求不完整")
	}
	return err
}

func multipartFailure(err error) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	var oversized *http.MaxBytesError
	if errors.As(err, &oversized) {
		return uploadFailure(err)
	}
	return fault.New(fault.Invalid, "INVALID_REQUEST", "上传请求格式不正确或不完整")
}

func (h *handler) uploadCollectionIcon(c *gin.Context) {
	_, reader, err := uploadPart(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Assets.UploadCollectionIcon(c.Request.Context(), assetScope(c), reader)
	if err != nil {
		h.fail(c, uploadFailure(err))
		return
	}
	success(c, http.StatusCreated, assetResponse(result))
}
