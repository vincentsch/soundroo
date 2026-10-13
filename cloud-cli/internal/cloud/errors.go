package cloud

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// Exit codes follow rungrad-spec/1.
const (
	ExitUsage       = 1
	ExitAPI         = 2
	ExitAuth        = 3
	ExitForbidden   = 4
	ExitNotFound    = 5
	ExitRateLimited = 6
)

// Issue is one problem with a JSON path, as the service or local checks report it.
type Issue struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

// Error is the one error type commands return. Code is a stable slug for
// scripts; Message is written for people. Neither ever contains a credential.
type Error struct {
	Code        string
	Message     string
	Exit        int
	Status      int
	Issues      []Issue
	RetryAfter  int
	Hint        string
	ServiceCode string
}

func (e *Error) Error() string { return e.Message }

// ExitCode lets rungrad classify the process exit code.
func (e *Error) ExitCode() int { return e.Exit }

// ErrorDetails adds the stable fields to rungrad's JSON error object.
func (e *Error) ErrorDetails() any {
	details := map[string]any{"code": e.Code}
	if e.Status > 0 {
		details["status"] = e.Status
	}
	if len(e.Issues) > 0 {
		details["issues"] = e.Issues
	}
	if e.RetryAfter > 0 {
		details["retry_after"] = e.RetryAfter
	}
	if e.Hint != "" {
		details["hint"] = e.Hint
	}
	if e.ServiceCode != "" {
		details["service_code"] = e.ServiceCode
	}
	return details
}

// Errorf builds an Error with a formatted message.
func Errorf(code string, exit int, format string, args ...any) *Error {
	return &Error{Code: code, Exit: exit, Message: fmt.Sprintf(format, args...)}
}

// errorBody accepts Laravel's {message, errors} and the application's
// {error: {code, message, issues}} and {error: "text"} shapes.
type errorBody struct {
	Message     string                     `json:"message"`
	Description string                     `json:"error_description"`
	Errors      map[string]json.RawMessage `json:"errors"`
	Error       json.RawMessage            `json:"error"`
}

var slugPattern = regexp.MustCompile(`^[a-z][a-z0-9_.-]{1,63}$`)

type appError struct {
	Code    string  `json:"code"`
	Message string  `json:"message"`
	Issues  []Issue `json:"issues"`
}

// parseErrorBody extracts a message, an optional application code and issues.
func parseErrorBody(body []byte) (message, code string, issues []Issue) {
	var parsed errorBody
	if json.Unmarshal(body, &parsed) != nil {
		return "", "", nil
	}
	message = parsed.Message
	if message == "" {
		message = parsed.Description
	}
	if len(parsed.Error) > 0 {
		var text string
		var structured appError
		if json.Unmarshal(parsed.Error, &text) == nil {
			if slugPattern.MatchString(text) {
				code = text
			} else if message == "" {
				message = text
			}
		} else if json.Unmarshal(parsed.Error, &structured) == nil {
			if structured.Message != "" {
				message = structured.Message
			}
			code = structured.Code
			issues = append(issues, structured.Issues...)
		}
	}
	paths := make([]string, 0, len(parsed.Errors))
	for path := range parsed.Errors {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, path := range paths {
		var list []string
		if json.Unmarshal(parsed.Errors[path], &list) != nil {
			var one string
			if json.Unmarshal(parsed.Errors[path], &one) == nil {
				list = []string{one}
			}
		}
		for _, item := range list {
			issues = append(issues, Issue{Path: path, Message: item})
		}
	}
	return strings.TrimSpace(message), code, issues
}

// statusError maps an HTTP failure to the stable contract.
func statusError(status int, body []byte, retryAfter int) *Error {
	message, code, issues := parseErrorBody(body)
	e := &Error{Status: status, Issues: issues, RetryAfter: retryAfter, Message: message}
	switch {
	case status == 401:
		e.Code, e.Exit = "auth_invalid", ExitAuth
		if e.Message == "" || strings.EqualFold(e.Message, "Unauthenticated.") {
			e.Message = "The Soundroo service did not accept this key."
		}
	case status == 403:
		e.Code, e.Exit = "forbidden", ExitForbidden
		if e.Message == "" || e.Message == "This action is unauthorized." {
			e.Message = "This key is not allowed to do that."
		}
	case status == 404:
		e.Code, e.Exit = "not_found", ExitNotFound
		if e.Message == "" || strings.HasPrefix(e.Message, "No query results") || e.Message == "Not Found" {
			e.Message = "Soundroo could not find that, or it is not shared with you."
		}
	case status == 409:
		e.Code, e.Exit = "conflict", ExitUsage
	case status == 413:
		e.Code, e.Exit = "too_large", ExitUsage
		if e.Message == "" {
			e.Message = "The request is too large for the Soundroo service."
		}
	case status == 422 || status == 400:
		e.Code, e.Exit = "validation_failed", ExitUsage
		if e.Message == "" {
			e.Message = "The Soundroo service did not accept the request."
		}
	case status == 429:
		e.Code, e.Exit = "rate_limited", ExitRateLimited
		if e.Message == "" || e.Message == "Too Many Attempts." {
			e.Message = "The Soundroo service asked to slow down. Try again later."
		}
	case status == 503:
		e.Code, e.Exit = "service_unavailable", ExitAPI
	default:
		e.Code, e.Exit = "server_error", ExitAPI
	}
	e.ServiceCode = code
	if e.Message == "" {
		e.Message = fmt.Sprintf("The Soundroo service answered with HTTP %d.", status)
	}
	return e
}
