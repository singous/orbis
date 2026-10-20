package client

import (
	"errors"
	"fmt"
)

type Envelope struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID any    `json:"request_id"`
	Data      any    `json:"data"`
}

type Error struct {
	Envelope
	ExitCode  int
	Uncertain bool
}

func (e *Error) Error() string { return fmt.Sprintf("%s: %s", e.Code, e.Message) }
func Failure(code, message string, exit int, data any) *Error {
	return &Error{Envelope: Envelope{Code: code, Message: message, Data: data}, ExitCode: exit}
}
func Network(data any) *Error {
	return Failure("CLI_NETWORK_ERROR", "无法确认请求结果，请查询原始请求状态", 6, data)
}
func IsNetwork(err error) bool { e, ok := err.(*Error); return ok && e.Code == "CLI_NETWORK_ERROR" }
func MayHaveCommitted(err error) bool {
	var e *Error
	return errors.As(err, &e) && (e.Uncertain || e.Code == "CLI_NETWORK_ERROR")
}
func OK(data any) Envelope { return Envelope{Code: "OK", Message: "命令执行成功", Data: data} }
func ExitCode(status int) int {
	switch status {
	case 401:
		return 3
	case 403:
		return 4
	case 404, 413, 422:
		return 2
	case 409:
		return 5
	case 429:
		return 6
	default:
		return 7
	}
}
func Object(value any) map[string]any { m, _ := value.(map[string]any); return m }
