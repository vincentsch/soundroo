package cloud

import (
	"encoding/json"
	"regexp"
)

// PublicID matches the service's opaque public ids (ULIDs).
var PublicID = regexp.MustCompile(`^[0-9A-Za-z]{26}$`)

// Artist is the public artist resource.
type Artist struct {
	ID         string `json:"id"`
	Handle     string `json:"handle"`
	Name       string `json:"name"`
	URL        string `json:"url"`
	IsOfficial bool   `json:"isOfficial,omitempty"`
}

// TrackRef is a track as collection and release responses describe it.
type TrackRef struct {
	ID            string      `json:"id"`
	LocalID       string      `json:"localId"`
	Title         string      `json:"title"`
	Status        string      `json:"status"`
	Visibility    string      `json:"visibility"`
	Access        string      `json:"access"`
	Position      json.Number `json:"position,omitempty"`
	Duration      json.Number `json:"duration,omitempty"`
	URL           string      `json:"url"`
	ShortURL      string      `json:"shortUrl"`
	EngineVersion string      `json:"engineVersion,omitempty"`
	Revision      string      `json:"revision,omitempty"`
	Artist        *Artist     `json:"artist,omitempty"`
	Collection    *struct {
		ID    string `json:"id"`
		Title string `json:"title"`
		URL   string `json:"url"`
	} `json:"collection,omitempty"`
	RemixOf *struct {
		ID    string `json:"id"`
		Title string `json:"title"`
		URL   string `json:"url"`
	} `json:"remixOf,omitempty"`
}

// Collection is the collection resource, with tracks in detail views.
type Collection struct {
	ID          string      `json:"id"`
	Title       string      `json:"title"`
	Description string      `json:"description"`
	Visibility  string      `json:"visibility"`
	URL         string      `json:"url"`
	ShortURL    string      `json:"shortUrl"`
	TracksCount int         `json:"tracksCount"`
	Duration    json.Number `json:"duration,omitempty"`
	Artist      *Artist     `json:"artist,omitempty"`
	CanEdit     bool        `json:"canEdit,omitempty"`
	Tracks      []TrackRef  `json:"tracks"`
}

// ReleaseItem is one track's state inside a release.
type ReleaseItem struct {
	TrackID   string      `json:"trackId"`
	VersionID json.Number `json:"versionId,omitempty"`
	Status    string      `json:"status"`
	Revision  string      `json:"revision"`
	Error     *string     `json:"error"`
}

// Release is one publish request and its rendering progress.
type Release struct {
	ID         string        `json:"id"`
	Status     string        `json:"status"`
	Items      []ReleaseItem `json:"items"`
	StatusURL  string        `json:"statusUrl"`
	Collection Collection    `json:"collection"`
	ClaimURL   string        `json:"claimUrl"`
}

// Done reports whether rendering has finished, successfully or not.
func (r Release) Done() bool { return r.Status == "ready" || r.Status == "failed" }

// GuestKey is the answer to POST /guest-keys.
type GuestKey struct {
	Token    string `json:"token"`
	Artist   Artist `json:"artist"`
	ClaimURL string `json:"claimUrl"`
}

// Me is the answer to GET /me.
type Me struct {
	Artist      Artist       `json:"artist"`
	Collections []Collection `json:"collections"`
}

// Score is the answer to GET /tracks/{id}/score, kept as raw JSON so imports
// receive the exact score and mix the service stored.
type Score struct {
	Score    json.RawMessage `json:"score"`
	Mix      json.RawMessage `json:"mix"`
	Engine   json.RawMessage `json:"engine"`
	Revision string          `json:"revision"`
	RemixOf  string          `json:"remixOf"`
	Artist   json.RawMessage `json:"artist"`
	License  string          `json:"license"`
}
