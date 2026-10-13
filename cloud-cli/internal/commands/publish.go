package commands

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"
	rungrad "github.com/vincentsch/rungrad"
	"github.com/vincentsch/rungrad/output"
	"github.com/vincentsch/soundroo/cloud-cli/internal/cloud"
	"github.com/vincentsch/soundroo/cloud-cli/internal/store"
)

type publishModule struct{ e *env }

func (publishModule) Groups() []rungrad.Group {
	return []rungrad.Group{{ID: "share", Title: "Sharing"}}
}

var (
	publishSpec = rungrad.CommandSpec{
		Path:    "publish",
		Summary: "Publish a prepared release to the Soundroo service",
		GroupID: "share",
		OutputModes: []string{
			rungrad.OutputModeHuman, rungrad.OutputModeJSON,
		},
		Examples: []string{
			"soundroo-cloud publish --payload release.json --rights-accepted --dry-run",
			"soundroo-cloud publish --payload release.json --rights-accepted",
			"soundroo-cloud publish --payload - --rights-accepted --idempotency-key sr1-example-key --json < release.json",
		},
		Related:      []string{"soundroo-cloud release show", "soundroo-cloud auth status"},
		RequiresAuth: true,
		Mutates:      true,
	}
	releaseSpec = rungrad.CommandSpec{
		Path:     "release",
		Summary:  "Follow a publish while the service renders it",
		GroupID:  "share",
		Examples: []string{"soundroo-cloud release show 01JABCDEFGHJKMNPQRSTVWXYZ0", "soundroo-cloud release show 01JABCDEFGHJKMNPQRSTVWXYZ0 --wait --json"},
		Related:  []string{"soundroo-cloud publish"},
	}
	releaseShowSpec = rungrad.CommandSpec{
		Path:         "release show",
		Summary:      "Show a release's status and links",
		OutputModes:  []string{rungrad.OutputModeHuman, rungrad.OutputModeJSON},
		Examples:     []string{"soundroo-cloud release show 01JABCDEFGHJKMNPQRSTVWXYZ0", "soundroo-cloud release show 01JABCDEFGHJKMNPQRSTVWXYZ0 --wait --json"},
		Related:      []string{"soundroo-cloud publish"},
		RequiresAuth: true,
	}
)

func (publishModule) Catalog() []rungrad.CommandSpec {
	return []rungrad.CommandSpec{publishSpec, releaseSpec, releaseShowSpec}
}

func (m publishModule) Commands() []*rungrad.Command {
	release := &rungrad.Command{
		Use:      "release",
		Short:    releaseSpec.Summary,
		Examples: releaseSpec.Examples,
		Related:  releaseSpec.Related,
		GroupID:  "share",
	}
	release.AddCommand(m.releaseShow())
	return []*rungrad.Command{m.publish(), release}
}

func (m publishModule) publish() *rungrad.Command {
	return &rungrad.Command{
		Use:   "publish",
		Short: publishSpec.Summary,
		Long: `Publish a release file prepared by the Soundroo toolkit (node bin/soundroo.js share).
The file holds scores, mixes and collection settings, never audio. The service
renders the music with the engine the file names and returns working links.

Without a stored key, publish first creates a guest artist and stores its
publish-only key for this service. The answer includes a claim link: open it to
sign in and keep the music. Keep the claim link private.

Real publishing requires --rights-accepted: you confirm you have the right to
share the music. The service checks that the scores render with an official
engine; it cannot tell whether a person or a model wrote them.

The release bytes are sent unchanged. --dry-run validates and previews without
contacting the service or writing any configuration.`,
		Examples:       publishSpec.Examples,
		Related:        publishSpec.Related,
		OutputModes:    publishSpec.OutputModes,
		GroupID:        "share",
		Mutates:        true,
		RequiresAuth:   true,
		AuthResolution: rungrad.AuthResolutionHandler,
		Configure: func(cmd *cobra.Command) {
			cmd.Flags().String("payload", "", "Release file prepared by the toolkit, or - for standard input")
			cmd.Flags().Bool("rights-accepted", false, "Confirm you have the right to share this music")
			cmd.Flags().String("idempotency-key", "", "Key that makes a repeated request safe (default: derived from the release)")
			cmd.Flags().String("artist", "", "Name for a new guest artist")
			cmd.Flags().Bool("no-guest", false, "Fail instead of creating a guest artist when no key is stored")
			cmd.Flags().Bool("wait", false, "Wait until the service finishes rendering")
			cmd.Flags().Duration("timeout", 15*time.Minute, "Longest time to wait with --wait")
			_ = cmd.MarkFlagRequired("payload")
		},
		Run: m.runPublish,
	}
}

func readPayload(path string, stdin io.Reader) ([]byte, error) {
	var reader io.Reader
	if path == "-" {
		reader = stdin
	} else {
		file, err := os.Open(path)
		if err != nil {
			return nil, &cloud.Error{Code: "payload_unreadable", Exit: cloud.ExitUsage, Message: "Could not read the release file: " + err.Error()}
		}
		defer file.Close()
		reader = file
	}
	data, err := io.ReadAll(io.LimitReader(reader, maxPayloadBytes+1))
	if err != nil {
		return nil, &cloud.Error{Code: "payload_unreadable", Exit: cloud.ExitUsage, Message: "Could not read the release: " + err.Error()}
	}
	return data, nil
}

func (m publishModule) runPublish(f *rungrad.Factory, cmd *cobra.Command, _ []string) error {
	o, err := origin(f)
	if err != nil {
		return err
	}
	path, _ := cmd.Flags().GetString("payload")
	raw, err := readPayload(path, f.Stdin)
	if err != nil {
		return err
	}
	payload, err := ParsePayload(raw)
	if err != nil {
		return err
	}
	key, _ := cmd.Flags().GetString("idempotency-key")
	if key == "" {
		key = DefaultIdempotencyKey(payload.SHA256)
	} else if !idempotencyPattern.MatchString(key) {
		return &cloud.Error{Code: "invalid_idempotency_key", Exit: cloud.ExitUsage, Message: "Use 8 to 128 letters, digits or . _ : - for --idempotency-key."}
	}
	rights, _ := cmd.Flags().GetBool("rights-accepted")
	noGuest, _ := cmd.Flags().GetBool("no-guest")
	artist, _ := cmd.Flags().GetString("artist")
	st := m.e.store(f, o)

	if f.DryRun() {
		keyState := "a new guest artist would be created"
		if token, source, err := st.Key(); err == nil {
			f.RegisterSecret(token)
			keyState = "stored key for this service"
			if source == store.SourceEnv {
				keyState = TokenEnv
			}
		} else if noGuest {
			keyState = "missing (publish would stop because of --no-guest)"
		}
		ids := make([]string, 0, len(payload.Tracks))
		for _, t := range payload.Tracks {
			ids = append(ids, t.LocalID)
		}
		rightsText := "yes"
		if !rights || !payload.RightsAccepted {
			rightsText = "no (required to publish)"
		}
		body := []output.Field{
			{Name: "service", Value: o},
			{Name: "collection", Value: payload.Title},
			{Name: "libraryUid", Value: payload.LibraryUID},
			{Name: "tracks", Value: fmt.Sprintf("%d (%s)", len(payload.Tracks), strings.Join(ids, ", "))},
			{Name: "engine", Value: payload.EngineVersion},
			{Name: "payloadSha256", Value: payload.SHA256},
			{Name: "bytes", Value: fmt.Sprint(len(payload.Raw))},
			{Name: "rightsAccepted", Value: rightsText},
			{Name: "key", Value: keyState},
		}
		if payload.Visibility != "" {
			body = append(body, output.Field{Name: "visibility", Value: payload.Visibility})
		}
		return f.WritePreview(output.DryRunPreview{Method: "POST", Path: "/api/v1/releases", Body: body, Idempotency: key})
	}

	if !rights || !payload.RightsAccepted {
		return &cloud.Error{Code: "rights_not_accepted", Exit: cloud.ExitUsage, Message: "Publishing needs your confirmation that you have the right to share this music.", Hint: "Pass --rights-accepted (and set rightsAccepted in the release) only after the person sharing the music agreed."}
	}

	c := m.e.client(f, o, "")
	token, source, err := st.Key()
	created := false
	kind := ""
	switch {
	case err == nil:
		f.RegisterSecret(token)
		if account, ok, _ := st.Account(); ok && source == store.SourceFile {
			kind = account.Kind
		}
	case errors.Is(err, store.ErrNoKey) && noGuest:
		return keyError(o, err)
	case errors.Is(err, store.ErrNoKey):
		guest, gerr := createGuest(f, cmd, c, artist)
		if gerr != nil {
			return gerr
		}
		account := store.Account{Kind: store.KindGuest, Artist: storeArtist(guest.Artist), ClaimURL: guest.ClaimURL}
		if serr := st.Save(guest.Token, account); serr != nil {
			return &cloud.Error{Code: "credentials_unwritable", Exit: cloud.ExitAPI, Message: "The guest key was created but could not be stored: " + serr.Error()}
		}
		token, source, created, kind = guest.Token, store.SourceFile, true, store.KindGuest
	default:
		return keyError(o, err)
	}
	c.Token = token

	var release cloud.Release
	resp, err := c.JSON(runContext(cmd), cloud.Request{
		Method:  "POST",
		Path:    "/releases",
		Body:    payload.Raw,
		Headers: map[string]string{"Idempotency-Key": key},
		Retry:   true,
		Timeout: 3 * time.Minute,
	}, &release)
	if err != nil {
		return explainKeyFailure(err, source, kind)
	}
	if source == store.SourceFile {
		// Each guest publish returns a fresh claim link; none means the page
		// was claimed and the music moved to an account.
		_ = st.UpdateAccount(func(a *store.Account) {
			if a.Kind == store.KindGuest {
				a.ClaimURL = release.ClaimURL
				a.Claimed = release.ClaimURL == ""
			}
			if artist := release.Collection.Artist; artist != nil && artist.Handle != "" {
				a.Artist = storeArtist(*artist)
			}
		})
	}
	claim := release.ClaimURL
	wait, _ := cmd.Flags().GetBool("wait")
	if wait && !release.Done() {
		timeout, _ := cmd.Flags().GetDuration("timeout")
		// The release exists either way; a failed status check keeps its links.
		if polled, perr := m.e.poll(f, cmd, c, release.ID, timeout); perr == nil {
			release = polled
		} else {
			f.Infof("Could not follow the rendering: %s Check later with release show %s.", perr.Error(), release.ID)
		}
	}
	result := releaseResult(o, release, resp.Status == 200)
	result.ClaimURL = claim
	result.Credential = &credentialInfo{Source: source, Created: created, Kind: kind}
	result.IdempotencyKey = key
	result.PayloadSHA256 = payload.SHA256
	return f.WriteResult(result, func(w io.Writer) { renderRelease(w, result, "Published") })
}

func createGuest(f *rungrad.Factory, cmd *cobra.Command, c *cloud.Client, name string) (cloud.GuestKey, error) {
	body := map[string]string{}
	if strings.TrimSpace(name) != "" {
		body["artist"] = strings.TrimSpace(name)
	}
	encoded, _ := json.Marshal(body)
	var guest cloud.GuestKey
	_, err := c.JSON(runContext(cmd), cloud.Request{Method: "POST", Path: "/guest-keys", Body: encoded, Anonymous: true}, &guest)
	if err != nil {
		var apiErr *cloud.Error
		if errors.As(err, &apiErr) && apiErr.Exit == cloud.ExitRateLimited {
			apiErr.Hint = "This network created several guest artists today. Try again tomorrow, or log in with an account."
		}
		return guest, err
	}
	f.RegisterSecret(guest.Token)
	if guest.Token == "" {
		return guest, &cloud.Error{Code: "bad_response", Exit: cloud.ExitAPI, Message: "The service did not return a guest key."}
	}
	return guest, nil
}

func explainKeyFailure(err error, source, kind string) error {
	var apiErr *cloud.Error
	if !errors.As(err, &apiErr) {
		return err
	}
	switch apiErr.Exit {
	case cloud.ExitAuth:
		if source == store.SourceEnv {
			apiErr.Message = "The service did not accept the key in " + TokenEnv + "."
			apiErr.Hint = "Check the value of " + TokenEnv + " or unset it to use the stored key."
		} else {
			apiErr.Message = "The service did not accept the stored key; it may have expired or been revoked."
			// Never a new guest artist: the service refuses music another
			// artist page already published, so the way back is that page.
			apiErr.Hint = "If it belonged to a guest artist page that is not claimed yet, open that page's claim link while signed in to your Soundroo account (auth status shows it). Then run login and try again."
		}
	case cloud.ExitForbidden:
		if kind == store.KindGuest && apiErr.Hint == "" {
			apiErr.Hint = "Guest keys can publish. Claim your artist page or log in with an account to edit or delete music."
		}
	}
	return apiErr
}

func storeArtist(a cloud.Artist) store.Artist {
	return store.Artist{ID: a.ID, Handle: a.Handle, Name: a.Name, URL: a.URL}
}

func (m publishModule) releaseShow() *rungrad.Command {
	return &rungrad.Command{
		Use:          "show <release-id>",
		Short:        releaseShowSpec.Summary,
		Long:         "Show a release's rendering status and the links of its collection and tracks. --wait polls until the service finishes rendering or the timeout passes.",
		Examples:     releaseShowSpec.Examples,
		Related:      releaseShowSpec.Related,
		OutputModes:  releaseShowSpec.OutputModes,
		RequiresAuth: true,
		Args:         cobra.ExactArgs(1),
		Configure: func(cmd *cobra.Command) {
			cmd.Flags().Bool("wait", false, "Wait until the service finishes rendering")
			cmd.Flags().Duration("timeout", 15*time.Minute, "Longest time to wait with --wait")
		},
		Run: func(f *rungrad.Factory, cmd *cobra.Command, args []string) error {
			o, err := origin(f)
			if err != nil {
				return err
			}
			id, err := publicID(args[0], "release")
			if err != nil {
				return err
			}
			c := m.e.client(f, o, f.Token)
			wait, _ := cmd.Flags().GetBool("wait")
			timeout, _ := cmd.Flags().GetDuration("timeout")
			var release cloud.Release
			if wait {
				release, err = m.e.poll(f, cmd, c, id, timeout)
			} else {
				_, err = c.JSON(runContext(cmd), cloud.Request{Method: "GET", Path: "/releases/" + id, Retry: true}, &release)
			}
			if err != nil {
				return err
			}
			result := releaseResult(o, release, false)
			return f.WriteResult(result, func(w io.Writer) { renderRelease(w, result, "Release") })
		},
	}
}

// poll follows a release until rendering finishes or the timeout passes.
func (e *env) poll(f *rungrad.Factory, cmd *cobra.Command, c *cloud.Client, id string, timeout time.Duration) (cloud.Release, error) {
	if !cloud.PublicID.MatchString(id) {
		return cloud.Release{}, &cloud.Error{Code: "bad_response", Exit: cloud.ExitAPI, Message: "The service returned an invalid release id."}
	}
	deadline := e.now().Add(timeout)
	last := ""
	for {
		var release cloud.Release
		if _, err := c.JSON(runContext(cmd), cloud.Request{Method: "GET", Path: "/releases/" + id, Retry: true}, &release); err != nil {
			return release, err
		}
		if release.Done() || !e.now().Before(deadline) {
			return release, nil
		}
		ready, total := 0, len(release.Items)
		for _, item := range release.Items {
			if item.Status == "ready" {
				ready++
			}
		}
		if line := fmt.Sprintf("Rendering on the service: %d of %d tracks ready", ready, total); line != last {
			f.Infof("%s", line)
			last = line
		}
		if err := e.sleep(runContext(cmd), 3*time.Second); err != nil {
			return release, nil
		}
	}
}

type releaseInfo struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	Replayed  bool   `json:"replayed"`
	StatusURL string `json:"statusUrl,omitempty"`
}

type collectionInfo struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	URL        string `json:"url"`
	ShortURL   string `json:"shortUrl"`
	Visibility string `json:"visibility"`
}

type artistInfo struct {
	ID     string `json:"id,omitempty"`
	Handle string `json:"handle"`
	Name   string `json:"name"`
	URL    string `json:"url"`
}

type trackInfo struct {
	LocalID    string `json:"localId"`
	ID         string `json:"id"`
	Title      string `json:"title"`
	Status     string `json:"status"`
	URL        string `json:"url"`
	ShortURL   string `json:"shortUrl"`
	Visibility string `json:"visibility,omitempty"`
	Access     string `json:"access,omitempty"`
	Revision   string `json:"revision,omitempty"`
	Error      string `json:"error,omitempty"`
}

type credentialInfo struct {
	Source  string `json:"source"`
	Created bool   `json:"created"`
	Kind    string `json:"kind,omitempty"`
}

type publishResult struct {
	Service        string          `json:"service"`
	Release        releaseInfo     `json:"release"`
	Collection     collectionInfo  `json:"collection"`
	Artist         *artistInfo     `json:"artist,omitempty"`
	Tracks         []trackInfo     `json:"tracks"`
	ClaimURL       string          `json:"claimUrl,omitempty"`
	Credential     *credentialInfo `json:"credential,omitempty"`
	IdempotencyKey string          `json:"idempotencyKey,omitempty"`
	PayloadSHA256  string          `json:"payloadSha256,omitempty"`
}

func releaseResult(o string, r cloud.Release, replayed bool) publishResult {
	result := publishResult{
		Service:    o,
		Release:    releaseInfo{ID: r.ID, Status: r.Status, Replayed: replayed, StatusURL: r.StatusURL},
		Collection: collectionInfo{ID: r.Collection.ID, Title: r.Collection.Title, URL: r.Collection.URL, ShortURL: r.Collection.ShortURL, Visibility: r.Collection.Visibility},
		Tracks:     []trackInfo{},
	}
	if a := r.Collection.Artist; a != nil {
		result.Artist = &artistInfo{ID: a.ID, Handle: a.Handle, Name: a.Name, URL: a.URL}
	}
	byID := map[string]cloud.TrackRef{}
	for _, t := range r.Collection.Tracks {
		byID[t.ID] = t
	}
	for _, item := range r.Items {
		t := byID[item.TrackID]
		info := trackInfo{LocalID: t.LocalID, ID: item.TrackID, Title: t.Title, Status: item.Status, URL: t.URL, ShortURL: t.ShortURL, Visibility: t.Visibility, Access: t.Access, Revision: item.Revision}
		if item.Error != nil {
			info.Error = *item.Error
		}
		result.Tracks = append(result.Tracks, info)
	}
	return result
}

func renderRelease(w io.Writer, r publishResult, verb string) {
	status := r.Release.Status
	if r.Release.Replayed {
		status += ", already received"
	}
	fmt.Fprintf(w, "%s %q to %s (release %s, %s).\n", verb, r.Collection.Title, r.Service, r.Release.ID, status)
	if r.Collection.URL != "" {
		fmt.Fprintf(w, "Collection:  %s\n", r.Collection.URL)
	}
	if r.Collection.ShortURL != "" {
		fmt.Fprintf(w, "Short link:  %s\n", r.Collection.ShortURL)
	}
	if r.Artist != nil && r.Artist.URL != "" {
		fmt.Fprintf(w, "Artist:      %s\n", r.Artist.URL)
	}
	if len(r.Tracks) > 0 {
		rows := make([][]string, 0, len(r.Tracks))
		for _, t := range r.Tracks {
			link := t.ShortURL
			if link == "" {
				link = t.URL
			}
			title := t.Title
			if title == "" {
				title = t.LocalID
			}
			state := t.Status
			if t.Error != "" {
				state += ": " + t.Error
			}
			rows = append(rows, []string{"  " + title, state, link})
		}
		fmt.Fprintln(w, "Tracks:")
		output.RenderTable(w, output.Table{Rows: rows})
	}
	if r.ClaimURL != "" {
		fmt.Fprintf(w, "Claim your artist page to keep this music (keep this link private):\n  %s\n", r.ClaimURL)
	}
	switch r.Release.Status {
	case "queued", "rendering":
		fmt.Fprintln(w, "The links work now. The service renders the audio from the scores; tracks play once they are ready.")
	case "failed":
		fmt.Fprintln(w, "Some tracks did not render. Check their scores, render them locally and publish again.")
	}
}

func publicID(value, kind string) (string, error) {
	value = strings.TrimSpace(value)
	if !cloud.PublicID.MatchString(value) {
		return "", &cloud.Error{Code: "invalid_id", Exit: cloud.ExitUsage, Message: fmt.Sprintf("%q is not a %s id. Ids have 26 letters and digits.", value, kind)}
	}
	return value, nil
}
