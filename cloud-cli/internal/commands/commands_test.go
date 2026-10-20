package commands

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	rungrad "github.com/vincentsch/rungrad"
	"github.com/vincentsch/rungrad/testutil"
)

type harness struct {
	t          *testing.T
	configHome string
	env        map[string]string
	clock      time.Time
	stdin      string
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	return &harness{t: t, configHome: t.TempDir(), env: map[string]string{}, clock: time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)}
}

func (h *harness) app() *rungrad.App {
	return NewApp(Options{
		Now: func() time.Time {
			h.clock = h.clock.Add(time.Second)
			return h.clock
		},
		Sleep: func(_ context.Context, d time.Duration) error {
			h.clock = h.clock.Add(d)
			return nil
		},
		Hostname: func() (string, error) { return "test-host", nil },
	})
}

func (h *harness) run(args ...string) testutil.Result {
	h.t.Helper()
	return testutil.RunWith(h.app(), testutil.Options{
		Stdin:         strings.NewReader(h.stdin),
		UserConfigDir: func() (string, error) { return h.configHome, nil },
		LookupEnv: func(name string) (string, bool) {
			value, ok := h.env[name]
			return value, ok
		},
		BrowserOpener: func(_ context.Context, url string) error {
			h.t.Errorf("the CLI must never open a browser, tried %s", url)
			return nil
		},
	}, args...)
}

func (h *harness) configDir() string { return filepath.Join(h.configHome, Name) }

func (h *harness) files() []string {
	var out []string
	_ = filepath.Walk(h.configHome, func(path string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			rel, _ := filepath.Rel(h.configHome, path)
			out = append(out, rel)
		}
		return nil
	})
	return out
}

func (h *harness) credentials() map[string]map[string]string {
	data, err := os.ReadFile(filepath.Join(h.configDir(), "credentials.json"))
	if err != nil {
		return nil
	}
	var file struct {
		Entries map[string]map[string]string `json:"entries"`
	}
	if err := json.Unmarshal(data, &file); err != nil {
		h.t.Fatal(err)
	}
	return file.Entries
}

const samplePayload = `{"client":{"name":"soundroo","version":"0.4.0"},"collection":{"description":"","title":"Night Trains","visibility":"unlisted"},"engine":{"hash":"1d1024545c6bdd5c18315dd66bde806fcbf9a63e8d6dc954ff684be3c78bb7ea","version":"0.4.0"},"libraryUid":"sr-0123456789abcdef","rightsAccepted":true,"tracks":[{"access":"open","clientRevision":"0123456789abcdef01234567","localId":"night-train","mix":{},"position":0,"score":{"beats":64,"bpm":120,"id":"night-train","master":{},"parts":[{"id":"0","instrument":"bass","notes":[{"beat":0,"duration":1,"pitch":40,"velocity":0.30000000000000004}],"patterns":{"0":{"beats":4,"notes":[]},"1":{"beats":4,"notes":[]}},"tone":{}}],"title":"Night Train","version":2},"visibility":"unlisted"}]}`

func writePayload(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "release.json")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func decodeJSON(t *testing.T, text string) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("not JSON: %v\n%s", err, text)
	}
	return out
}

func TestPublishDryRunTouchesNothing(t *testing.T) {
	svc := newFakeService(t)
	h := newHarness(t)
	path := writePayload(t, samplePayload)
	for _, args := range [][]string{
		{"publish", "--payload", path, "--rights-accepted", "--dry-run", "--service", svc.URL()},
		{"publish", "--payload", path, "--dry-run", "--json", "--service", svc.URL()},
		{"logout", "--dry-run", "--service", svc.URL()},
		{"login", "--dry-run", "--service", svc.URL()},
		{"track", "delete", "01JABCDEFGHJKMNPQRSTVWXYZ0", "--dry-run", "--service", svc.URL()},
		{"track", "update", "01JABCDEFGHJKMNPQRSTVWXYZ0", "--access", "listen-only", "--dry-run", "--service", svc.URL()},
	} {
		res := h.run(args...)
		if res.Exit != 0 {
			t.Fatalf("%v exit %d: %s", args, res.Exit, res.Stderr)
		}
		if !strings.Contains(res.Stdout, "no changes were made") && !strings.Contains(res.Stdout, `"dry_run": true`) {
			t.Fatalf("%v did not print a preview:\n%s", args, res.Stdout)
		}
	}
	if calls := svc.calls(); len(calls) != 0 {
		t.Fatalf("dry runs contacted the service: %+v", calls)
	}
	if files := h.files(); len(files) != 0 {
		t.Fatalf("dry runs wrote configuration: %v", files)
	}
	preview := decodeJSON(t, h.run("publish", "--payload", path, "--dry-run", "--json", "--service", svc.URL()).Stdout)
	body := preview["body"].(map[string]any)
	if preview["method"] != "POST" || preview["path"] != "/api/v1/releases" || body["rightsAccepted"] != "no (required to publish)" || body["key"] != "a new guest artist would be created" {
		t.Fatalf("unexpected preview: %v", preview)
	}
	if !strings.HasPrefix(preview["idempotency"].(string), "sr1-") {
		t.Fatalf("preview lacks the idempotency key: %v", preview)
	}
}

func TestPublishCreatesGuestStoresKeyPerOriginAndKeepsPayloadBytes(t *testing.T) {
	svc := newFakeService(t)
	h := newHarness(t)
	path := writePayload(t, samplePayload)
	res := h.run("publish", "--payload", path, "--rights-accepted", "--idempotency-key", "sr1-test-key-0001", "--json", "--service", svc.URL())
	if res.Exit != 0 {
		t.Fatalf("publish failed: %d %s", res.Exit, res.Stderr)
	}
	out := decodeJSON(t, res.Stdout)
	if out["claimUrl"] == nil || !strings.HasPrefix(out["claimUrl"].(string), svc.URL()+"/claim/") {
		t.Fatalf("publish did not return the claim link: %v", out)
	}
	tracks := out["tracks"].([]any)
	first := tracks[0].(map[string]any)
	if first["localId"] != "night-train" || !strings.HasPrefix(first["shortUrl"].(string), svc.URL()+"/t/") {
		t.Fatalf("track links missing: %v", first)
	}
	collection := out["collection"].(map[string]any)
	if !strings.HasPrefix(collection["shortUrl"].(string), svc.URL()+"/c/") {
		t.Fatalf("collection link missing: %v", collection)
	}
	cred := out["credential"].(map[string]any)
	if cred["created"] != true || cred["kind"] != "guest" || cred["source"] != "file" {
		t.Fatalf("credential summary: %v", cred)
	}
	if svc.count("POST", "/api/v1/guest-keys") != 1 || svc.count("POST", "/api/v1/releases") != 1 {
		t.Fatalf("unexpected calls: %+v", svc.calls())
	}
	// The service received the exact bytes: {} stays {}, numeric map keys stay
	// keys and the float keeps its digits.
	for _, call := range svc.calls() {
		if call.Path == "/api/v1/releases" {
			if string(call.Body) != samplePayload {
				t.Fatalf("payload changed in transit:\n%s", call.Body)
			}
			if call.Idempotency != "sr1-test-key-0001" {
				t.Fatalf("idempotency key %q", call.Idempotency)
			}
			if !strings.HasPrefix(call.Auth, "Bearer 1|guestsecret") {
				t.Fatalf("release was not sent with the guest key")
			}
		}
		if call.Path == "/api/v1/guest-keys" && call.Auth != "" {
			t.Fatalf("guest key creation must not carry a key")
		}
	}
	entries := h.credentials()
	if len(entries) != 1 || entries[svc.URL()]["token"] == "" {
		t.Fatalf("key not stored for exactly this origin: %v", entries)
	}
	if strings.Contains(res.Stdout+res.Stderr, entries[svc.URL()]["token"]) {
		t.Fatal("the guest key appeared in the output")
	}
	if runtime.GOOS != "windows" {
		for _, name := range []string{"credentials.json", "accounts.json"} {
			info, err := os.Stat(filepath.Join(h.configDir(), name))
			if err != nil || info.Mode().Perm() != 0o600 {
				t.Fatalf("%s must be owner-only: %v %v", name, info.Mode(), err)
			}
		}
	}
	// A second publish reuses the stored key; the same key replays.
	again := h.run("publish", "--payload", path, "--rights-accepted", "--idempotency-key", "sr1-test-key-0001", "--json", "--service", svc.URL())
	if again.Exit != 0 {
		t.Fatalf("second publish: %s", again.Stderr)
	}
	replay := decodeJSON(t, again.Stdout)
	if replay["release"].(map[string]any)["replayed"] != true || replay["release"].(map[string]any)["id"] != out["release"].(map[string]any)["id"] {
		t.Fatalf("idempotent replay not reported: %v", replay["release"])
	}
	if svc.count("POST", "/api/v1/guest-keys") != 1 {
		t.Fatal("a second guest was created")
	}
	status := decodeJSON(t, h.run("auth", "status", "--json", "--service", svc.URL()).Stdout)
	key := status["key"].(map[string]any)
	if key["kind"] != "guest" || !strings.HasPrefix(key["masked"].(string), "****") || key["claimUrl"] == nil {
		t.Fatalf("auth status: %v", status)
	}
}

func TestPublishRequiresRightsAndValidPayload(t *testing.T) {
	svc := newFakeService(t)
	h := newHarness(t)
	path := writePayload(t, samplePayload)
	res := h.run("publish", "--payload", path, "--json", "--service", svc.URL())
	if res.Exit != 1 || decodeJSON(t, res.Stderr)["code"] != "rights_not_accepted" {
		t.Fatalf("missing --rights-accepted: %d %s", res.Exit, res.Stderr)
	}
	declined := writePayload(t, strings.Replace(samplePayload, `"rightsAccepted":true`, `"rightsAccepted":false`, 1))
	if res := h.run("publish", "--payload", declined, "--rights-accepted", "--service", svc.URL()); res.Exit != 1 {
		t.Fatalf("payload without rights was sent: %d", res.Exit)
	}
	broken := writePayload(t, `{"libraryUid":"../x","collection":{"title":""},"tracks":[{"localId":"a","score":[],"mix":[]}],"engine":{"version":"0.4.0","hash":"x"},"extra":1}`)
	res = h.run("publish", "--payload", broken, "--rights-accepted", "--json", "--service", svc.URL())
	errBody := decodeJSON(t, res.Stderr)
	if res.Exit != 1 || errBody["code"] != "invalid_payload" || len(errBody["issues"].([]any)) < 5 {
		t.Fatalf("invalid payload: %d %v", res.Exit, errBody)
	}
	if len(svc.calls()) != 0 {
		t.Fatal("invalid publishes reached the service")
	}
	if len(h.files()) != 0 {
		t.Fatal("refused publishes stored a key")
	}
}

func TestServiceErrorsMapToStableCodes(t *testing.T) {
	cases := []struct {
		status int
		body   string
		exit   int
		code   string
	}{
		{422, `{"message":"The given data was invalid.","errors":{"tracks.0.score":["parts[0].notes: Note extends past its score."],"engine.hash":["Your engine hash differs from this release."]}}`, 1, "validation_failed"},
		{409, `{"message":"This idempotency key was used for different music. Use a new key."}`, 1, "conflict"},
		{403, `{"message":"This account cannot publish."}`, 4, "forbidden"},
		{429, `{"message":"Your daily publishing limit is reached. Try again tomorrow."}`, 6, "rate_limited"},
		{503, `{"message":"Guest publishing is paused."}`, 2, "service_unavailable"},
		{500, `{"message":"Server Error"}`, 2, "server_error"},
		{401, `{"message":"Unauthenticated."}`, 3, "auth_invalid"},
	}
	for _, tc := range cases {
		svc := newFakeService(t)
		svc.addToken("5|storedsecret00000000000000000000", "mara", "active", "publish", "manage")
		svc.releaseError = func(_ *httpRequest, _ []byte) (int, string) { return tc.status, tc.body }
		h := newHarness(t)
		h.env[TokenEnv] = "5|storedsecret00000000000000000000"
		path := writePayload(t, samplePayload)
		res := h.run("publish", "--payload", path, "--rights-accepted", "--json", "--service", svc.URL())
		if res.Exit != tc.exit {
			t.Fatalf("HTTP %d: exit %d, want %d (%s)", tc.status, res.Exit, tc.exit, res.Stderr)
		}
		body := decodeJSON(t, res.Stderr)
		if body["code"] != tc.code || int(body["exit_code"].(float64)) != tc.exit || int(body["status"].(float64)) != tc.status {
			t.Fatalf("HTTP %d: error body %v", tc.status, body)
		}
		if res.Stdout != "" {
			t.Fatalf("stdout must stay empty on errors: %q", res.Stdout)
		}
		if tc.status == 422 {
			issues := body["issues"].([]any)
			if len(issues) != 2 || issues[0].(map[string]any)["path"] != "engine.hash" {
				t.Fatalf("validation issues: %v", issues)
			}
			human := h.run("publish", "--payload", path, "--rights-accepted", "--service", svc.URL())
			if !strings.Contains(human.Stderr, "  - tracks.0.score: parts[0].notes: Note extends past its score.") {
				t.Fatalf("human error lacks issues:\n%s", human.Stderr)
			}
		}
		if tc.status == 503 && svc.count("POST", "/api/v1/releases") != 1 {
			t.Fatal("a definitive 503 without Retry-After must not be retried")
		}
	}
}

func TestKeysNeverAppearEvenWhenTheServiceEchoesThem(t *testing.T) {
	svc := newFakeService(t)
	const secret = "7|echoedsecret999999999999999999999"
	svc.addToken(secret, "mara", "active", "publish", "manage")
	svc.echoToken = true
	svc.releaseError = func(_ *httpRequest, _ []byte) (int, string) {
		return 422, `{"message":"Rejected key TOKEN for this release","errors":{"collection.title":["TOKEN is not a title"]}}`
	}
	h := newHarness(t)
	h.env[TokenEnv] = secret
	path := writePayload(t, samplePayload)
	for _, args := range [][]string{
		{"publish", "--payload", path, "--rights-accepted", "--service", svc.URL()},
		{"publish", "--payload", path, "--rights-accepted", "--json", "--service", svc.URL()},
		{"auth", "status", "--service", svc.URL()},
		{"auth", "status", "--json", "--service", svc.URL()},
		{"publish", "--payload", path, "--dry-run", "--service", svc.URL()},
		{"me", "--service", svc.URL()},
	} {
		res := h.run(args...)
		if strings.Contains(res.Stdout+res.Stderr, secret) || strings.Contains(res.Stdout+res.Stderr, "echoedsecret") {
			t.Fatalf("%v printed the key:\n%s\n%s", args, res.Stdout, res.Stderr)
		}
	}
	res := h.run("publish", "--payload", path, "--rights-accepted", "--json", "--service", svc.URL())
	if !strings.Contains(res.Stderr, "[REDACTED]") {
		t.Fatalf("expected redaction marker:\n%s", res.Stderr)
	}
}

func TestKeysStayWithTheirOrigin(t *testing.T) {
	prod := newFakeService(t)
	dev := newFakeService(t)
	h := newHarness(t)
	path := writePayload(t, samplePayload)
	for _, svc := range []*fakeService{prod, dev} {
		if res := h.run("publish", "--payload", path, "--rights-accepted", "--json", "--service", svc.URL()); res.Exit != 0 {
			t.Fatalf("publish to %s: %s", svc.URL(), res.Stderr)
		}
	}
	entries := h.credentials()
	if len(entries) != 2 || entries[prod.URL()]["token"] == entries[dev.URL()]["token"] {
		t.Fatalf("expected one key per origin: %v", entries)
	}
	prodKey, devKey := entries[prod.URL()]["token"], entries[dev.URL()]["token"]
	if res := h.run("me", "--json", "--service", dev.URL()); res.Exit != 0 {
		t.Fatalf("me: %s", res.Stderr)
	}
	for _, call := range prod.calls() {
		if strings.Contains(call.Auth, devKey) {
			t.Fatal("the development key was sent to the other service")
		}
	}
	for _, call := range dev.calls() {
		if strings.Contains(call.Auth, prodKey) {
			t.Fatal("the production key was sent to the development service")
		}
	}
	// Logging out of one origin leaves the other untouched.
	if res := h.run("logout", "--confirm", "--json", "--service", dev.URL()); res.Exit != 0 {
		t.Fatalf("logout: %s", res.Stderr)
	}
	entries = h.credentials()
	if len(entries) != 1 || entries[prod.URL()]["token"] != prodKey {
		t.Fatalf("logout removed another origin's key: %v", entries)
	}
}

func TestRedirectToAnotherOriginIsRefused(t *testing.T) {
	target := newFakeService(t)
	source := newFakeService(t)
	source.redirectTo = target.URL()
	h := newHarness(t)
	h.env[TokenEnv] = "3|redirectsecret000000000000000000"
	res := h.run("me", "--json", "--service", source.URL())
	if res.Exit != 2 || decodeJSON(t, res.Stderr)["code"] != "redirect_refused" {
		t.Fatalf("redirect not refused: %d %s", res.Exit, res.Stderr)
	}
	if len(target.calls()) != 0 {
		t.Fatal("the key followed a redirect to another origin")
	}
}

func TestInvalidServiceOriginsAreUsageErrors(t *testing.T) {
	h := newHarness(t)
	for _, value := range []string{"http://example.com", "ftp://soundroo.com", "https://user:pw@soundroo.com", "https://soundroo.com/api", "https://soundroo.com?x=1"} {
		res := h.run("auth", "status", "--json", "--service", value)
		if res.Exit != 1 {
			t.Fatalf("%s accepted: %d %s", value, res.Exit, res.Stderr)
		}
	}
	h.env[ServiceEnv] = "http://soundroo.com"
	if res := h.run("auth", "status"); res.Exit != 1 {
		t.Fatalf("insecure SOUNDROO_URL accepted: %d", res.Exit)
	}
	h.env[ServiceEnv] = "http://localhost:8350"
	res := h.run("auth", "status", "--json")
	if res.Exit != 0 || decodeJSON(t, res.Stdout)["service"] != "http://localhost:8350" {
		t.Fatalf("loopback http rejected: %s %s", res.Stdout, res.Stderr)
	}
}

func TestReleaseShowWaitsForRendering(t *testing.T) {
	svc := newFakeService(t)
	h := newHarness(t)
	path := writePayload(t, samplePayload)
	out := decodeJSON(t, h.run("publish", "--payload", path, "--rights-accepted", "--json", "--service", svc.URL()).Stdout)
	id := out["release"].(map[string]any)["id"].(string)
	res := h.run("release", "show", id, "--wait", "--json", "--service", svc.URL())
	if res.Exit != 0 {
		t.Fatalf("release show: %s", res.Stderr)
	}
	shown := decodeJSON(t, res.Stdout)
	if shown["release"].(map[string]any)["status"] != "ready" {
		t.Fatalf("did not wait until ready: %v", shown["release"])
	}
	if res := h.run("release", "show", "not-an-id", "--service", svc.URL()); res.Exit != 1 {
		t.Fatalf("invalid id accepted: %d", res.Exit)
	}
}

func TestLogoutLeavesOutTheClaimLinkOnceTheGuestWasKept(t *testing.T) {
	svc := newFakeService(t)
	h := newHarness(t)
	if res := h.run("publish", "--payload", writePayload(t, samplePayload), "--rights-accepted", "--service", svc.URL()); res.Exit != 0 {
		t.Fatal(res.Stderr)
	}
	svc.mu.Lock()
	for _, u := range svc.tokens {
		u.Status = "active"
	}
	svc.mu.Unlock()
	res := h.run("logout", "--confirm", "--service", svc.URL())
	if res.Exit != 0 || strings.Contains(res.Stdout, "/claim/") || !strings.Contains(res.Stdout, "already kept") {
		t.Fatalf("logout after a claim: %d\n%s%s", res.Exit, res.Stdout, res.Stderr)
	}
}

func TestDeviceLoginStoresAccountKeyAndKeepsGuestClaim(t *testing.T) {
	svc := newFakeService(t)
	svc.deviceSequence = []string{"pending", "slow_down", "rfc_pending", "ok"}
	h := newHarness(t)
	path := writePayload(t, samplePayload)
	if res := h.run("publish", "--payload", path, "--rights-accepted", "--service", svc.URL()); res.Exit != 0 {
		t.Fatalf("guest publish: %s", res.Stderr)
	}
	res := h.run("login", "--service", svc.URL())
	if res.Exit != 0 {
		t.Fatalf("login: %d %s", res.Exit, res.Stderr)
	}
	if !strings.Contains(res.Stderr, svc.URL()+"/link?code=BCDF-GHJK") || !strings.Contains(res.Stderr, "BCDF-GHJK") {
		t.Fatalf("login did not print the link and code:\n%s", res.Stderr)
	}
	if strings.Contains(res.Stdout+res.Stderr, "devicecodesecret") || strings.Contains(res.Stdout+res.Stderr, "accountsecret") {
		t.Fatal("login printed a secret")
	}
	if !strings.Contains(res.Stdout, "Logged in") || !strings.Contains(res.Stdout, "/claim/") {
		t.Fatalf("login output:\n%s", res.Stdout)
	}
	status := decodeJSON(t, h.run("auth", "status", "--json", "--service", svc.URL()).Stdout)
	key := status["key"].(map[string]any)
	if key["kind"] != "account" || key["formerGuest"] == nil || status["pendingLogin"] != nil {
		t.Fatalf("account key not stored: %v", status)
	}
	if svc.deviceCalls != 4 {
		t.Fatalf("polled %d times", svc.deviceCalls)
	}
	// Replacing an account key needs --force without a terminal.
	if res := h.run("login", "--service", svc.URL()); res.Exit != 1 || !strings.Contains(res.Stderr, "--force") {
		t.Fatalf("second login: %d %s", res.Exit, res.Stderr)
	}
}

func TestDeviceLoginStartAndWaitForAgents(t *testing.T) {
	svc := newFakeService(t)
	h := newHarness(t)
	res := h.run("login", "--start", "--json", "--service", svc.URL())
	if res.Exit != 0 {
		t.Fatalf("login --start: %s", res.Stderr)
	}
	started := decodeJSON(t, res.Stdout)
	if started["userCode"] != "BCDF-GHJK" || started["verificationUriComplete"] != svc.URL()+"/link?code=BCDF-GHJK" || strings.Contains(res.Stdout, "devicecodesecret") {
		t.Fatalf("start output: %v", started)
	}
	if svc.count("POST", "/api/v1/device/token") != 0 {
		t.Fatal("--start must not poll")
	}
	res = h.run("login", "--wait", "--json", "--service", svc.URL())
	if res.Exit != 0 || decodeJSON(t, res.Stdout)["kind"] != "account" {
		t.Fatalf("login --wait: %d %s %s", res.Exit, res.Stdout, res.Stderr)
	}
	if res := h.run("login", "--wait", "--json", "--service", svc.URL()); res.Exit != 1 || decodeJSON(t, res.Stderr)["code"] != "no_pending_login" {
		t.Fatalf("wait without a started login: %d %s", res.Exit, res.Stderr)
	}
}

func TestDeviceLoginFailures(t *testing.T) {
	svc := newFakeService(t)
	svc.noDevice = true
	h := newHarness(t)
	res := h.run("login", "--start", "--json", "--service", svc.URL())
	if res.Exit != 2 || decodeJSON(t, res.Stderr)["code"] != "device_login_unavailable" {
		t.Fatalf("unavailable: %d %s", res.Exit, res.Stderr)
	}
	if res := h.run("login", "--json", "--service", svc.URL()); res.Exit != 1 {
		t.Fatalf("login --json without --start/--wait: %d", res.Exit)
	}
	for state, want := range map[string]struct {
		exit int
		code string
	}{"denied": {4, "device_login_denied"}, "expired": {3, "device_login_expired"}, "used": {3, "device_login_expired"}} {
		svc := newFakeService(t)
		svc.deviceSequence = []string{"pending", state}
		h := newHarness(t)
		if res := h.run("login", "--start", "--service", svc.URL()); res.Exit != 0 {
			t.Fatalf("start: %s", res.Stderr)
		}
		res := h.run("login", "--wait", "--json", "--service", svc.URL())
		if res.Exit != want.exit || decodeJSON(t, res.Stderr)["code"] != want.code {
			t.Fatalf("%s: %d %s", state, res.Exit, res.Stderr)
		}
		if len(h.credentials()) != 0 {
			t.Fatalf("%s stored a key", state)
		}
	}
	// A login that is never approved stops at the device code's expiry.
	never := newFakeService(t)
	never.deviceSequence = make([]string, 1000)
	for i := range never.deviceSequence {
		never.deviceSequence[i] = "pending"
	}
	h = newHarness(t)
	res = h.run("login", "--service", never.URL())
	if res.Exit != 3 || never.deviceCalls > 125 || !strings.Contains(res.Stderr, "expired") {
		t.Fatalf("unbounded polling: exit %d after %d polls", res.Exit, never.deviceCalls)
	}
}

func TestLogoutRevokesAndNeedsConfirmation(t *testing.T) {
	svc := newFakeService(t)
	h := newHarness(t)
	path := writePayload(t, samplePayload)
	if res := h.run("publish", "--payload", path, "--rights-accepted", "--service", svc.URL()); res.Exit != 0 {
		t.Fatal(res.Stderr)
	}
	before := len(svc.calls())
	res := h.run("logout", "--json", "--service", svc.URL())
	if res.Exit != 1 || len(h.credentials()) != 1 || len(svc.calls()) != before {
		t.Fatalf("logout without confirmation acted: %d %s", res.Exit, res.Stderr)
	}
	res = h.run("logout", "--confirm", "--json", "--service", svc.URL())
	if res.Exit != 0 {
		t.Fatalf("logout: %s", res.Stderr)
	}
	out := decodeJSON(t, res.Stdout)
	if out["revoked"] != true || out["removed"] != true || out["guestClaimUrl"] == nil {
		t.Fatalf("logout result: %v", out)
	}
	if svc.count("DELETE", "/api/v1/auth/token") != 1 || len(h.credentials()) != 0 {
		t.Fatal("key not revoked and removed")
	}
	if _, err := os.Stat(filepath.Join(h.configDir(), "accounts.json")); !os.IsNotExist(err) {
		t.Fatal("accounts.json should be gone with the last account")
	}
	// A service without revocation still lets you remove the key.
	old := newFakeService(t)
	old.noRevoke = true
	if res := h.run("publish", "--payload", path, "--rights-accepted", "--service", old.URL()); res.Exit != 0 {
		t.Fatal(res.Stderr)
	}
	out = decodeJSON(t, h.run("logout", "--confirm", "--json", "--service", old.URL()).Stdout)
	if out["revocation"] != "unsupported" || out["removed"] != true {
		t.Fatalf("unsupported revocation: %v", out)
	}
}

func TestGuestKeysCannotManageMusic(t *testing.T) {
	svc := newFakeService(t)
	h := newHarness(t)
	path := writePayload(t, samplePayload)
	if res := h.run("publish", "--payload", path, "--rights-accepted", "--service", svc.URL()); res.Exit != 0 {
		t.Fatal(res.Stderr)
	}
	res := h.run("track", "update", "01JABCDEFGHJKMNPQRSTVWXYZ0", "--access", "listen-only", "--json", "--service", svc.URL())
	body := decodeJSON(t, res.Stderr)
	if res.Exit != 4 || body["code"] != "forbidden" || !strings.Contains(body["hint"].(string), "Claim your artist page") {
		t.Fatalf("guest manage: %d %v", res.Exit, body)
	}
	if res := h.run("track", "delete", "01JABCDEFGHJKMNPQRSTVWXYZ0", "--json", "--service", svc.URL()); res.Exit != 1 {
		t.Fatalf("delete without --confirm: %d", res.Exit)
	}
	if svc.count("DELETE", "/api/v1/tracks/01JABCDEFGHJKMNPQRSTVWXYZ0") != 0 {
		t.Fatal("delete reached the service without confirmation")
	}
	if res := h.run("track", "update", "01JABCDEFGHJKMNPQRSTVWXYZ0", "--access", "everyone", "--service", svc.URL()); res.Exit != 1 {
		t.Fatalf("invalid access accepted: %d", res.Exit)
	}
}

func TestAccountKeyManagesMusic(t *testing.T) {
	svc := newFakeService(t)
	svc.addToken("8|managesecret0000000000000000000", "mara", "active", "publish", "manage")
	h := newHarness(t)
	h.env[TokenEnv] = "8|managesecret0000000000000000000"
	res := h.run("track", "update", "https://x.invalid/t/01JABCDEFGHJKMNPQRSTVWXYZ0", "--access", "listen-only", "--service", svc.URL())
	if res.Exit != 1 || !strings.Contains(res.Stderr, "not on") {
		t.Fatalf("a link on another service was accepted: %d %s", res.Exit, res.Stderr)
	}
	res = h.run("track", "update", svc.URL()+"/t/01JABCDEFGHJKMNPQRSTVWXYZ0", "--access", "listen-only", "--json", "--service", svc.URL())
	if res.Exit != 0 || decodeJSON(t, res.Stdout)["access"] != "listen-only" {
		t.Fatalf("update: %d %s", res.Exit, res.Stderr)
	}
	res = h.run("track", "delete", "01JABCDEFGHJKMNPQRSTVWXYZ0", "--confirm", "--json", "--service", svc.URL())
	if res.Exit != 0 || decodeJSON(t, res.Stdout)["deleted"] != true {
		t.Fatalf("delete: %d %s", res.Exit, res.Stderr)
	}
}

func TestScoreKeepsServiceJSONExactly(t *testing.T) {
	svc := newFakeService(t)
	svc.scoreBody = `{"score":{"version":2,"id":"night-train","title":"Night Train","bpm":120,"beats":64,"master":{},"parts":[{"id":"0","instrument":"bass","tone":{},"patterns":{"0":{"beats":4,"notes":[]},"10":{"beats":4,"notes":[]}},"notes":[{"pitch":40,"beat":0,"duration":1,"velocity":0.30000000000000004}]}]},"mix":[],"engine":{"version":"0.4.0","hash":"` + strings.Repeat("e", 64) + `"},"revision":"0123456789abcdef01234567","remixOf":"01JABCDEFGHJKMNPQRSTVWXYZ0","artist":{"handle":"mara","name":"Mara","url":"u"},"license":"CC-BY-4.0"}`
	h := newHarness(t)
	res := h.run("score", "01JABCDEFGHJKMNPQRSTVWXYZ0", "--json", "--service", svc.URL())
	if res.Exit != 0 {
		t.Fatalf("score: %s", res.Stderr)
	}
	for _, fragment := range []string{`"tone": {}`, `"master": {}`, `"0": {`, `"10": {`, `0.30000000000000004`, `"mix": {}`, `"license": "CC-BY-4.0"`} {
		if !strings.Contains(res.Stdout, fragment) {
			t.Fatalf("score output lost %s:\n%s", fragment, res.Stdout)
		}
	}
	if res := h.run("score", "L1JABCDEFGHJKMNPQRSTVWXYZ0", "--json", "--service", svc.URL()); res.Exit != 5 {
		t.Fatalf("listen-only score: %d %s", res.Exit, res.Stderr)
	}
	page := h.run("score", svc.URL()+"/@mara/night-train", "--json", "--service", svc.URL())
	if page.Exit != 0 || decodeJSON(t, page.Stdout)["trackId"] != "01JABCDEFGHJKMNPQRSTVWXYZ0" {
		t.Fatalf("score by page link: %d %s", page.Exit, page.Stderr)
	}
	if res := h.run("score", svc.URL()+"/@mara/missing", "--json", "--service", svc.URL()); res.Exit != 5 {
		t.Fatalf("unknown page link: %d %s", res.Exit, res.Stderr)
	}
}

func TestMissingKeyIsAnAuthError(t *testing.T) {
	svc := newFakeService(t)
	h := newHarness(t)
	res := h.run("me", "--json", "--service", svc.URL())
	if res.Exit != 3 || decodeJSON(t, res.Stderr)["code"] != "auth_required" {
		t.Fatalf("me without a key: %d %s", res.Exit, res.Stderr)
	}
	path := writePayload(t, samplePayload)
	if res := h.run("publish", "--payload", path, "--rights-accepted", "--no-guest", "--service", svc.URL()); res.Exit != 3 {
		t.Fatalf("--no-guest without a key: %d", res.Exit)
	}
	if len(svc.calls()) != 0 {
		t.Fatal("no request should be made without a key")
	}
}

func TestCommandCatalogHelpAndManifestAgree(t *testing.T) {
	testutil.AssertConsistent(t, func() *rungrad.App { return NewApp(Options{}) })
	if err := NewApp(Options{}).ValidateCatalog(); err != nil {
		t.Fatal(err)
	}
}

func TestClaimLinkRefreshesTheGuestLink(t *testing.T) {
	svc := newFakeService(t)
	h := newHarness(t)
	if res := h.run("claim-link", "--dry-run", "--service", svc.URL()); res.Exit != 0 || len(svc.calls()) != 0 {
		t.Fatalf("dry run: %d %v", res.Exit, svc.calls())
	}
	if res := h.run("claim-link", "--service", svc.URL()); res.Exit != 3 {
		t.Fatalf("without a key: %d", res.Exit)
	}
	path := writePayload(t, samplePayload)
	if res := h.run("publish", "--payload", path, "--rights-accepted", "--service", svc.URL()); res.Exit != 0 {
		t.Fatal(res.Stderr)
	}
	res := h.run("claim-link", "--json", "--service", svc.URL())
	if res.Exit != 0 || decodeJSON(t, res.Stdout)["claimUrl"] != svc.URL()+"/claim/"+strings.Repeat("n", 64) {
		t.Fatalf("claim-link: %d %s %s", res.Exit, res.Stdout, res.Stderr)
	}
	status := decodeJSON(t, h.run("auth", "status", "--json", "--service", svc.URL()).Stdout)
	if status["key"].(map[string]any)["claimUrl"] != svc.URL()+"/claim/"+strings.Repeat("n", 64) {
		t.Fatalf("the new link was not remembered: %v", status)
	}
	svc.addToken("4|claimedsecret00000000000000000000", "mara", "active", "publish", "manage")
	h.env[TokenEnv] = "4|claimedsecret00000000000000000000"
	res = h.run("claim-link", "--json", "--service", svc.URL())
	if res.Exit != 1 || decodeJSON(t, res.Stderr)["code"] != "already_claimed" {
		t.Fatalf("claimed page: %d %s", res.Exit, res.Stderr)
	}
}

func TestClaimEmailsTheLinkThatKeepsTheGuestPage(t *testing.T) {
	svc := newFakeService(t)
	h := newHarness(t)
	if res := h.run("claim", "--email", "Mara@Example.test", "--dry-run", "--json", "--service", svc.URL()); res.Exit != 0 || len(svc.calls()) != 0 || !strings.Contains(res.Stdout, "/api/v1/claim-email") || !strings.Contains(res.Stdout, "mara@example.test") {
		t.Fatalf("dry run: %d %s %v", res.Exit, res.Stdout, svc.calls())
	}
	if res := h.run("claim", "--service", svc.URL()); res.Exit != 1 || !strings.Contains(res.Stderr, "--email") {
		t.Fatalf("without an address: %d %s", res.Exit, res.Stderr)
	}
	if res := h.run("claim", "--email", "mara@example.test", "--service", svc.URL()); res.Exit != 3 {
		t.Fatalf("without a key: %d", res.Exit)
	}
	path := writePayload(t, samplePayload)
	if res := h.run("publish", "--payload", path, "--rights-accepted", "--service", svc.URL()); res.Exit != 0 {
		t.Fatal(res.Stderr)
	}
	res := h.run("claim", "--email", "Mara@Example.test", "--json", "--service", svc.URL())
	out := decodeJSON(t, res.Stdout)
	if res.Exit != 0 || out["sent"] != true || out["email"] != "mara@example.test" || out["expiresInMinutes"] != float64(60) || out["artist"].(map[string]any)["handle"] != "amber-orchard-g1" {
		t.Fatalf("claim: %d %s %s", res.Exit, res.Stdout, res.Stderr)
	}
	calls := svc.calls()
	last := calls[len(calls)-1]
	if last.Path != "/api/v1/claim-email" || string(last.Body) != `{"email":"mara@example.test"}` || !strings.HasPrefix(last.Auth, "Bearer 1|guestsecret") {
		t.Fatalf("request: %+v", last)
	}
	human := h.run("claim", "--email", "mara@example.test", "--service", svc.URL())
	if human.Exit != 0 || !strings.Contains(human.Stdout, "Sent a link to mara@example.test") || !strings.Contains(human.Stdout, "@amber-orchard-g1") || !strings.Contains(human.Stdout, "60 minutes") {
		t.Fatalf("human output: %s", human.Stdout)
	}
	refused := h.run("claim", "--email", "temp@mailinator.com", "--json", "--service", svc.URL())
	if body := decodeJSON(t, refused.Stderr); refused.Exit != 1 || body["code"] != "validation_failed" || len(body["issues"].([]any)) == 0 {
		t.Fatalf("throwaway inbox: %d %s", refused.Exit, refused.Stderr)
	}
	svc.addToken("4|claimedsecret00000000000000000000", "mara", "active", "publish", "manage")
	h.env[TokenEnv] = "4|claimedsecret00000000000000000000"
	res = h.run("claim", "--email", "mara@example.test", "--json", "--service", svc.URL())
	if res.Exit != 1 || decodeJSON(t, res.Stderr)["code"] != "already_claimed" {
		t.Fatalf("claimed page: %d %s", res.Exit, res.Stderr)
	}
}

func TestAFullUnclaimedPageAsksForAClaimInsteadOfAnotherGuest(t *testing.T) {
	svc := newFakeService(t)
	h := newHarness(t)
	path := writePayload(t, samplePayload)
	if res := h.run("publish", "--payload", path, "--rights-accepted", "--service", svc.URL()); res.Exit != 0 {
		t.Fatal(res.Stderr)
	}
	svc.releaseError = func(_ *httpRequest, _ []byte) (int, string) {
		return 403, `{"error":{"code":"claim_required","message":"An unclaimed artist page holds up to 10 tracks, and this one has 10.","issues":[]},"message":"An unclaimed artist page holds up to 10 tracks, and this one has 10."}`
	}
	res := h.run("publish", "--payload", writePayload(t, strings.Replace(samplePayload, "night-train", "another-train", 1)), "--rights-accepted", "--json", "--service", svc.URL())
	body := decodeJSON(t, res.Stderr)
	if res.Exit != 4 || body["code"] != "claim_required" || body["service_code"] != "claim_required" || !strings.Contains(body["hint"].(string), "claim --email") {
		t.Fatalf("claim required: %d %s", res.Exit, res.Stderr)
	}
	if svc.count("POST", "/api/v1/guest-keys") != 1 {
		t.Fatal("a full guest page must never lead to another guest artist")
	}
}

func TestCollectionShowSaysWhetherTheKeyCanEdit(t *testing.T) {
	svc := newFakeService(t)
	svc.addToken("6|ownersecret0000000000000000000000", "mara", "active", "publish", "manage")
	svc.addToken("7|othersecret0000000000000000000000", "amber-orchard", "guest", "publish")
	id := "01JABCDEFGHJKMNPQRSTVWXYZ0"
	for _, tc := range []struct {
		name, token string
		canEdit     bool
	}{{"no key", "", false}, {"owner", "6|ownersecret0000000000000000000000", true}, {"another artist", "7|othersecret0000000000000000000000", false}} {
		h := newHarness(t)
		if tc.token != "" {
			h.env[TokenEnv] = tc.token
		}
		res := h.run("collection", "show", id, "--json", "--service", svc.URL())
		if res.Exit != 0 {
			t.Fatalf("%s: %d %s", tc.name, res.Exit, res.Stderr)
		}
		out := decodeJSON(t, res.Stdout)
		if canEdit, ok := out["canEdit"].(bool); !ok || canEdit != tc.canEdit || out["artist"] != "@mara" {
			t.Fatalf("%s: canEdit %v, artist %v", tc.name, out["canEdit"], out["artist"])
		}
	}
	h := newHarness(t)
	h.env[TokenEnv] = "5|unknownsecret0000000000000000000"
	if res := h.run("collection", "show", id, "--json", "--service", svc.URL()); res.Exit != 3 {
		t.Fatalf("an invalid key on a public read: %d %s", res.Exit, res.Stderr)
	}
}

func TestRejectedStoredKeyPointsToTheArtistPage(t *testing.T) {
	svc := newFakeService(t)
	h := newHarness(t)
	path := writePayload(t, samplePayload)
	if res := h.run("publish", "--payload", path, "--rights-accepted", "--service", svc.URL()); res.Exit != 0 {
		t.Fatal(res.Stderr)
	}
	svc.mu.Lock()
	for _, u := range svc.tokens {
		u.Revoked = true
	}
	svc.mu.Unlock()
	res := h.run("publish", "--payload", path, "--rights-accepted", "--json", "--service", svc.URL())
	body := decodeJSON(t, res.Stderr)
	hint, _ := body["hint"].(string)
	if res.Exit != 3 || body["code"] != "auth_invalid" || !strings.Contains(hint, "claim link") || !strings.Contains(hint, "login") {
		t.Fatalf("rejected key: %d %v", res.Exit, body)
	}
	// A new guest artist would be refused as another artist's music.
	if strings.Contains(hint, "logout") || strings.Contains(hint, "new guest") {
		t.Fatalf("the hint suggests starting over: %q", hint)
	}
	res = h.run("logout", "--confirm", "--service", svc.URL())
	if res.Exit != 0 || !strings.Contains(res.Stdout, "Save it now") || !strings.Contains(res.Stdout, "/claim/") {
		t.Fatalf("logout must repeat the guest's claim link with a reason to save it: %d\n%s%s", res.Exit, res.Stdout, res.Stderr)
	}
}
