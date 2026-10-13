package commands

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/vincentsch/soundroo/cloud-cli/internal/cloud"
)

// Limits the service enforces; checking them first gives faster, clearer
// errors. The service remains the authority.
const (
	maxPayloadBytes = 32 << 20
	maxScoreBytes   = 1_000_000
	maxTracks       = 30
)

var (
	localIDPattern     = regexp.MustCompile(`^[a-zA-Z0-9._-]{1,100}$`)
	revisionPattern    = regexp.MustCompile(`^[a-f0-9]{24}$`)
	engineHashPattern  = regexp.MustCompile(`^[a-f0-9]{64}$`)
	idempotencyPattern = regexp.MustCompile(`^[a-zA-Z0-9._:-]{8,128}$`)
	visibilities       = map[string]bool{"public": true, "unlisted": true, "private": true}
	accesses           = map[string]bool{"open": true, "listen-only": true}
)

// Payload is what publish learned from a release file. The file bytes are sent
// unchanged: this tool never re-encodes scores, so {} stays {}, [] stays [] and
// numbers and map keys reach the service exactly as the toolkit wrote them.
type Payload struct {
	Raw            []byte
	SHA256         string
	LibraryUID     string
	Title          string
	Visibility     string
	RightsAccepted bool
	EngineVersion  string
	EngineHash     string
	Tracks         []PayloadTrack
}

// PayloadTrack summarizes one track entry.
type PayloadTrack struct {
	LocalID        string
	ClientRevision string
	Visibility     string
	Access         string
	RemixOf        string
	ScoreBytes     int
}

func payloadError(issues []cloud.Issue) error {
	return &cloud.Error{Code: "invalid_payload", Exit: cloud.ExitUsage, Message: "The release file is not a valid Soundroo release.", Issues: issues}
}

func objectOf(raw json.RawMessage) (map[string]json.RawMessage, bool) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return nil, false
	}
	var out map[string]json.RawMessage
	if json.Unmarshal(trimmed, &out) != nil {
		return nil, false
	}
	return out, true
}

func stringOf(raw json.RawMessage) (string, bool) {
	var s string
	if json.Unmarshal(raw, &s) != nil {
		return "", false
	}
	return s, true
}

func isNull(raw json.RawMessage) bool {
	return string(bytes.TrimSpace(raw)) == "null"
}

func onlyKeys(obj map[string]json.RawMessage, path string, allowed ...string) []cloud.Issue {
	ok := map[string]bool{}
	for _, key := range allowed {
		ok[key] = true
	}
	var issues []cloud.Issue
	keys := make([]string, 0, len(obj))
	for key := range obj {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if !ok[key] {
			issues = append(issues, cloud.Issue{Path: strings.TrimPrefix(path+"."+key, "."), Message: "Unknown field."})
		}
	}
	return issues
}

// ParsePayload validates a release file without changing it.
func ParsePayload(raw []byte) (Payload, error) {
	p := Payload{Raw: raw}
	if len(raw) > maxPayloadBytes {
		return p, payloadError([]cloud.Issue{{Message: "The release file is larger than 32 MB."}})
	}
	sum := sha256.Sum256(raw)
	p.SHA256 = hex.EncodeToString(sum[:])
	dec := json.NewDecoder(bytes.NewReader(raw))
	var top json.RawMessage
	if err := dec.Decode(&top); err != nil {
		return p, payloadError([]cloud.Issue{{Message: "The release file is not JSON: " + err.Error()}})
	}
	if dec.More() {
		return p, payloadError([]cloud.Issue{{Message: "The release file contains more than one JSON value."}})
	}
	root, ok := objectOf(top)
	if !ok {
		return p, payloadError([]cloud.Issue{{Message: "The release must be a JSON object."}})
	}
	issues := onlyKeys(root, "", "libraryUid", "collection", "tracks", "engine", "rightsAccepted", "client")
	if uid, ok := stringOf(root["libraryUid"]); !ok || !localIDPattern.MatchString(uid) {
		issues = append(issues, cloud.Issue{Path: "libraryUid", Message: "Use 1 to 100 letters, digits, dots, underscores or hyphens."})
	} else {
		p.LibraryUID = uid
	}
	if collection, ok := objectOf(root["collection"]); !ok {
		issues = append(issues, cloud.Issue{Path: "collection", Message: "Expected an object with the collection title."})
	} else {
		issues = append(issues, onlyKeys(collection, "collection", "title", "description", "brief", "visibility", "artwork")...)
		title, ok := stringOf(collection["title"])
		if !ok || strings.TrimSpace(title) == "" || len([]rune(title)) > 180 {
			issues = append(issues, cloud.Issue{Path: "collection.title", Message: "Give the collection a title of up to 180 characters."})
		}
		p.Title = title
		for _, field := range []string{"description", "brief"} {
			if value, present := collection[field]; present && !isNull(value) {
				if text, ok := stringOf(value); !ok || len([]rune(text)) > 4000 {
					issues = append(issues, cloud.Issue{Path: "collection." + field, Message: "Expected text of up to 4,000 characters."})
				}
			}
		}
		if value, present := collection["visibility"]; present {
			v, ok := stringOf(value)
			if !ok || !visibilities[v] {
				issues = append(issues, cloud.Issue{Path: "collection.visibility", Message: "Use public, unlisted or private."})
			}
			p.Visibility = v
		}
	}
	var tracks []json.RawMessage
	if json.Unmarshal(root["tracks"], &tracks) != nil || len(tracks) == 0 || len(tracks) > maxTracks {
		issues = append(issues, cloud.Issue{Path: "tracks", Message: fmt.Sprintf("Publish 1 to %d tracks.", maxTracks)})
	}
	seen := map[string]bool{}
	for i, rawTrack := range tracks {
		path := fmt.Sprintf("tracks.%d", i)
		track, ok := objectOf(rawTrack)
		if !ok {
			issues = append(issues, cloud.Issue{Path: path, Message: "Expected a track object."})
			continue
		}
		issues = append(issues, onlyKeys(track, path, "localId", "score", "mix", "visibility", "access", "remixOf", "clientRevision", "position")...)
		var t PayloadTrack
		if id, ok := stringOf(track["localId"]); !ok || !localIDPattern.MatchString(id) {
			issues = append(issues, cloud.Issue{Path: path + ".localId", Message: "Use the track's id from the library."})
		} else if seen[id] {
			issues = append(issues, cloud.Issue{Path: path + ".localId", Message: "Each track may appear once."})
		} else {
			seen[id] = true
			t.LocalID = id
		}
		if _, ok := objectOf(track["score"]); !ok {
			issues = append(issues, cloud.Issue{Path: path + ".score", Message: "Expected the score object."})
		} else {
			var compact bytes.Buffer
			if json.Compact(&compact, track["score"]) == nil {
				t.ScoreBytes = compact.Len()
			}
			if t.ScoreBytes > maxScoreBytes {
				issues = append(issues, cloud.Issue{Path: path + ".score", Message: "The score is larger than 1 MB. Use patterns and clips to describe repeated music."})
			}
		}
		if value, present := track["mix"]; present {
			if _, ok := objectOf(value); !ok {
				issues = append(issues, cloud.Issue{Path: path + ".mix", Message: "Expected the mix object; an empty mix is {}."})
			}
		}
		if value, present := track["visibility"]; present {
			v, ok := stringOf(value)
			if !ok || !visibilities[v] {
				issues = append(issues, cloud.Issue{Path: path + ".visibility", Message: "Use public, unlisted or private."})
			}
			t.Visibility = v
		}
		if value, present := track["access"]; present {
			v, ok := stringOf(value)
			if !ok || !accesses[v] {
				issues = append(issues, cloud.Issue{Path: path + ".access", Message: "Use open or listen-only."})
			}
			t.Access = v
		}
		if value, present := track["remixOf"]; present && !isNull(value) {
			v, ok := stringOf(value)
			if !ok || !cloud.PublicID.MatchString(v) {
				issues = append(issues, cloud.Issue{Path: path + ".remixOf", Message: "Use the original track's 26-character id."})
			}
			t.RemixOf = v
		}
		if value, present := track["clientRevision"]; present && !isNull(value) {
			v, ok := stringOf(value)
			if !ok || !revisionPattern.MatchString(v) {
				issues = append(issues, cloud.Issue{Path: path + ".clientRevision", Message: "Use the 24-character revision of the local render."})
			}
			t.ClientRevision = v
		}
		if value, present := track["position"]; present {
			var n int
			if json.Unmarshal(value, &n) != nil || n < 0 || n > 10000 {
				issues = append(issues, cloud.Issue{Path: path + ".position", Message: "Use a whole number from 0 to 10,000."})
			}
		}
		p.Tracks = append(p.Tracks, t)
	}
	if engine, ok := objectOf(root["engine"]); !ok {
		issues = append(issues, cloud.Issue{Path: "engine", Message: "Expected {version, hash} from the toolkit."})
	} else {
		issues = append(issues, onlyKeys(engine, "engine", "version", "hash")...)
		if v, ok := stringOf(engine["version"]); !ok || v == "" || len(v) > 30 {
			issues = append(issues, cloud.Issue{Path: "engine.version", Message: "Expected the toolkit engine version."})
		} else {
			p.EngineVersion = v
		}
		if h, ok := stringOf(engine["hash"]); !ok || !engineHashPattern.MatchString(h) {
			issues = append(issues, cloud.Issue{Path: "engine.hash", Message: "Expected the 64-character engine hash."})
		} else {
			p.EngineHash = h
		}
	}
	if value, present := root["rightsAccepted"]; present {
		if json.Unmarshal(value, &p.RightsAccepted) != nil {
			issues = append(issues, cloud.Issue{Path: "rightsAccepted", Message: "Expected true or false."})
		}
	}
	if value, present := root["client"]; present {
		if client, ok := objectOf(value); !ok {
			issues = append(issues, cloud.Issue{Path: "client", Message: "Expected {name, version}."})
		} else {
			issues = append(issues, onlyKeys(client, "client", "name", "version")...)
		}
	}
	if len(issues) > 0 {
		return p, payloadError(issues)
	}
	return p, nil
}

// DefaultIdempotencyKey derives a key from the release bytes. The toolkit
// passes its own persisted key so a retry after a lost answer reuses it.
func DefaultIdempotencyKey(sha string) string {
	return "sr1-" + sha[:40]
}
