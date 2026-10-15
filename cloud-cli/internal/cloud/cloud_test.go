package cloud

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestParseOriginCanonicalizesAndRefusesUnsafeURLs(t *testing.T) {
	good := map[string]string{
		"https://soundroo.com":         "https://soundroo.com",
		"HTTPS://SoundRoo.COM:443/":    "https://soundroo.com",
		" https://soundroo.com/ ":      "https://soundroo.com",
		"https://www.soundroo.com":     "https://www.soundroo.com",
		"https://staging.example:8443": "https://staging.example:8443",
		"http://127.0.0.1:8350":        "http://127.0.0.1:8350",
		"http://localhost:8350/":       "http://localhost:8350",
		"http://[::1]:8350":            "http://[::1]:8350",
		"http://127.0.0.2":             "http://127.0.0.2",
	}
	for in, want := range good {
		got, err := ParseOrigin(in)
		if err != nil || got != want {
			t.Errorf("ParseOrigin(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, bad := range []string{"", "soundroo.com", "http://soundroo.com", "http://192.168.1.5:8350", "ftp://soundroo.com", "https://user:pass@soundroo.com", "https://soundroo.com/api/v1", "https://soundroo.com/?x=1", "https://soundroo.com/#top", "javascript:alert(1)", "https://"} {
		if got, err := ParseOrigin(bad); err == nil {
			t.Errorf("ParseOrigin(%q) accepted as %q", bad, got)
		}
	}
	if !SameOrigin("https://soundroo.com", "https://soundroo.com:443/link?code=1") || SameOrigin("https://soundroo.com", "https://www.soundroo.com/link") || SameOrigin("https://soundroo.com", "/link") {
		t.Error("SameOrigin")
	}
}

func TestErrorBodiesInEveryServiceShape(t *testing.T) {
	laravel := statusError(422, []byte(`{"message":"The title field is required. (and 1 more error)","errors":{"collection.title":["The title field is required."],"tracks.0.score":["Too large."]}}`), 0)
	if laravel.Code != "validation_failed" || laravel.Exit != ExitUsage || len(laravel.Issues) != 2 || laravel.Issues[0].Path != "collection.title" {
		t.Fatalf("laravel validation: %+v", laravel)
	}
	app := statusError(422, []byte(`{"error":{"code":"duplicate_music","message":"This music already belongs to another artist.","issues":[{"path":"tracks.0.score","message":"Change the arrangement."}]}}`), 0)
	if app.Code != "validation_failed" || app.ServiceCode != "duplicate_music" || app.Message != "This music already belongs to another artist." || len(app.Issues) != 1 {
		t.Fatalf("application error: %+v", app)
	}
	both := statusError(422, []byte(`{"error":{"code":"invalid_request","message":"Use another address.","issues":[{"path":"email","message":"Use another address."}]},"message":"Use another address.","errors":{"email":["Use another address."]}}`), 0)
	if len(both.Issues) != 1 || both.Issues[0].Path != "email" {
		t.Fatalf("the same problem in both shapes is reported once: %+v", both.Issues)
	}
	device := statusError(400, []byte(`{"error":"authorization_pending","error_description":"Waiting for approval."}`), 0)
	if device.ServiceCode != "authorization_pending" || device.Message != "Waiting for approval." {
		t.Fatalf("device error: %+v", device)
	}
	auth := statusError(401, []byte(`{"message":"Unauthenticated."}`), 0)
	if auth.Exit != ExitAuth || auth.Message == "Unauthenticated." {
		t.Fatalf("401: %+v", auth)
	}
	html := statusError(502, []byte(`<html>bad gateway</html>`), 0)
	if html.Exit != ExitAPI || html.Message == "" {
		t.Fatalf("html body: %+v", html)
	}
	limited := statusError(429, []byte(`{"message":"Too Many Attempts."}`), 60)
	if limited.Exit != ExitRateLimited || limited.RetryAfter != 60 {
		t.Fatalf("429: %+v", limited)
	}
	if parseRetryAfter("120") != 120 || parseRetryAfter("soon") != 0 || parseRetryAfter("") != 0 {
		t.Fatal("Retry-After")
	}
}

func TestRetriesOnlyIdempotentTransientFailures(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&calls, 1) < 3 {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()
	origin, _ := ParseOrigin(srv.URL)
	c := NewClient(origin, "", "test")
	var waits []time.Duration
	c.Sleep = func(_ context.Context, d time.Duration) error { waits = append(waits, d); return nil }
	var out map[string]bool
	if _, err := c.JSON(context.Background(), Request{Method: "GET", Path: "/meta", Retry: true}, &out); err != nil || !out["ok"] {
		t.Fatalf("retry failed: %v", err)
	}
	if calls != 3 || len(waits) != 2 {
		t.Fatalf("calls %d waits %v", calls, waits)
	}
	atomic.StoreInt32(&calls, 0)
	_, err := c.Do(context.Background(), Request{Method: "POST", Path: "/guest-keys", Body: []byte(`{}`)})
	var apiErr *Error
	if !errors.As(err, &apiErr) || apiErr.Status != 502 || calls != 1 {
		t.Fatalf("non-idempotent request was retried: %d %v", calls, err)
	}
}

func TestNetworkErrorsAreStableAndSecretFree(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close()
	origin, _ := ParseOrigin(url)
	c := NewClient(origin, "9|secret-token-value", "test")
	c.Sleep = func(context.Context, time.Duration) error { return nil }
	_, err := c.Do(context.Background(), Request{Method: "GET", Path: "/me", Retry: true})
	var apiErr *Error
	if !errors.As(err, &apiErr) || apiErr.Code != "network" || apiErr.Exit != ExitAPI {
		t.Fatalf("network error: %v", err)
	}
	if strings.Contains(apiErr.Message, "secret-token-value") || !strings.Contains(apiErr.Message, origin) {
		t.Fatalf("message: %q", apiErr.Message)
	}
}
