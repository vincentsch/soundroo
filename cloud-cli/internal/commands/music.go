package commands

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"

	"github.com/spf13/cobra"
	rungrad "github.com/vincentsch/rungrad"
	"github.com/vincentsch/rungrad/output"
	"github.com/vincentsch/soundroo/cloud-cli/internal/cloud"
)

type musicModule struct{ e *env }

func (musicModule) Groups() []rungrad.Group {
	return []rungrad.Group{{ID: "music", Title: "Shared music"}}
}

var (
	trackSpec = rungrad.CommandSpec{
		Path:     "track",
		Summary:  "Read or manage a shared track",
		GroupID:  "music",
		Examples: []string{"soundroo-cloud track show 01JABCDEFGHJKMNPQRSTVWXYZ0", "soundroo-cloud track update 01JABCDEFGHJKMNPQRSTVWXYZ0 --access listen-only --dry-run"},
		Related:  []string{"soundroo-cloud collection", "soundroo-cloud score"},
	}
	trackShowSpec = rungrad.CommandSpec{
		Path:        "track show",
		Summary:     "Show a shared track",
		OutputModes: []string{rungrad.OutputModeHuman, rungrad.OutputModeJSON},
		Examples:    []string{"soundroo-cloud track show 01JABCDEFGHJKMNPQRSTVWXYZ0", "soundroo-cloud track show https://soundroo.com/t/01JABCDEFGHJKMNPQRSTVWXYZ0 --json"},
		Related:     []string{"soundroo-cloud score"},
	}
	trackUpdateSpec = rungrad.CommandSpec{
		Path:         "track update",
		Summary:      "Change a track's title, description, visibility or access",
		OutputModes:  []string{rungrad.OutputModeHuman, rungrad.OutputModeJSON},
		Examples:     []string{"soundroo-cloud track update 01JABCDEFGHJKMNPQRSTVWXYZ0 --access listen-only --dry-run", "soundroo-cloud track update 01JABCDEFGHJKMNPQRSTVWXYZ0 --visibility public"},
		Related:      []string{"soundroo-cloud track show"},
		RequiresAuth: true,
		Mutates:      true,
	}
	trackDeleteSpec = rungrad.CommandSpec{
		Path:         "track delete",
		Summary:      "Delete a shared track from the service",
		OutputModes:  []string{rungrad.OutputModeHuman, rungrad.OutputModeJSON},
		Examples:     []string{"soundroo-cloud track delete 01JABCDEFGHJKMNPQRSTVWXYZ0 --dry-run", "soundroo-cloud track delete 01JABCDEFGHJKMNPQRSTVWXYZ0 --confirm"},
		Related:      []string{"soundroo-cloud track show"},
		RequiresAuth: true,
		Mutates:      true,
		Destructive:  true,
	}
	collectionSpec = rungrad.CommandSpec{
		Path:     "collection",
		Summary:  "Read or manage a shared collection",
		GroupID:  "music",
		Examples: []string{"soundroo-cloud collection show 01JABCDEFGHJKMNPQRSTVWXYZ0", "soundroo-cloud collection update 01JABCDEFGHJKMNPQRSTVWXYZ0 --visibility public --dry-run"},
		Related:  []string{"soundroo-cloud track"},
	}
	collectionShowSpec = rungrad.CommandSpec{
		Path:        "collection show",
		Summary:     "Show a shared collection and its tracks",
		OutputModes: []string{rungrad.OutputModeHuman, rungrad.OutputModeJSON},
		Examples:    []string{"soundroo-cloud collection show 01JABCDEFGHJKMNPQRSTVWXYZ0", "soundroo-cloud collection show https://soundroo.com/c/01JABCDEFGHJKMNPQRSTVWXYZ0 --json"},
		Related:     []string{"soundroo-cloud track show"},
	}
	collectionUpdateSpec = rungrad.CommandSpec{
		Path:         "collection update",
		Summary:      "Change a collection's title, description, brief or visibility",
		OutputModes:  []string{rungrad.OutputModeHuman, rungrad.OutputModeJSON},
		Examples:     []string{"soundroo-cloud collection update 01JABCDEFGHJKMNPQRSTVWXYZ0 --visibility public --dry-run", "soundroo-cloud collection update 01JABCDEFGHJKMNPQRSTVWXYZ0 --title \"Night Trains\""},
		Related:      []string{"soundroo-cloud collection show"},
		RequiresAuth: true,
		Mutates:      true,
	}
	scoreSpec = rungrad.CommandSpec{
		Path:        "score",
		Summary:     "Download an open track's score, mix and credit",
		GroupID:     "music",
		OutputModes: []string{rungrad.OutputModeHuman, rungrad.OutputModeJSON},
		Examples:    []string{"soundroo-cloud score 01JABCDEFGHJKMNPQRSTVWXYZ0 --json", "soundroo-cloud score https://soundroo.com/t/01JABCDEFGHJKMNPQRSTVWXYZ0 --json", "soundroo-cloud score https://soundroo.com/@mara/night-train --json"},
		Related:     []string{"soundroo-cloud track show"},
	}
)

func (musicModule) Catalog() []rungrad.CommandSpec {
	return []rungrad.CommandSpec{trackSpec, trackShowSpec, trackUpdateSpec, trackDeleteSpec, collectionSpec, collectionShowSpec, collectionUpdateSpec, scoreSpec}
}

func (m musicModule) Commands() []*rungrad.Command {
	track := &rungrad.Command{Use: "track", Short: trackSpec.Summary, Examples: trackSpec.Examples, Related: trackSpec.Related, GroupID: "music"}
	track.AddCommand(m.trackShow(), m.trackUpdate(), m.trackDelete())
	collection := &rungrad.Command{Use: "collection", Short: collectionSpec.Summary, Examples: collectionSpec.Examples, Related: collectionSpec.Related, GroupID: "music"}
	collection.AddCommand(m.collectionShow(), m.collectionUpdate())
	return []*rungrad.Command{track, collection, m.score()}
}

// resourceID accepts an id or a short link (/t/ID, /c/ID) on the configured
// service. Links to other services are refused so keys stay with their origin.
func resourceID(o, value, kind, short string) (string, error) {
	value = strings.TrimSpace(value)
	if cloud.PublicID.MatchString(value) {
		return value, nil
	}
	u, err := url.Parse(value)
	if err == nil && u.Scheme != "" && u.Host != "" {
		if !cloud.SameOrigin(o, value) {
			return "", &cloud.Error{Code: "other_service", Exit: cloud.ExitUsage, Message: fmt.Sprintf("That link is not on %s.", o), Hint: "Pass --service with the link's address to use that service."}
		}
		parts := strings.Split(strings.Trim(u.Path, "/"), "/")
		if len(parts) == 2 && parts[0] == short && cloud.PublicID.MatchString(parts[1]) {
			return parts[1], nil
		}
		return "", &cloud.Error{Code: "invalid_id", Exit: cloud.ExitUsage, Message: fmt.Sprintf("Use the %s's short link (%s/%s/...) or its id.", kind, o, short)}
	}
	return "", &cloud.Error{Code: "invalid_id", Exit: cloud.ExitUsage, Message: fmt.Sprintf("%q is not a %s id or short link.", value, kind)}
}

// trackID accepts what resourceID does and also a track page link
// (/@handle/slug), which the service looks up.
func trackID(ctx context.Context, c *cloud.Client, o, value string) (string, error) {
	value = strings.TrimSpace(value)
	if u, err := url.Parse(value); err == nil && u.Scheme != "" && u.Host != "" && cloud.SameOrigin(o, value) {
		parts := strings.Split(strings.Trim(u.Path, "/"), "/")
		if len(parts) == 2 && len(parts[0]) > 1 && parts[0][0] == '@' {
			var t cloud.TrackRef
			if _, err := c.Resource(ctx, cloud.Request{Method: "GET", Path: "/artists/" + url.PathEscape(parts[0][1:]) + "/tracks/" + url.PathEscape(parts[1]), Retry: true}, &t); err != nil {
				return "", err
			}
			if !cloud.PublicID.MatchString(t.ID) {
				return "", &cloud.Error{Code: "bad_response", Exit: cloud.ExitAPI, Message: "The service sent no track for that link."}
			}
			return t.ID, nil
		}
	}
	return resourceID(o, value, "track", "t")
}

func (m musicModule) trackShow() *rungrad.Command {
	return &rungrad.Command{
		Use:         "show <track>",
		Short:       trackShowSpec.Summary,
		Long:        "Show a shared track by id or short link. With your key, your own unlisted and private tracks are included.",
		Examples:    trackShowSpec.Examples,
		Related:     trackShowSpec.Related,
		OutputModes: trackShowSpec.OutputModes,
		Args:        cobra.ExactArgs(1),
		Run: func(f *rungrad.Factory, cmd *cobra.Command, args []string) error {
			o, err := origin(f)
			if err != nil {
				return err
			}
			c := m.e.client(f, o, m.e.optionalKey(f, o))
			id, err := trackID(runContext(cmd), c, o, args[0])
			if err != nil {
				return err
			}
			var t cloud.TrackRef
			if _, err := c.Resource(runContext(cmd), cloud.Request{Method: "GET", Path: "/tracks/" + id, Retry: true}, &t); err != nil {
				return err
			}
			result := trackView(t)
			return f.WriteResult(result, func(w io.Writer) {
				output.RenderNodes(w, []output.Node{{Label: "Track", Value: result.Title}, {Label: "Artist", Value: result.Artist}, {Label: "Status", Value: result.Status}, {Label: "Visibility", Value: result.Visibility}, {Label: "Access", Value: result.Access}, {Label: "Link", Value: result.URL}})
			})
		},
	}
}

type trackResult struct {
	ID         string `json:"id"`
	LocalID    string `json:"localId"`
	Title      string `json:"title"`
	Artist     string `json:"artist,omitempty"`
	Status     string `json:"status"`
	Visibility string `json:"visibility"`
	Access     string `json:"access"`
	URL        string `json:"url"`
	ShortURL   string `json:"shortUrl"`
	Collection string `json:"collection,omitempty"`
	Revision   string `json:"revision,omitempty"`
	RemixOf    string `json:"remixOf,omitempty"`
}

func trackView(t cloud.TrackRef) trackResult {
	r := trackResult{ID: t.ID, LocalID: t.LocalID, Title: t.Title, Status: t.Status, Visibility: t.Visibility, Access: t.Access, URL: t.URL, ShortURL: t.ShortURL, Revision: t.Revision}
	if t.Artist != nil {
		r.Artist = "@" + t.Artist.Handle
	}
	if t.Collection != nil {
		r.Collection = t.Collection.ID
	}
	if t.RemixOf != nil {
		r.RemixOf = t.RemixOf.ID
	}
	return r
}

func stringFlags(cmd *cobra.Command, names map[string]string) (map[string]any, []output.Field) {
	body := map[string]any{}
	var fields []output.Field
	for flag, key := range names {
		if cmd.Flags().Changed(flag) {
			value, _ := cmd.Flags().GetString(flag)
			body[key] = value
			fields = append(fields, output.Field{Name: key, Value: value})
		}
	}
	sortFields(fields)
	return body, fields
}

func sortFields(fields []output.Field) {
	for i := 1; i < len(fields); i++ {
		for j := i; j > 0 && fields[j].Name < fields[j-1].Name; j-- {
			fields[j], fields[j-1] = fields[j-1], fields[j]
		}
	}
}

func checkChoice(body map[string]any, key string, allowed map[string]bool, message string) error {
	if value, ok := body[key]; ok && !allowed[value.(string)] {
		return &cloud.Error{Code: "invalid_option", Exit: cloud.ExitUsage, Message: message}
	}
	return nil
}

func manageError(err error, source string) error {
	var apiErr *cloud.Error
	if errors.As(err, &apiErr) && apiErr.Exit == cloud.ExitForbidden && apiErr.Hint == "" {
		apiErr.Hint = "Guest keys can only publish. Claim your artist page, then run login to edit or delete music from here."
	}
	return explainKeyFailure(err, source, "")
}

func (m musicModule) trackUpdate() *rungrad.Command {
	flags := map[string]string{"title": "title", "description": "description", "visibility": "visibility", "access": "access", "genre-family": "genreFamily"}
	return &rungrad.Command{
		Use:            "update <track>",
		Short:          trackUpdateSpec.Summary,
		Long:           "Change a shared track. Only the fields you pass change. Needs an account key: claim your artist page and run login first. --access listen-only stops downloads and remixing of future visitors; copies already downloaded under CC BY 4.0 keep that license.",
		Examples:       trackUpdateSpec.Examples,
		Related:        trackUpdateSpec.Related,
		OutputModes:    trackUpdateSpec.OutputModes,
		RequiresAuth:   true,
		AuthResolution: rungrad.AuthResolutionHandler,
		Mutates:        true,
		Args:           cobra.ExactArgs(1),
		Configure: func(cmd *cobra.Command) {
			cmd.Flags().String("title", "", "New title")
			cmd.Flags().String("description", "", "New description")
			cmd.Flags().String("visibility", "", "public, unlisted or private")
			cmd.Flags().String("access", "", "open (download and remix with credit) or listen-only")
			cmd.Flags().String("genre-family", "", "Genre family shown on the service")
		},
		Run: func(f *rungrad.Factory, cmd *cobra.Command, args []string) error {
			o, err := origin(f)
			if err != nil {
				return err
			}
			id, err := resourceID(o, args[0], "track", "t")
			if err != nil {
				return err
			}
			body, fields := stringFlags(cmd, flags)
			if len(body) == 0 {
				return &cloud.Error{Code: "nothing_to_change", Exit: cloud.ExitUsage, Message: "Pass at least one of --title, --description, --visibility, --access or --genre-family."}
			}
			if err := checkChoice(body, "visibility", visibilities, "Use --visibility public, unlisted or private."); err != nil {
				return err
			}
			if err := checkChoice(body, "access", accesses, "Use --access open or listen-only."); err != nil {
				return err
			}
			if f.DryRun() {
				return f.WritePreview(output.DryRunPreview{Method: "PATCH", Path: "/api/v1/tracks/" + id, Body: fields})
			}
			token, source, err := m.e.requireKey(f, o)
			if err != nil {
				return err
			}
			encoded, _ := json.Marshal(body)
			c := m.e.client(f, o, token)
			var updated cloud.TrackRef
			if _, err := c.Resource(runContext(cmd), cloud.Request{Method: "PATCH", Path: "/tracks/" + id, Body: encoded}, &updated); err != nil {
				return manageError(err, source)
			}
			result := trackView(updated)
			return f.WriteResult(result, func(w io.Writer) {
				output.RenderMutationMode(w, output.MutationSummary{Action: "Updated", Resource: "track", Name: result.Title, ID: result.ID, Fields: map[string]string{"visibility": result.Visibility, "access": result.Access}}, f.TerminalMode())
			})
		},
	}
}

func (m musicModule) trackDelete() *rungrad.Command {
	return &rungrad.Command{
		Use:            "delete <track>",
		Short:          trackDeleteSpec.Summary,
		Long:           "Delete a shared track from the service. Its page stops playing for everyone. The scores in your local library stay. Needs an account key and --confirm (or an interactive confirmation).",
		Examples:       trackDeleteSpec.Examples,
		Related:        trackDeleteSpec.Related,
		OutputModes:    trackDeleteSpec.OutputModes,
		RequiresAuth:   true,
		AuthResolution: rungrad.AuthResolutionHandler,
		Mutates:        true,
		Destructive:    true,
		Args:           cobra.ExactArgs(1),
		Configure: func(cmd *cobra.Command) {
			cmd.Flags().Bool("confirm", false, "Confirm the deletion without a prompt")
		},
		Run: func(f *rungrad.Factory, cmd *cobra.Command, args []string) error {
			o, err := origin(f)
			if err != nil {
				return err
			}
			id, err := resourceID(o, args[0], "track", "t")
			if err != nil {
				return err
			}
			if f.DryRun() {
				return f.WritePreview(output.DryRunPreview{Method: "DELETE", Path: "/api/v1/tracks/" + id})
			}
			confirmed, _ := cmd.Flags().GetBool("confirm")
			if err := f.ConfirmDestructive(rungrad.ConfirmOptions{Action: "delete track", Target: id + " on " + o, Confirmed: confirmed}); err != nil {
				return err
			}
			token, source, err := m.e.requireKey(f, o)
			if err != nil {
				return err
			}
			c := m.e.client(f, o, token)
			if _, err := c.Do(runContext(cmd), cloud.Request{Method: "DELETE", Path: "/tracks/" + id}); err != nil {
				return manageError(err, source)
			}
			summary := output.MutationSummary{Action: "Deleted", Resource: "track", ID: id, Notes: []string{"The score stays in your local library."}}
			return f.WriteResult(map[string]any{"service": o, "id": id, "deleted": true}, func(w io.Writer) {
				output.RenderMutationMode(w, summary, f.TerminalMode())
			})
		},
	}
}

// collectionResult's CanEdit is the service's answer for the key the request
// sent: whether that key's account owns the collection and can update it.
type collectionResult struct {
	ID          string        `json:"id"`
	Title       string        `json:"title"`
	Description string        `json:"description"`
	Visibility  string        `json:"visibility"`
	URL         string        `json:"url"`
	ShortURL    string        `json:"shortUrl"`
	Artist      string        `json:"artist,omitempty"`
	CanEdit     bool          `json:"canEdit"`
	Tracks      []trackResult `json:"tracks"`
}

func collectionView(col cloud.Collection) collectionResult {
	r := collectionResult{ID: col.ID, Title: col.Title, Description: col.Description, Visibility: col.Visibility, URL: col.URL, ShortURL: col.ShortURL, CanEdit: col.CanEdit, Tracks: []trackResult{}}
	if col.Artist != nil {
		r.Artist = "@" + col.Artist.Handle
	}
	for _, t := range col.Tracks {
		r.Tracks = append(r.Tracks, trackView(t))
	}
	return r
}

func renderCollection(w io.Writer, r collectionResult) {
	fmt.Fprintf(w, "%s by %s (%s)\n%s\n", r.Title, r.Artist, r.Visibility, r.URL)
	rows := make([][]string, 0, len(r.Tracks))
	for _, t := range r.Tracks {
		rows = append(rows, []string{t.Title, t.Status, t.Access, t.ShortURL})
	}
	output.RenderTable(w, output.Table{Columns: []string{"Track", "Status", "Access", "Link"}, Rows: rows, Empty: "No tracks visible."})
}

func (m musicModule) collectionShow() *rungrad.Command {
	return &rungrad.Command{
		Use:         "show <collection>",
		Short:       collectionShowSpec.Summary,
		Long:        "Show a shared collection by id or short link. With your key, your own unlisted and private tracks are included.",
		Examples:    collectionShowSpec.Examples,
		Related:     collectionShowSpec.Related,
		OutputModes: collectionShowSpec.OutputModes,
		Args:        cobra.ExactArgs(1),
		Run: func(f *rungrad.Factory, cmd *cobra.Command, args []string) error {
			o, err := origin(f)
			if err != nil {
				return err
			}
			id, err := resourceID(o, args[0], "collection", "c")
			if err != nil {
				return err
			}
			c := m.e.client(f, o, m.e.optionalKey(f, o))
			var col cloud.Collection
			if _, err := c.Resource(runContext(cmd), cloud.Request{Method: "GET", Path: "/collections/" + id, Retry: true}, &col); err != nil {
				return err
			}
			result := collectionView(col)
			return f.WriteResult(result, func(w io.Writer) { renderCollection(w, result) })
		},
	}
}

func (m musicModule) collectionUpdate() *rungrad.Command {
	flags := map[string]string{"title": "title", "description": "description", "brief": "brief", "visibility": "visibility"}
	return &rungrad.Command{
		Use:            "update <collection>",
		Short:          collectionUpdateSpec.Summary,
		Long:           "Change a shared collection. Only the fields you pass change. Needs an account key: claim your artist page and run login first.",
		Examples:       collectionUpdateSpec.Examples,
		Related:        collectionUpdateSpec.Related,
		OutputModes:    collectionUpdateSpec.OutputModes,
		RequiresAuth:   true,
		AuthResolution: rungrad.AuthResolutionHandler,
		Mutates:        true,
		Args:           cobra.ExactArgs(1),
		Configure: func(cmd *cobra.Command) {
			cmd.Flags().String("title", "", "New title")
			cmd.Flags().String("description", "", "New description")
			cmd.Flags().String("brief", "", "The brief behind the collection, shown when you choose to share it")
			cmd.Flags().String("visibility", "", "public, unlisted or private")
		},
		Run: func(f *rungrad.Factory, cmd *cobra.Command, args []string) error {
			o, err := origin(f)
			if err != nil {
				return err
			}
			id, err := resourceID(o, args[0], "collection", "c")
			if err != nil {
				return err
			}
			body, fields := stringFlags(cmd, flags)
			if len(body) == 0 {
				return &cloud.Error{Code: "nothing_to_change", Exit: cloud.ExitUsage, Message: "Pass at least one of --title, --description, --brief or --visibility."}
			}
			if err := checkChoice(body, "visibility", visibilities, "Use --visibility public, unlisted or private."); err != nil {
				return err
			}
			if f.DryRun() {
				return f.WritePreview(output.DryRunPreview{Method: "PATCH", Path: "/api/v1/collections/" + id, Body: fields})
			}
			token, source, err := m.e.requireKey(f, o)
			if err != nil {
				return err
			}
			encoded, _ := json.Marshal(body)
			c := m.e.client(f, o, token)
			var updated cloud.Collection
			if _, err := c.Resource(runContext(cmd), cloud.Request{Method: "PATCH", Path: "/collections/" + id, Body: encoded}, &updated); err != nil {
				return manageError(err, source)
			}
			result := collectionView(updated)
			return f.WriteResult(result, func(w io.Writer) {
				output.RenderMutationMode(w, output.MutationSummary{Action: "Updated", Resource: "collection", Name: result.Title, ID: result.ID, Fields: map[string]string{"visibility": result.Visibility}}, f.TerminalMode())
			})
		},
	}
}

type scoreResult struct {
	Service  string          `json:"service"`
	TrackID  string          `json:"trackId"`
	Score    json.RawMessage `json:"score"`
	Mix      json.RawMessage `json:"mix"`
	Engine   json.RawMessage `json:"engine,omitempty"`
	Revision string          `json:"revision,omitempty"`
	RemixOf  string          `json:"remixOf,omitempty"`
	Artist   json.RawMessage `json:"artist,omitempty"`
	License  string          `json:"license,omitempty"`
}

func (m musicModule) score() *rungrad.Command {
	return &rungrad.Command{
		Use:   "score <track>",
		Short: scoreSpec.Summary,
		Long: `Download the score and mix of an open track, with its artist and license,
exactly as the service stored them. Open tracks are shared under CC BY 4.0:
credit the artist when you share a remix. Listen-only tracks have no score to
download unless they are yours. The toolkit's import command adds the result to
a library; this command only prints it.`,
		Examples:    scoreSpec.Examples,
		Related:     scoreSpec.Related,
		OutputModes: scoreSpec.OutputModes,
		GroupID:     "music",
		Args:        cobra.ExactArgs(1),
		Run: func(f *rungrad.Factory, cmd *cobra.Command, args []string) error {
			o, err := origin(f)
			if err != nil {
				return err
			}
			c := m.e.client(f, o, m.e.optionalKey(f, o))
			id, err := trackID(runContext(cmd), c, o, args[0])
			var s cloud.Score
			if err == nil {
				_, err = c.JSON(runContext(cmd), cloud.Request{Method: "GET", Path: "/tracks/" + id + "/score", Retry: true}, &s)
			}
			if err != nil {
				var apiErr *cloud.Error
				if errors.As(err, &apiErr) && apiErr.Exit == cloud.ExitNotFound {
					apiErr.Message = "That track's score is not available: it does not exist, is listen-only, or is not shared with you."
				}
				return err
			}
			if len(s.Score) == 0 || s.Score[0] != '{' {
				return &cloud.Error{Code: "bad_response", Exit: cloud.ExitAPI, Message: "The service sent no score for that track."}
			}
			mix := s.Mix
			if len(mix) == 0 || string(mix) == "null" || string(mix) == "[]" {
				mix = json.RawMessage("{}")
			}
			result := scoreResult{Service: o, TrackID: id, Score: s.Score, Mix: mix, Engine: s.Engine, Revision: s.Revision, RemixOf: s.RemixOf, Artist: s.Artist, License: s.License}
			return f.WriteResult(result, func(w io.Writer) {
				var artist cloud.Artist
				_ = json.Unmarshal(s.Artist, &artist)
				fmt.Fprintf(w, "Score of %s by @%s (%s), %d bytes. Use --json to read it, or the toolkit's import command to add it to a library.\n", id, artist.Handle, s.License, len(s.Score))
			})
		},
	}
}
