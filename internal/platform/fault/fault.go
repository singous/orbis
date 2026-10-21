package fault

import "fmt"

type Kind int

const (
	Invalid Kind = iota
	Unauthenticated
	Forbidden
	NotFound
	Conflict
	Validation
	Unavailable
	TooLarge
	RangeNotSatisfiable
	PreconditionFailed
)

type Error struct {
	Kind    Kind
	Code    string
	Message string
	Details any
}

// Error identifies a business failure; Message is reserved for client presentation.
func (e *Error) Error() string { return fmt.Sprintf("%s: %s", e.Code, e.Message) }

// New marks a failure as safe for the HTTP boundary to translate.
func New(kind Kind, code, message string) *Error {
	return &Error{Kind: kind, Code: code, Message: message}
}

type FieldError struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Field attaches a validation failure to a named request field.
func Field(field, message string) *Error {
	return &Error{Kind: Validation, Code: "VALIDATION_ERROR", Message: "请求字段校验失败", Details: map[string]any{
		"errors": []FieldError{{Field: field, Code: "INVALID_VALUE", Message: message}},
	}}
}

// Missing hides whether a resource exists outside the caller scope.
func Missing() *Error { return New(NotFound, "RESOURCE_NOT_FOUND", "请求的资源不存在") }

// Denied reports insufficient permission within an accessible scope.
func Denied() *Error { return New(Forbidden, "ACCESS_FORBIDDEN", "没有权限执行此操作") }

// Auth asks clients to authenticate again without exposing credential details.
func Auth() *Error { return New(Unauthenticated, "AUTH_REQUIRED", "请重新登录") }
