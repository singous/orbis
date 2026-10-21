package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
)

const requestIDKey = "orbis.request_id"
const maxSafeInteger int64 = 9007199254740991

type response[T any] struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"request_id"`
	Data      T      `json:"data"`
}

type pageInfo struct {
	Page     int   `json:"page"`
	PageSize int   `json:"page_size"`
	Total    int64 `json:"total"`
}

type pageData[T any] struct {
	Items      []T      `json:"items"`
	Pagination pageInfo `json:"pagination"`
}

func success[T any](c *gin.Context, status int, data T) {
	code, message := "OK", "请求成功"
	if status == http.StatusCreated {
		code, message = "CREATED", "创建成功"
	}
	if status == http.StatusAccepted {
		code, message = "ACCEPTED", "已受理"
	}
	c.JSON(status, response[T]{
		Code: code, Message: message, RequestID: c.GetString(requestIDKey), Data: data,
	})
}

func listResponse[T any](c *gin.Context, items []T, total int64, page pagination.Page) {
	if items == nil {
		items = []T{}
	}
	success(c, http.StatusOK, pageData[T]{
		Items:      items,
		Pagination: pageInfo{Page: page.Number, PageSize: page.Size, Total: total},
	})
}

func failure(c *gin.Context, logger *slog.Logger, err error) {
	status, code, message := http.StatusInternalServerError, "INTERNAL_ERROR", "服务内部错误"
	var details any
	var business *fault.Error
	if errors.As(err, &business) {
		statuses := map[fault.Kind]int{
			fault.Invalid:             http.StatusBadRequest,
			fault.Unauthenticated:     http.StatusUnauthorized,
			fault.Forbidden:           http.StatusForbidden,
			fault.NotFound:            http.StatusNotFound,
			fault.Conflict:            http.StatusConflict,
			fault.Validation:          http.StatusUnprocessableEntity,
			fault.Unavailable:         http.StatusServiceUnavailable,
			fault.TooLarge:            http.StatusRequestEntityTooLarge,
			fault.RangeNotSatisfiable: http.StatusRequestedRangeNotSatisfiable,
			fault.PreconditionFailed:  http.StatusPreconditionFailed,
		}
		if mapped, ok := statuses[business.Kind]; ok {
			status = mapped
		}
		code, message, details = business.Code, business.Message, business.Details
	} else {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			status, code, message = http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "请求未完成，请稍后重试"
		}
		logger.ErrorContext(
			c.Request.Context(),
			"Request failed",
			"request_id",
			c.GetString(requestIDKey),
			"route",
			c.FullPath(),
			"error",
			err,
		)
	}
	if status == http.StatusUnauthorized {
		c.Header("WWW-Authenticate", "Bearer")
	}
	c.AbortWithStatusJSON(status, response[any]{
		Code: code, Message: message, RequestID: c.GetString(requestIDKey), Data: details,
	})
}

func decode(c *gin.Context, target any) error {
	mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return fault.New(fault.Invalid, "INVALID_CONTENT_TYPE", "请求必须使用 application/json")
	}
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		var oversized *http.MaxBytesError
		if errors.As(err, &oversized) {
			return fault.New(fault.TooLarge, "REQUEST_TOO_LARGE", "请求体超出大小限制")
		}
		var mismatch *json.UnmarshalTypeError
		if errors.As(err, &mismatch) {
			return fault.Field("body."+mismatch.Field, "字段类型不正确")
		}
		return fault.New(fault.Invalid, "INVALID_REQUEST", "请求不是有效的 JSON 对象或包含未知字段")
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		var oversized *http.MaxBytesError
		if errors.As(err, &oversized) {
			return fault.New(fault.TooLarge, "REQUEST_TOO_LARGE", "请求体超出大小限制")
		}
		return fault.New(fault.Invalid, "INVALID_REQUEST", "请求只能包含一个 JSON 对象")
	}
	return nil
}

func integerQuery(c *gin.Context, name string, fallback int64) (int64, error) {
	values, present := c.Request.URL.Query()[name]
	if !present {
		return fallback, nil
	}
	if len(values) != 1 {
		return 0, fault.Field("query."+name, "参数只能出现一次")
	}
	n, err := strconv.ParseInt(values[0], 10, 64)
	if err != nil || n < 1 || n > maxSafeInteger {
		return 0, fault.Field("query."+name, "参数必须是范围内的正整数")
	}
	return n, nil
}

func pageQuery(c *gin.Context) (pagination.Page, error) {
	number, err := integerQuery(c, "page", 1)
	if err != nil {
		return pagination.Page{}, err
	}
	size, err := integerQuery(c, "page_size", pagination.DefaultSize)
	if err != nil {
		return pagination.Page{}, err
	}
	if number > int64(^uint(0)>>1) || size > pagination.MaxSize {
		return pagination.Page{}, fault.Field("query.page_size", "分页参数超出范围")
	}
	return pagination.New(int(number), int(size))
}

func validPathIDs(c *gin.Context) error {
	for _, key := range []string{"workspace_id", "collection_id", "document_id", "user_id", "invitation_id", "transfer_id", "group_id", "comment_id", "asset_id", "table_id"} {
		value := c.Param(key)
		if value == "" {
			continue
		}
		id, err := uuid.Parse(value)
		if err != nil || id == uuid.Nil || id.String() != value {
			return fault.Field("path."+key, "资源 ID 必须是标准 UUID")
		}
	}
	return nil
}
