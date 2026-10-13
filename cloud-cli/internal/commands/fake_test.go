package commands

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
)

type httpRequest = http.Request

// fakeService answers like the Laravel application: the same routes, resource
// shapes, {"data": ...} wrapping for single resources, {"message", "errors"}
// validation bodies and Sanctum bearer abilities.
type fakeService struct {
	t   *testing.T
	srv *httptest.Server
	mu  sync.Mutex

	requests []recorded
	tokens   map[string]*fakeUser
	releases map[string]*fakeRelease
	keys     map[string]string // idempotency key -> release id
	guests   int

	// knobs
	releaseError   func(r *http.Request, body []byte) (int, string)
	deviceSequence []string // per /device/token call: pending, slow_down, denied, expired, ok
	deviceCalls    int
	noDevice       bool
	noRevoke       bool
	scoreBody      string
	redirectTo     string
	echoToken      bool
}

type fakeUser struct {
	Handle    string
	Status    string // guest|active
	Abilities []string
	Revoked   bool
}

type fakeRelease struct {
	ID       string
	Owner    string
	Hash     string
	Title    string
	LocalIDs []string
	Polls    int
}

type recorded struct {
	Method      string
	Path        string
	Auth        string
	Idempotency string
	Body        []byte
}

func newFakeService(t *testing.T) *fakeService {
	f := &fakeService{t: t, tokens: map[string]*fakeUser{}, releases: map[string]*fakeRelease{}, keys: map[string]string{}}
	f.srv = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeService) URL() string { return f.srv.URL }

func (f *fakeService) addToken(token, handle, status string, abilities ...string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.tokens[token] = &fakeUser{Handle: handle, Status: status, Abilities: abilities}
}

func (f *fakeService) calls() []recorded {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]recorded(nil), f.requests...)
}

func (f *fakeService) count(method, path string) int {
	n := 0
	for _, r := range f.calls() {
		if r.Method == method && r.Path == path {
			n++
		}
	}
	return n
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func message(w http.ResponseWriter, status int, text string) {
	writeJSON(w, status, map[string]string{"message": text})
}

func fakeID(prefix string, n int) string {
	clean := strings.ToUpper(regexp.MustCompile(`[^0-9A-Za-z]`).ReplaceAllString(prefix, ""))
	if len(clean) > 12 {
		clean = clean[:12]
	}
	return fmt.Sprintf("%s%0*d", clean, 26-len(clean), n)
}

func (f *fakeService) user(r *http.Request) (*fakeUser, string) {
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return nil, ""
	}
	token := strings.TrimPrefix(auth, "Bearer ")
	u := f.tokens[token]
	if u == nil || u.Revoked {
		return nil, token
	}
	return u, token
}

func (u *fakeUser) can(ability string) bool {
	for _, a := range u.Abilities {
		if a == ability {
			return true
		}
	}
	return false
}

func (f *fakeService) artist(handle, status string) map[string]any {
	return map[string]any{"id": fakeID("A"+handle, 1), "handle": handle, "name": strings.Title(strings.ReplaceAll(handle, "-", " ")), "bio": nil, "website": nil, "avatarUrl": f.URL() + "/artists/" + handle + "/avatar", "url": f.URL() + "/@" + handle, "isOfficial": false, "followersCount": 0, "tracksCount": 0, "status": status}
}

func (f *fakeService) releaseResource(rel *fakeRelease, status string) map[string]any {
	items := []map[string]any{}
	tracks := []map[string]any{}
	for i, local := range rel.LocalIDs {
		id := fakeID("T"+rel.ID[:3], i+1)
		itemStatus := status
		if status == "rendering" && i < rel.Polls {
			itemStatus = "ready"
		}
		items = append(items, map[string]any{"trackId": id, "versionId": i + 10, "status": itemStatus, "revision": strings.Repeat("a", 24), "error": nil})
		tracks = append(tracks, map[string]any{"id": id, "localId": local, "title": strings.Title(strings.ReplaceAll(local, "-", " ")), "status": itemStatus, "visibility": "unlisted", "access": "open", "position": i, "url": f.URL() + "/@" + rel.Owner + "/" + local, "shortUrl": f.URL() + "/t/" + id, "artist": f.artist(rel.Owner, "guest"), "collection": map[string]any{"id": fakeID("C"+rel.ID[:3], 1), "title": rel.Title, "url": f.URL() + "/@" + rel.Owner + "/collections/x"}})
	}
	collection := map[string]any{"id": fakeID("C"+rel.ID[:3], 1), "title": rel.Title, "description": "", "brief": nil, "visibility": "unlisted", "artist": f.artist(rel.Owner, "guest"), "url": f.URL() + "/@" + rel.Owner + "/collections/x", "shortUrl": f.URL() + "/c/" + fakeID("C"+rel.ID[:3], 1), "coverUrl": nil, "tracksCount": len(tracks), "duration": 0, "featured": false, "canEdit": true, "tracks": tracks}
	return map[string]any{"id": rel.ID, "status": status, "items": items, "statusUrl": f.URL() + "/api/v1/releases/" + rel.ID, "collection": collection}
}

func (f *fakeService) serve(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	f.mu.Lock()
	f.requests = append(f.requests, recorded{Method: r.Method, Path: r.URL.Path, Auth: r.Header.Get("Authorization"), Idempotency: r.Header.Get("Idempotency-Key"), Body: body})
	f.mu.Unlock()
	if f.redirectTo != "" {
		http.Redirect(w, r, f.redirectTo+r.URL.Path, http.StatusFound)
		return
	}
	if r.Header.Get("Accept") != "application/json" {
		message(w, 500, "Route [login] not defined.")
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	path := strings.TrimPrefix(r.URL.Path, "/api/v1")
	switch {
	case r.Method == "GET" && path == "/meta":
		writeJSON(w, 200, map[string]any{"app": "Soundroo", "latestEngine": "0.4.0", "engines": []map[string]any{{"version": "0.4.0", "hash": strings.Repeat("e", 64), "scoreVersions": []int{1, 2}}}, "limits": map[string]any{"tracksPerRelease": 30, "minSeconds": 20, "maxSeconds": 600}})
	case r.Method == "POST" && path == "/guest-keys":
		f.guests++
		port := f.URL()[strings.LastIndex(f.URL(), ":")+1:]
		token := fmt.Sprintf("%d|guestsecret%s%026d", f.guests, port, f.guests)
		handle := fmt.Sprintf("amber-orchard-g%d", f.guests)
		var req map[string]string
		_ = json.Unmarshal(body, &req)
		f.tokens[token] = &fakeUser{Handle: handle, Status: "guest", Abilities: []string{"publish"}}
		writeJSON(w, 201, map[string]any{"token": token, "artist": f.artist(handle, "guest"), "claimUrl": f.URL() + "/claim/" + strings.Repeat("c", 60) + fmt.Sprint(f.guests)})
	case path == "/device/code" && r.Method == "POST":
		if f.noDevice {
			message(w, 404, "The route api/v1/device/code could not be found.")
			return
		}
		writeJSON(w, 201, map[string]any{"deviceCode": "devicecodesecret-0001", "userCode": "BCDF-GHJK", "verificationUri": f.URL() + "/link", "verificationUriComplete": f.URL() + "/link?code=BCDF-GHJK", "expiresIn": 600, "interval": 5})
	case path == "/device/token" && r.Method == "POST":
		var poll map[string]string
		if json.Unmarshal(body, &poll) != nil || poll["deviceCode"] != "devicecodesecret-0001" {
			writeJSON(w, 422, map[string]any{"message": "The device code field is required.", "errors": map[string][]string{"deviceCode": {"The device code field is required."}}})
			return
		}
		state := "ok"
		if f.deviceCalls < len(f.deviceSequence) {
			state = f.deviceSequence[f.deviceCalls]
		}
		f.deviceCalls++
		deviceError := func(code, message string) {
			writeJSON(w, 400, map[string]any{"error": map[string]any{"code": code, "message": message, "issues": []any{}}})
		}
		switch state {
		case "pending":
			deviceError("authorization_pending", "Approve this device at "+f.URL()+"/link with code BCDF-GHJK.")
		case "slow_down":
			deviceError("slow_down", "Poll every 5 seconds.")
		case "denied":
			deviceError("access_denied", "The connection was declined on soundroo.com.")
		case "expired":
			deviceError("expired_token", "This code expired. Run soundroo login again.")
		case "rfc_pending":
			writeJSON(w, 400, map[string]string{"error": "authorization_pending"})
		case "used":
			deviceError("invalid_grant", "This device code is unknown or was already used. Run soundroo login again.")
		default:
			token := "9|accountsecret0000000000000000000001"
			f.tokens[token] = &fakeUser{Handle: "mara", Status: "active", Abilities: []string{"publish", "manage"}}
			writeJSON(w, 200, map[string]any{"token": token, "tokenType": "Bearer", "abilities": []string{"publish", "manage"}, "artist": f.artist("mara", "active")})
		}
	default:
		f.authed(w, r, path, body)
	}
}

func (f *fakeService) authed(w http.ResponseWriter, r *http.Request, path string, body []byte) {
	if r.Method == "GET" {
		if m := regexp.MustCompile(`^/tracks/([0-9A-Z]{26})/score$`).FindStringSubmatch(path); m != nil {
			if f.scoreBody == "" || strings.HasPrefix(m[1], "L") {
				message(w, 404, "Not Found")
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, f.scoreBody)
			return
		}
		if m := regexp.MustCompile(`^/tracks/([0-9A-Z]{26})$`).FindStringSubmatch(path); m != nil {
			if strings.HasPrefix(m[1], "GHOST") {
				message(w, 404, "No query results for model [App\\Models\\Track].")
				return
			}
			if strings.HasPrefix(m[1], "BROKEN") {
				message(w, 500, "Server Error")
				return
			}
			if strings.HasPrefix(m[1], "FORBIDDEN") {
				message(w, 403, "This action is unauthorized.")
				return
			}
			if strings.HasPrefix(m[1], "THROTTLED") {
				w.Header().Set("Retry-After", "60")
				message(w, 429, "Too Many Attempts.")
				return
			}
			writeJSON(w, 200, map[string]any{"data": map[string]any{"id": m[1], "localId": "night-train", "title": "Night Train", "status": "ready", "visibility": "public", "access": "open", "url": f.URL() + "/@mara/night-train", "shortUrl": f.URL() + "/t/" + m[1], "artist": f.artist("mara", "active"), "revision": nil}})
			return
		}
		if m := regexp.MustCompile(`^/collections/([0-9A-Z]{26})$`).FindStringSubmatch(path); m != nil {
			// A public read: a sent key must be valid, and canEdit says
			// whether its account owns the collection (mara does).
			viewer, token := f.user(r)
			if token != "" && viewer == nil {
				message(w, 401, "Your API key is invalid or expired.")
				return
			}
			canEdit := viewer != nil && viewer.Handle == "mara"
			writeJSON(w, 200, map[string]any{"data": map[string]any{"id": m[1], "title": "Night Trains", "description": "", "visibility": "unlisted", "url": f.URL() + "/@mara/collections/night-trains", "shortUrl": f.URL() + "/c/" + m[1], "artist": f.artist("mara", "active"), "tracksCount": 1, "canEdit": canEdit, "tracks": []any{map[string]any{"id": fakeID("T", 1), "localId": "night-train", "title": "Night Train", "status": "ready", "visibility": "unlisted", "access": "listen-only", "url": "u", "shortUrl": "s"}}}})
			return
		}
	}
	u, token := f.user(r)
	if u == nil {
		message(w, 401, "Unauthenticated.")
		return
	}
	switch {
	case r.Method == "DELETE" && path == "/auth/token":
		if f.noRevoke {
			message(w, 404, "The route api/v1/auth/token could not be found.")
			return
		}
		u.Revoked = true
		writeJSON(w, 200, map[string]bool{"revoked": true})
	case r.Method == "POST" && path == "/claim-links":
		if u.Status != "guest" {
			writeJSON(w, 409, map[string]any{"error": map[string]any{"code": "already_claimed", "message": "This artist page is already claimed.", "issues": []any{}}})
			return
		}
		writeJSON(w, 201, map[string]any{"claimUrl": f.URL() + "/claim/" + strings.Repeat("n", 64), "expiresAt": "2026-11-12T12:00:00+00:00"})
	case r.Method == "GET" && path == "/me":
		if !u.can("publish") {
			message(w, 403, "This key does not have permission for that action.")
			return
		}
		writeJSON(w, 200, map[string]any{"artist": f.artist(u.Handle, u.Status), "collections": []any{}})
	case r.Method == "POST" && path == "/releases":
		f.publish(w, r, u, token, body)
	case r.Method == "GET" && strings.HasPrefix(path, "/releases/"):
		rel := f.releases[strings.TrimPrefix(path, "/releases/")]
		if rel == nil || rel.Owner != u.Handle {
			message(w, 404, "Not Found")
			return
		}
		rel.Polls++
		status := "rendering"
		if rel.Polls >= len(rel.LocalIDs) {
			status = "ready"
		}
		writeJSON(w, 200, f.releaseResource(rel, status))
	case r.Method == "PATCH" && strings.HasPrefix(path, "/tracks/"):
		if !u.can("manage") {
			message(w, 403, "This key does not have permission for that action.")
			return
		}
		var patch map[string]string
		_ = json.Unmarshal(body, &patch)
		writeJSON(w, 200, map[string]any{"data": map[string]any{"id": strings.TrimPrefix(path, "/tracks/"), "title": "Night Train", "status": "ready", "visibility": patch["visibility"], "access": patch["access"], "url": "u", "shortUrl": "s"}})
	case r.Method == "DELETE" && strings.HasPrefix(path, "/tracks/"):
		if !u.can("manage") {
			message(w, 403, "This key does not have permission for that action.")
			return
		}
		writeJSON(w, 200, map[string]bool{"deleted": true})
	default:
		message(w, 404, "The route "+r.URL.Path+" could not be found.")
	}
}

func (f *fakeService) publish(w http.ResponseWriter, r *http.Request, u *fakeUser, token string, body []byte) {
	if !u.can("publish") {
		message(w, 403, "This key does not have permission for that action.")
		return
	}
	if f.releaseError != nil {
		if status, text := f.releaseError(r, body); status != 0 {
			if f.echoToken {
				text = strings.ReplaceAll(text, "TOKEN", token)
			}
			w.Header().Set("Content-Type", "application/json")
			if status == 429 {
				w.Header().Set("Retry-After", "120")
			}
			w.WriteHeader(status)
			_, _ = io.WriteString(w, text)
			return
		}
	}
	key := r.Header.Get("Idempotency-Key")
	if !regexp.MustCompile(`^[a-zA-Z0-9._:-]{8,128}$`).MatchString(key) {
		writeJSON(w, 422, map[string]any{"message": "Send an Idempotency-Key header.", "errors": map[string][]string{"idempotencyKey": {"Send an Idempotency-Key header with 8 to 128 letters, numbers or . _ : - characters."}}})
		return
	}
	var payload struct {
		LibraryUID     string `json:"libraryUid"`
		RightsAccepted bool   `json:"rightsAccepted"`
		Collection     struct {
			Title string `json:"title"`
		} `json:"collection"`
		Tracks []struct {
			LocalID string `json:"localId"`
		} `json:"tracks"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || !payload.RightsAccepted {
		writeJSON(w, 422, map[string]any{"message": "The rights accepted field must be accepted.", "errors": map[string][]string{"rightsAccepted": {"The rights accepted field must be accepted."}}})
		return
	}
	sum := sha256.Sum256(body)
	hash := hex.EncodeToString(sum[:])
	if id, ok := f.keys[u.Handle+"|"+key]; ok {
		rel := f.releases[id]
		if rel.Hash != hash {
			message(w, 409, "This idempotency key was used for different music. Use a new key.")
			return
		}
		res := f.releaseResource(rel, "queued")
		if u.Status == "guest" {
			res["claimUrl"] = f.URL() + "/claim/replayclaim" + strings.Repeat("r", 50)
		}
		writeJSON(w, 200, res)
		return
	}
	rel := &fakeRelease{ID: fakeID("R", len(f.releases)+1), Owner: u.Handle, Hash: hash, Title: payload.Collection.Title}
	for _, t := range payload.Tracks {
		rel.LocalIDs = append(rel.LocalIDs, t.LocalID)
	}
	f.releases[rel.ID] = rel
	f.keys[u.Handle+"|"+key] = rel.ID
	res := f.releaseResource(rel, "queued")
	if u.Status == "guest" {
		res["claimUrl"] = f.URL() + "/claim/fresh" + strings.Repeat("f", 55)
	} else {
		res["claimUrl"] = nil
	}
	writeJSON(w, 202, res)
}
