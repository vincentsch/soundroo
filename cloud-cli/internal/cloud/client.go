package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const maxResponseBytes = 16 << 20

// Client talks to one Soundroo service origin. The bearer token, when set, is
// only ever sent to that origin: redirects to another origin are refused.
type Client struct {
	Origin    string
	Token     string
	HTTP      *http.Client
	UserAgent string
	// Sleep waits between retries and polls; tests replace it.
	Sleep func(context.Context, time.Duration) error
	// Retries is the number of extra attempts for retryable requests.
	Retries int
}

// Request is one call below /api/v1.
type Request struct {
	Method  string
	Path    string
	Body    []byte
	Headers map[string]string
	// Retry marks an idempotent request that may be repeated after a network
	// failure or a gateway error.
	Retry bool
	// Anonymous suppresses the bearer token, for guest-key creation.
	Anonymous bool
	Timeout   time.Duration
}

// Response is a successful (2xx) answer.
type Response struct {
	Status   int
	Header   http.Header
	Body     []byte
	Attempts int
}

// NewClient builds a client for a canonical origin.
func NewClient(origin, token, version string) *Client {
	c := &Client{Origin: origin, Token: token, UserAgent: fmt.Sprintf("soundroo-cloud/%s (%s/%s)", version, runtime.GOOS, runtime.GOARCH), Retries: 2}
	c.HTTP = &http.Client{CheckRedirect: c.checkRedirect}
	c.Sleep = SleepContext
	return c
}

// SleepContext waits for d or until ctx ends.
func SleepContext(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (c *Client) checkRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 3 {
		return &Error{Code: "redirect_refused", Exit: ExitAPI, Message: "The Soundroo service redirected too many times."}
	}
	if !SameOrigin(c.Origin, req.URL.String()) {
		return &Error{Code: "redirect_refused", Exit: ExitAPI, Message: fmt.Sprintf("The service at %s redirected to another address (%s://%s). Soundroo sends keys only to the configured service; set --service to the address you trust.", c.Origin, req.URL.Scheme, req.URL.Host)}
	}
	return nil
}

// URL is the absolute address of an API path.
func (c *Client) URL(path string) string {
	return c.Origin + "/api/v1" + path
}

// Do sends the request and returns the 2xx response or an *Error.
func (c *Client) Do(ctx context.Context, r Request) (*Response, error) {
	attempts := 1
	if r.Retry {
		attempts += c.Retries
	}
	var last error
	for attempt := 1; attempt <= attempts; attempt++ {
		resp, retryAfter, err := c.once(ctx, r)
		if err == nil {
			resp.Attempts = attempt
			return resp, nil
		}
		last = err
		var apiErr *Error
		if !errors.As(err, &apiErr) || attempt == attempts || !retryable(apiErr) {
			return nil, err
		}
		wait := time.Duration(attempt) * time.Second
		if retryAfter > 0 {
			wait = time.Duration(retryAfter) * time.Second
		}
		if wait > 30*time.Second {
			return nil, err
		}
		if c.Sleep(ctx, wait) != nil {
			return nil, err
		}
	}
	return nil, last
}

func retryable(e *Error) bool {
	switch {
	case e.Code == "network":
		return true
	case e.Status == 502 || e.Status == 504:
		return true
	case e.Status == 503 && e.RetryAfter > 0:
		return true
	}
	return false
}

func (c *Client) once(ctx context.Context, r Request) (*Response, int, error) {
	timeout := r.Timeout
	if timeout == 0 {
		timeout = 60 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	var body io.Reader
	if r.Body != nil {
		body = bytes.NewReader(r.Body)
	}
	req, err := http.NewRequestWithContext(ctx, r.Method, c.URL(r.Path), body)
	if err != nil {
		return nil, 0, &Error{Code: "invalid_request", Exit: ExitUsage, Message: "The request could not be built: " + err.Error()}
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", c.UserAgent)
	if r.Body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.Token != "" && !r.Anonymous {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	for key, value := range r.Headers {
		req.Header.Set(key, value)
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		var apiErr *Error
		if errors.As(err, &apiErr) {
			return nil, 0, apiErr
		}
		return nil, 0, networkError(c.Origin, err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, maxResponseBytes+1))
	if err != nil {
		return nil, 0, networkError(c.Origin, err)
	}
	if len(data) > maxResponseBytes {
		return nil, 0, &Error{Code: "bad_response", Exit: ExitAPI, Message: "The Soundroo service sent an unexpectedly large response."}
	}
	retryAfter := parseRetryAfter(res.Header.Get("Retry-After"))
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, retryAfter, statusError(res.StatusCode, data, retryAfter)
	}
	return &Response{Status: res.StatusCode, Header: res.Header, Body: data}, retryAfter, nil
}

func networkError(origin string, err error) *Error {
	reason := err.Error()
	var netErr net.Error
	switch {
	case errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &netErr) && netErr.Timeout()):
		reason = "the request timed out"
	case errors.Is(err, context.Canceled):
		reason = "the request was cancelled"
	default:
		// url.Error repeats the method and URL; keep the cause only.
		if i := strings.LastIndex(reason, ": "); i >= 0 {
			reason = reason[i+2:]
		}
	}
	return &Error{Code: "network", Exit: ExitAPI, Message: fmt.Sprintf("Could not reach %s: %s.", origin, strings.TrimSuffix(reason, "."))}
}

func parseRetryAfter(value string) int {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	if seconds, err := strconv.Atoi(value); err == nil && seconds > 0 {
		return seconds
	}
	if when, err := http.ParseTime(value); err == nil {
		if seconds := int(time.Until(when).Seconds()); seconds > 0 {
			return seconds
		}
	}
	return 0
}

// JSON sends the request and decodes a 2xx JSON body into out.
func (c *Client) JSON(ctx context.Context, r Request, out any) (*Response, error) {
	resp, err := c.Do(ctx, r)
	if err != nil {
		return nil, err
	}
	if out != nil {
		if err := decode(resp.Body, out); err != nil {
			return nil, err
		}
	}
	return resp, nil
}

// Resource is JSON for a single Laravel API resource, which arrives wrapped
// in {"data": ...} when a controller returns it directly.
func (c *Client) Resource(ctx context.Context, r Request, out any) (*Response, error) {
	resp, err := c.Do(ctx, r)
	if err != nil {
		return nil, err
	}
	var wrapper map[string]json.RawMessage
	body := resp.Body
	if json.Unmarshal(body, &wrapper) == nil {
		if data, ok := wrapper["data"]; ok && len(bytes.TrimSpace(data)) > 0 && bytes.TrimSpace(data)[0] == '{' {
			body = data
		}
	}
	if err := decode(body, out); err != nil {
		return nil, err
	}
	return resp, nil
}

func decode(body []byte, out any) error {
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	if err := dec.Decode(out); err != nil {
		return &Error{Code: "bad_response", Exit: ExitAPI, Message: "The Soundroo service sent a response this tool does not understand."}
	}
	return nil
}
