package commands

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
	"unicode"

	"github.com/spf13/cobra"
	rungrad "github.com/vincentsch/rungrad"
	"github.com/vincentsch/rungrad/config"
	"github.com/vincentsch/rungrad/output"
	"github.com/vincentsch/soundroo/cloud-cli/internal/cloud"
	"github.com/vincentsch/soundroo/cloud-cli/internal/store"
)

type accountModule struct{ e *env }

func (accountModule) Groups() []rungrad.Group {
	return []rungrad.Group{{ID: "account", Title: "Your key"}}
}

var (
	authSpec = rungrad.CommandSpec{
		Path:     "auth",
		Summary:  "Inspect the key stored for a service",
		GroupID:  "account",
		Examples: []string{"soundroo-cloud auth status", "soundroo-cloud auth status --service http://127.0.0.1:8350 --json"},
		Related:  []string{"soundroo-cloud me", "soundroo-cloud login"},
	}
	authStatusSpec = rungrad.CommandSpec{
		Path:        "auth status",
		Summary:     "Show the service and the key stored for it, without contacting it",
		OutputModes: []string{rungrad.OutputModeHuman, rungrad.OutputModeJSON},
		Examples:    []string{"soundroo-cloud auth status", "soundroo-cloud auth status --service http://127.0.0.1:8350 --json"},
		Related:     []string{"soundroo-cloud me", "soundroo-cloud login"},
	}
	meSpec = rungrad.CommandSpec{
		Path:         "me",
		Summary:      "Show your artist page and shared collections",
		GroupID:      "account",
		OutputModes:  []string{rungrad.OutputModeHuman, rungrad.OutputModeJSON},
		Examples:     []string{"soundroo-cloud me", "soundroo-cloud me --json"},
		Related:      []string{"soundroo-cloud auth status"},
		RequiresAuth: true,
	}
	loginSpec = rungrad.CommandSpec{
		Path:        "login",
		Summary:     "Connect your Soundroo account with a device code",
		GroupID:     "account",
		OutputModes: []string{rungrad.OutputModeHuman, rungrad.OutputModeJSON},
		Examples:    []string{"soundroo-cloud login", "soundroo-cloud login --start --json", "soundroo-cloud login --wait --json"},
		Related:     []string{"soundroo-cloud logout", "soundroo-cloud auth status"},
		Mutates:     true,
	}
	claimLinkSpec = rungrad.CommandSpec{
		Path:         "claim-link",
		Summary:      "Get a fresh private link to claim your guest artist page",
		GroupID:      "account",
		OutputModes:  []string{rungrad.OutputModeHuman, rungrad.OutputModeJSON},
		Examples:     []string{"soundroo-cloud claim-link", "soundroo-cloud claim-link --json"},
		Related:      []string{"soundroo-cloud auth status", "soundroo-cloud login"},
		RequiresAuth: true,
		Mutates:      true,
	}
	logoutSpec = rungrad.CommandSpec{
		Path:         "logout",
		Summary:      "Revoke and forget the key stored for a service",
		GroupID:      "account",
		OutputModes:  []string{rungrad.OutputModeHuman, rungrad.OutputModeJSON},
		Examples:     []string{"soundroo-cloud logout --dry-run", "soundroo-cloud logout --confirm"},
		Related:      []string{"soundroo-cloud login", "soundroo-cloud auth status"},
		RequiresAuth: false,
		Mutates:      true,
		Destructive:  true,
	}
)

func (accountModule) Catalog() []rungrad.CommandSpec {
	return []rungrad.CommandSpec{authSpec, authStatusSpec, meSpec, loginSpec, claimLinkSpec, logoutSpec}
}

func (m accountModule) Commands() []*rungrad.Command {
	auth := &rungrad.Command{Use: "auth", Short: authSpec.Summary, Examples: authSpec.Examples, Related: authSpec.Related, GroupID: "account"}
	auth.AddCommand(m.authStatus())
	return []*rungrad.Command{auth, m.me(), m.login(), m.claimLink(), m.logout()}
}

type keyStatus struct {
	Present     bool          `json:"present"`
	Source      string        `json:"source"`
	Masked      string        `json:"masked,omitempty"`
	Kind        string        `json:"kind,omitempty"`
	Artist      *store.Artist `json:"artist,omitempty"`
	ClaimURL    string        `json:"claimUrl,omitempty"`
	Claimed     bool          `json:"claimed,omitempty"`
	FormerGuest *store.Former `json:"formerGuest,omitempty"`
	ValidatedAt string        `json:"validatedAt,omitempty"`
}

type pendingStatus struct {
	UserCode                string `json:"userCode"`
	VerificationURI         string `json:"verificationUri"`
	VerificationURIComplete string `json:"verificationUriComplete,omitempty"`
	ExpiresAt               string `json:"expiresAt"`
}

type authStatus struct {
	Service         string         `json:"service"`
	Key             keyStatus      `json:"key"`
	PendingLogin    *pendingStatus `json:"pendingLogin,omitempty"`
	ConfigPath      string         `json:"configPath"`
	CredentialsPath string         `json:"credentialsPath"`
}

func (m accountModule) authStatus() *rungrad.Command {
	return &rungrad.Command{
		Use:   "status",
		Short: authStatusSpec.Summary,
		Long: `Show the resolved service origin and the key this tool would use for it.
The key comes from ` + TokenEnv + ` when set, otherwise from the key stored for exactly this
origin. Keys are shown masked. A guest key's claim link is shown because only
you can read this file; keep it private. Nothing is sent to the service.`,
		Examples:    authStatusSpec.Examples,
		Related:     authStatusSpec.Related,
		OutputModes: authStatusSpec.OutputModes,
		Run: func(f *rungrad.Factory, cmd *cobra.Command, _ []string) error {
			o, err := origin(f)
			if err != nil {
				return err
			}
			st := m.e.store(f, o)
			status := authStatus{Service: o, Key: keyStatus{Source: store.SourceNone}, ConfigPath: f.ConfigPath(), CredentialsPath: f.AuthFilePath()}
			token, source, err := st.Key()
			if err != nil && !errors.Is(err, store.ErrNoKey) {
				return keyError(o, err)
			}
			if err == nil {
				f.RegisterSecret(token)
				status.Key.Present, status.Key.Source, status.Key.Masked = true, source, config.Mask(token)
			}
			if account, ok, aerr := st.Account(); aerr == nil && ok && source != store.SourceEnv {
				artist := account.Artist
				status.Key.Kind, status.Key.Artist, status.Key.ClaimURL, status.Key.Claimed, status.Key.FormerGuest = account.Kind, &artist, account.ClaimURL, account.Claimed, account.FormerGuest
				if stored, serr := st.StoredKey(); serr == nil {
					status.Key.ValidatedAt = stored.ValidatedAt
				}
			}
			if pending, ok, perr := st.PendingLogin(); perr == nil && ok {
				status.PendingLogin = &pendingStatus{UserCode: pending.UserCode, VerificationURI: pending.VerificationURI, VerificationURIComplete: pending.VerificationURIComplete, ExpiresAt: pending.ExpiresAt}
			}
			return f.WriteResult(status, func(w io.Writer) {
				nodes := []output.Node{{Label: "Service", Value: status.Service}}
				if !status.Key.Present {
					nodes = append(nodes, output.Node{Label: "Key", Value: "none (the first share creates a guest artist)"})
				} else {
					label := status.Key.Masked + " from " + map[string]string{store.SourceEnv: TokenEnv, store.SourceFile: "the stored keys"}[status.Key.Source]
					nodes = append(nodes, output.Node{Label: "Key", Value: label})
				}
				if status.Key.Artist != nil && status.Key.Artist.Handle != "" {
					kind := status.Key.Kind + " key"
					if status.Key.Claimed {
						kind += ", page claimed"
					}
					nodes = append(nodes, output.Node{Label: "Artist", Value: fmt.Sprintf("@%s (%s)", status.Key.Artist.Handle, kind)})
				}
				if status.Key.ClaimURL != "" {
					nodes = append(nodes, output.Node{Label: "Claim link (private)", Value: status.Key.ClaimURL})
				}
				if g := status.Key.FormerGuest; g != nil && g.ClaimURL != "" {
					nodes = append(nodes, output.Node{Label: "Earlier guest page claim link (private)", Value: g.ClaimURL})
				}
				if p := status.PendingLogin; p != nil {
					nodes = append(nodes, output.Node{Label: "Login waiting for approval", Value: p.VerificationURI + " code " + p.UserCode})
				}
				nodes = append(nodes, output.Node{Label: "Credentials file", Value: status.CredentialsPath})
				output.RenderNodes(w, nodes)
			})
		},
	}
}

type meResult struct {
	Service     string           `json:"service"`
	Artist      artistInfo       `json:"artist"`
	Collections []collectionInfo `json:"collections"`
}

func (m accountModule) me() *rungrad.Command {
	return &rungrad.Command{
		Use:          "me",
		Short:        meSpec.Summary,
		Long:         "Show the artist your key publishes as and the collections you shared on this service.",
		Examples:     meSpec.Examples,
		Related:      meSpec.Related,
		OutputModes:  meSpec.OutputModes,
		GroupID:      "account",
		RequiresAuth: true,
		Run: func(f *rungrad.Factory, cmd *cobra.Command, _ []string) error {
			o, err := origin(f)
			if err != nil {
				return err
			}
			c := m.e.client(f, o, f.Token)
			var me cloud.Me
			if _, err := c.JSON(runContext(cmd), cloud.Request{Method: "GET", Path: "/me", Retry: true}, &me); err != nil {
				return explainKeyFailure(err, f.Credential().Source, "")
			}
			result := meResult{Service: o, Artist: artistInfo{ID: me.Artist.ID, Handle: me.Artist.Handle, Name: me.Artist.Name, URL: me.Artist.URL}, Collections: []collectionInfo{}}
			for _, col := range me.Collections {
				result.Collections = append(result.Collections, collectionInfo{ID: col.ID, Title: col.Title, URL: col.URL, ShortURL: col.ShortURL, Visibility: col.Visibility})
			}
			return f.WriteResult(result, func(w io.Writer) {
				fmt.Fprintf(w, "%s (@%s) on %s\n%s\n", result.Artist.Name, result.Artist.Handle, o, result.Artist.URL)
				rows := make([][]string, 0, len(result.Collections))
				for _, col := range result.Collections {
					rows = append(rows, []string{col.Title, col.Visibility, col.URL})
				}
				output.RenderTable(w, output.Table{Columns: []string{"Collection", "Visibility", "Link"}, Rows: rows, Empty: "No collections shared yet."})
			})
		},
	}
}

// --- login --------------------------------------------------------------------

type deviceStart struct {
	Service                 string `json:"service"`
	UserCode                string `json:"userCode"`
	VerificationURI         string `json:"verificationUri"`
	VerificationURIComplete string `json:"verificationUriComplete,omitempty"`
	ExpiresAt               string `json:"expiresAt"`
	Interval                int    `json:"interval"`
}

type loginResult struct {
	Service     string        `json:"service"`
	Kind        string        `json:"kind"`
	Artist      *artistInfo   `json:"artist,omitempty"`
	Replaced    string        `json:"replaced,omitempty"`
	FormerGuest *store.Former `json:"formerGuest,omitempty"`
}

func (m accountModule) login() *rungrad.Command {
	return &rungrad.Command{
		Use:   "login",
		Short: loginSpec.Summary,
		Long: `Connect your Soundroo account to this computer with a device code.
login prints a link and a code; open the link in any browser, sign in and
approve the code. This tool never opens a browser itself.

--start asks for a code, prints it and exits, so an agent can show the link.
--wait finishes a started login, waiting until you approve it or the code
expires. Without either flag, login does both.

The account key replaces a stored guest key for this service. The guest's
claim link is kept so you can still move that music into your account.`,
		Examples:    loginSpec.Examples,
		Related:     loginSpec.Related,
		OutputModes: loginSpec.OutputModes,
		GroupID:     "account",
		Mutates:     true,
		Configure: func(cmd *cobra.Command) {
			cmd.Flags().Bool("start", false, "Request a device code, print it and exit")
			cmd.Flags().Bool("wait", false, "Finish a login started with --start")
			cmd.Flags().Bool("force", false, "Replace a stored account key without asking")
			cmd.Flags().Duration("timeout", 15*time.Minute, "Longest time to wait for approval")
			cmd.MarkFlagsMutuallyExclusive("start", "wait")
		},
		Run: m.runLogin,
	}
}

func (m accountModule) runLogin(f *rungrad.Factory, cmd *cobra.Command, _ []string) error {
	o, err := origin(f)
	if err != nil {
		return err
	}
	start, _ := cmd.Flags().GetBool("start")
	wait, _ := cmd.Flags().GetBool("wait")
	force, _ := cmd.Flags().GetBool("force")
	timeout, _ := cmd.Flags().GetDuration("timeout")
	st := m.e.store(f, o)
	if f.DryRun() {
		if wait {
			return f.WritePreview(output.DryRunPreview{Method: "POST", Path: "/api/v1/device/token", Body: []output.Field{{Name: "service", Value: o}, {Name: "device_code", Value: "stored", Secret: true}}})
		}
		return f.WritePreview(output.DryRunPreview{Method: "POST", Path: "/api/v1/device/code", Body: []output.Field{{Name: "service", Value: o}, {Name: "name", Value: m.e.hostname()}}})
	}
	if f.Flags.JSON && !start && !wait {
		return &cloud.Error{Code: "usage", Exit: cloud.ExitUsage, Message: "With --json, run login --start to get the link and code, then login --wait to finish."}
	}
	if account, ok, _ := st.Account(); ok && account.Kind == store.KindAccount && !force && !wait {
		if !f.CanPrompt() {
			return &cloud.Error{Code: "already_logged_in", Exit: cloud.ExitUsage, Message: fmt.Sprintf("This computer already has an account key for %s (@%s).", o, account.Artist.Handle), Hint: "Use --force to replace it."}
		}
		ok, err := f.Chooser().Confirm(fmt.Sprintf("You are already logged in to %s as @%s.", o, account.Artist.Handle), "Log in again and replace the key", "Keep the current login")
		if err != nil || !ok {
			return &cloud.Error{Code: "login_cancelled", Exit: cloud.ExitUsage, Message: "Kept the current login."}
		}
	}
	c := m.e.client(f, o, "")
	if !wait {
		device, err := m.e.requestDeviceCode(cmd, c, o)
		if err != nil {
			return err
		}
		f.RegisterSecret(device.DeviceCode)
		if err := st.SavePendingLogin(device); err != nil {
			return &cloud.Error{Code: "credentials_unwritable", Exit: cloud.ExitAPI, Message: "Could not remember the started login: " + err.Error()}
		}
		shown := deviceStart{Service: o, UserCode: device.UserCode, VerificationURI: device.VerificationURI, VerificationURIComplete: device.VerificationURIComplete, ExpiresAt: device.ExpiresAt, Interval: device.Interval}
		if start {
			return f.WriteResult(shown, func(w io.Writer) {
				fmt.Fprintf(w, "Open %s and approve code %s.\nThen run login --wait. The code expires at %s.\n", linkFor(shown), shown.UserCode, shown.ExpiresAt)
			})
		}
		fmt.Fprintf(f.Stderr, "Open %s in a browser, sign in and approve code %s.\nWaiting for approval (Ctrl+C to stop; run login --wait later to continue)...\n", linkFor(shown), shown.UserCode)
	}
	pending, ok, err := st.PendingLogin()
	if err != nil {
		return keyError(o, err)
	}
	if !ok {
		return &cloud.Error{Code: "no_pending_login", Exit: cloud.ExitUsage, Message: "No login is waiting for approval on this computer.", Hint: "Run login --start first."}
	}
	f.RegisterSecret(pending.DeviceCode)
	token, approved, err := m.e.pollDeviceToken(cmd, c, pending, timeout)
	if err != nil {
		var apiErr *cloud.Error
		if errors.As(err, &apiErr) && (apiErr.Code == "device_login_denied" || apiErr.Code == "device_login_expired") {
			_ = st.ClearPendingLogin()
		}
		return err
	}
	f.RegisterSecret(token)
	c.Token = token
	// The approved code is spent: keep the key even if reading the artist fails.
	artist := approved
	if artist.Handle == "" {
		var me cloud.Me
		if _, err := c.JSON(runContext(cmd), cloud.Request{Method: "GET", Path: "/me", Retry: true}, &me); err == nil {
			artist = me.Artist
		}
	}
	result := loginResult{Service: o, Kind: store.KindAccount, Artist: &artistInfo{ID: artist.ID, Handle: artist.Handle, Name: artist.Name, URL: artist.URL}}
	account := store.Account{Kind: store.KindAccount, Artist: storeArtist(artist)}
	if previous, ok, _ := st.Account(); ok {
		result.Replaced = previous.Kind
		switch {
		case previous.Kind == store.KindGuest && previous.Artist.Handle != artist.Handle:
			account.FormerGuest = &store.Former{Artist: previous.Artist, ClaimURL: previous.ClaimURL}
		case previous.FormerGuest != nil:
			account.FormerGuest = previous.FormerGuest
		}
	}
	result.FormerGuest = account.FormerGuest
	if err := st.Save(token, account); err != nil {
		return &cloud.Error{Code: "credentials_unwritable", Exit: cloud.ExitAPI, Message: "Login worked but the key could not be stored: " + err.Error()}
	}
	_ = st.ClearPendingLogin()
	return f.WriteResult(result, func(w io.Writer) {
		if artist.Handle != "" {
			fmt.Fprintf(w, "Logged in to %s as %s (@%s).\n", o, artist.Name, artist.Handle)
		} else {
			fmt.Fprintf(w, "Logged in to %s.\n", o)
		}
		if g := result.FormerGuest; g != nil && g.ClaimURL != "" {
			fmt.Fprintf(w, "Music you shared as the guest @%s stays there until you open its claim link while signed in:\n  %s\n", g.Artist.Handle, g.ClaimURL)
		}
	})
}

func linkFor(d deviceStart) string {
	if d.VerificationURIComplete != "" {
		return d.VerificationURIComplete
	}
	return d.VerificationURI
}

// field reads the first present string among names.
func field(m map[string]any, names ...string) string {
	for _, name := range names {
		if v, ok := m[name].(string); ok && v != "" {
			return v
		}
	}
	return ""
}

func number(m map[string]any, names ...string) int {
	for _, name := range names {
		switch v := m[name].(type) {
		case json.Number:
			if n, err := v.Int64(); err == nil {
				return int(n)
			}
		case float64:
			return int(v)
		}
	}
	return 0
}

func (e *env) requestDeviceCode(cmd *cobra.Command, c *cloud.Client, o string) (store.PendingLogin, error) {
	body, _ := json.Marshal(map[string]any{"name": e.hostname(), "client": map[string]string{"name": Name, "version": Version}})
	var raw map[string]any
	_, err := c.JSON(runContext(cmd), cloud.Request{Method: "POST", Path: "/device/code", Body: body, Anonymous: true}, &raw)
	if err != nil {
		var apiErr *cloud.Error
		if errors.As(err, &apiErr) && (apiErr.Status == 404 || apiErr.Status == 405) {
			return store.PendingLogin{}, &cloud.Error{Code: "device_login_unavailable", Exit: cloud.ExitAPI, Status: apiErr.Status, Message: fmt.Sprintf("%s does not offer device login yet.", o), Hint: "Share without logging in: the first share creates a guest artist and a claim link that connects the music to your account."}
		}
		return store.PendingLogin{}, err
	}
	p := store.PendingLogin{
		DeviceCode:              field(raw, "device_code", "deviceCode"),
		UserCode:                field(raw, "user_code", "userCode"),
		VerificationURI:         field(raw, "verification_uri", "verificationUri", "verification_url", "verificationUrl"),
		VerificationURIComplete: field(raw, "verification_uri_complete", "verificationUriComplete"),
		Interval:                number(raw, "interval"),
	}
	expiresIn := number(raw, "expires_in", "expiresIn")
	switch {
	case p.DeviceCode == "" || p.UserCode == "" || p.VerificationURI == "":
		return p, &cloud.Error{Code: "bad_response", Exit: cloud.ExitAPI, Message: "The service's device login answer is incomplete."}
	case len(p.UserCode) > 32 || strings.IndexFunc(p.UserCode, unicode.IsControl) >= 0:
		return p, &cloud.Error{Code: "bad_response", Exit: cloud.ExitAPI, Message: "The service sent an unusable login code."}
	case !cloud.SameOrigin(o, p.VerificationURI) || (p.VerificationURIComplete != "" && !cloud.SameOrigin(o, p.VerificationURIComplete)):
		return p, &cloud.Error{Code: "bad_response", Exit: cloud.ExitAPI, Message: "The service asked to approve the login on another website; refusing."}
	}
	if expiresIn <= 0 || expiresIn > 3600 {
		expiresIn = 900
	}
	if p.Interval < 1 || p.Interval > 60 {
		p.Interval = 5
	}
	p.ExpiresAt = e.now().Add(time.Duration(expiresIn) * time.Second).Format(time.RFC3339)
	return p, nil
}

// pollDeviceToken waits for approval and returns the key and, when the service
// includes it, the artist it belongs to.
func (e *env) pollDeviceToken(cmd *cobra.Command, c *cloud.Client, p store.PendingLogin, timeout time.Duration) (string, cloud.Artist, error) {
	var none cloud.Artist
	expires, err := time.Parse(time.RFC3339, p.ExpiresAt)
	if err != nil {
		return "", none, &cloud.Error{Code: "device_login_expired", Exit: cloud.ExitAuth, Message: "The started login is unreadable; start again with login."}
	}
	deadline := e.now().Add(timeout)
	if expires.Before(deadline) {
		deadline = expires
	}
	interval := time.Duration(p.Interval) * time.Second
	// The Soundroo service reads deviceCode; device_code keeps RFC 8628 servers working.
	body, _ := json.Marshal(map[string]string{"deviceCode": p.DeviceCode, "device_code": p.DeviceCode, "grant_type": "urn:ietf:params:oauth:grant-type:device_code"})
	for {
		if !e.now().Before(deadline) {
			if !e.now().Before(expires) {
				return "", none, &cloud.Error{Code: "device_login_expired", Exit: cloud.ExitAuth, Message: "The login code expired before it was approved.", Hint: "Run login again."}
			}
			return "", none, &cloud.Error{Code: "device_login_pending", Exit: cloud.ExitAuth, Message: "The login is still waiting for approval.", Hint: "Approve it in the browser, then run login --wait."}
		}
		var raw map[string]json.RawMessage
		_, err := c.JSON(runContext(cmd), cloud.Request{Method: "POST", Path: "/device/token", Body: body, Anonymous: true}, &raw)
		if err == nil {
			token := ""
			for _, name := range []string{"access_token", "accessToken", "token"} {
				if json.Unmarshal(raw[name], &token) == nil && token != "" {
					break
				}
			}
			if token == "" || strings.IndexFunc(token, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }) >= 0 {
				return "", none, &cloud.Error{Code: "bad_response", Exit: cloud.ExitAPI, Message: "The service approved the login but sent no usable key."}
			}
			var artist cloud.Artist
			_ = json.Unmarshal(raw["artist"], &artist)
			return token, artist, nil
		}
		var apiErr *cloud.Error
		if !errors.As(err, &apiErr) {
			return "", none, err
		}
		code := apiErr.ServiceCode
		if code == "" {
			code = apiErr.Code
		}
		switch code {
		case "authorization_pending":
		case "slow_down":
			interval += 5 * time.Second
			if interval > 60*time.Second {
				interval = 60 * time.Second
			}
		case "access_denied":
			return "", none, &cloud.Error{Code: "device_login_denied", Exit: cloud.ExitForbidden, Message: "The login was declined in the browser."}
		case "expired_token":
			return "", none, &cloud.Error{Code: "device_login_expired", Exit: cloud.ExitAuth, Message: "The login code expired before it was approved.", Hint: "Run login again."}
		case "invalid_grant":
			return "", none, &cloud.Error{Code: "device_login_expired", Exit: cloud.ExitAuth, Message: "The service no longer knows this login code; it may have been used already.", Hint: "Run login again."}
		default:
			if apiErr.Status == 404 || apiErr.Status == 405 {
				return "", none, &cloud.Error{Code: "device_login_unavailable", Exit: cloud.ExitAPI, Status: apiErr.Status, Message: "This service does not offer device login yet."}
			}
			return "", none, apiErr
		}
		if apiErr.RetryAfter > 0 && time.Duration(apiErr.RetryAfter)*time.Second > interval {
			interval = time.Duration(apiErr.RetryAfter) * time.Second
		}
		if err := e.sleep(runContext(cmd), interval); err != nil {
			return "", none, &cloud.Error{Code: "device_login_pending", Exit: cloud.ExitAuth, Message: "Stopped waiting for approval.", Hint: "Run login --wait to continue."}
		}
	}
}

// --- claim link -----------------------------------------------------------------

type claimResult struct {
	Service   string `json:"service"`
	ClaimURL  string `json:"claimUrl"`
	ExpiresAt string `json:"expiresAt,omitempty"`
}

func (m accountModule) claimLink() *rungrad.Command {
	return &rungrad.Command{
		Use:   "claim-link",
		Short: claimLinkSpec.Summary,
		Long: `Ask the service for a new link that claims the guest artist page your key
publishes as. Open it in a browser and sign in to keep the music and list it
publicly. Each link works once and expires after 30 days. Keep it private.`,
		Examples:       claimLinkSpec.Examples,
		Related:        claimLinkSpec.Related,
		OutputModes:    claimLinkSpec.OutputModes,
		GroupID:        "account",
		RequiresAuth:   true,
		AuthResolution: rungrad.AuthResolutionHandler,
		Mutates:        true,
		Run: func(f *rungrad.Factory, cmd *cobra.Command, _ []string) error {
			o, err := origin(f)
			if err != nil {
				return err
			}
			if f.DryRun() {
				return f.WritePreview(output.DryRunPreview{Method: "POST", Path: "/api/v1/claim-links", Body: []output.Field{{Name: "service", Value: o}}})
			}
			token, source, err := m.e.requireKey(f, o)
			if err != nil {
				return err
			}
			st := m.e.store(f, o)
			c := m.e.client(f, o, token)
			var answer struct {
				ClaimURL  string `json:"claimUrl"`
				ExpiresAt string `json:"expiresAt"`
			}
			if _, err := c.JSON(runContext(cmd), cloud.Request{Method: "POST", Path: "/claim-links", Body: []byte("{}")}, &answer); err != nil {
				var apiErr *cloud.Error
				if errors.As(err, &apiErr) && (apiErr.ServiceCode == "already_claimed" || apiErr.Status == 409) {
					if source == store.SourceFile {
						_ = st.UpdateAccount(func(a *store.Account) { a.ClaimURL, a.Claimed = "", true })
					}
					apiErr.Code, apiErr.Message, apiErr.Hint = "already_claimed", "This artist page is already claimed.", "Run login to manage the music with your account."
				}
				return explainKeyFailure(err, source, "")
			}
			if !cloud.SameOrigin(o, answer.ClaimURL) {
				return &cloud.Error{Code: "bad_response", Exit: cloud.ExitAPI, Message: "The service sent an unusable claim link."}
			}
			if source == store.SourceFile {
				_ = st.UpdateAccount(func(a *store.Account) {
					if a.Kind == store.KindGuest {
						a.ClaimURL, a.Claimed = answer.ClaimURL, false
					}
				})
			}
			result := claimResult{Service: o, ClaimURL: answer.ClaimURL, ExpiresAt: answer.ExpiresAt}
			return f.WriteResult(result, func(w io.Writer) {
				fmt.Fprintf(w, "Open this link and sign in to claim your artist page (keep it private):\n  %s\n", result.ClaimURL)
			})
		},
	}
}

// --- logout -------------------------------------------------------------------

type logoutResult struct {
	Service      string `json:"service"`
	Removed      bool   `json:"removed"`
	Revoked      bool   `json:"revoked"`
	Revocation   string `json:"revocation"`
	GuestClaim   string `json:"guestClaimUrl,omitempty"`
	EnvKeyActive bool   `json:"envKeyActive,omitempty"`
}

func (m accountModule) logout() *rungrad.Command {
	return &rungrad.Command{
		Use:   "logout",
		Short: logoutSpec.Summary,
		Long: `Revoke the key stored for this service and remove it from this computer.
Other services' keys stay untouched. The service revokes the key it receives,
so nothing else in your account changes. When the key belongs to an unclaimed
guest artist, the output repeats its claim link one last time.

--local-only removes the stored key without contacting the service, for keys
that no longer work or services you cannot reach. A key in ` + TokenEnv + ` is not
stored by this tool; unset the variable yourself.`,
		Examples:    logoutSpec.Examples,
		Related:     logoutSpec.Related,
		OutputModes: logoutSpec.OutputModes,
		GroupID:     "account",
		Mutates:     true,
		Destructive: true,
		Configure: func(cmd *cobra.Command) {
			cmd.Flags().Bool("confirm", false, "Confirm removing the key without a prompt")
			cmd.Flags().Bool("local-only", false, "Remove the stored key without asking the service to revoke it")
		},
		Run: func(f *rungrad.Factory, cmd *cobra.Command, _ []string) error {
			o, err := origin(f)
			if err != nil {
				return err
			}
			localOnly, _ := cmd.Flags().GetBool("local-only")
			preview := output.DryRunPreview{Method: "DELETE", Path: "/api/v1/auth/token", Body: []output.Field{{Name: "service", Value: o}, {Name: "local key", Value: "removed for this service only"}}}
			if localOnly {
				preview = output.DryRunPreview{Method: "LOCAL", Path: "remove the stored key", Body: []output.Field{{Name: "service", Value: o}}}
			}
			if f.DryRun() {
				return f.WritePreview(preview)
			}
			confirmed, _ := cmd.Flags().GetBool("confirm")
			if err := f.ConfirmDestructive(rungrad.ConfirmOptions{Action: "log out of", Target: o, Confirmed: confirmed}); err != nil {
				return err
			}
			st := m.e.store(f, o)
			result := logoutResult{Service: o, Revocation: "skipped"}
			if value, ok := lookupEnv(f, TokenEnv); ok && value != "" {
				f.RegisterSecret(value)
				result.EnvKeyActive = true
			}
			stored, err := st.StoredKey()
			if errors.Is(err, store.ErrNoKey) {
				result.Revocation = "none"
				_, _ = st.Remove()
				return f.WriteResult(result, func(w io.Writer) { renderLogout(w, result) })
			}
			if err != nil {
				return keyError(o, err)
			}
			f.RegisterSecret(stored.Token)
			account, _, _ := st.Account()
			if !localOnly {
				c := m.e.client(f, o, stored.Token)
				_, rerr := c.Do(runContext(cmd), cloud.Request{Method: "DELETE", Path: "/auth/token"})
				var apiErr *cloud.Error
				switch {
				case rerr == nil:
					result.Revoked, result.Revocation = true, "revoked"
				case errors.As(rerr, &apiErr) && apiErr.Exit == cloud.ExitAuth:
					result.Revocation = "already-invalid"
				case errors.As(rerr, &apiErr) && (apiErr.Status == 404 || apiErr.Status == 405):
					result.Revocation = "unsupported"
				default:
					if apiErr != nil {
						apiErr.Hint = "The key is still stored. Try again, or use --local-only to remove it from this computer anyway."
					}
					return rerr
				}
			}
			removed, err := st.Remove()
			if err != nil {
				return &cloud.Error{Code: "credentials_unwritable", Exit: cloud.ExitAPI, Message: "Could not remove the stored key: " + err.Error()}
			}
			result.Removed = removed
			if account.Kind == store.KindGuest {
				result.GuestClaim = account.ClaimURL
			}
			return f.WriteResult(result, func(w io.Writer) { renderLogout(w, result) })
		},
	}
}

func renderLogout(w io.Writer, r logoutResult) {
	switch r.Revocation {
	case "none":
		fmt.Fprintf(w, "No key is stored for %s.\n", r.Service)
	case "revoked":
		fmt.Fprintf(w, "Revoked the key and removed it from this computer for %s.\n", r.Service)
	case "already-invalid":
		fmt.Fprintf(w, "The service no longer accepted the key; removed it from this computer for %s.\n", r.Service)
	case "unsupported":
		fmt.Fprintf(w, "Removed the key from this computer for %s. This service cannot revoke keys from the command line; revoke it in your account settings if needed.\n", r.Service)
	default:
		fmt.Fprintf(w, "Removed the key from this computer for %s without contacting the service.\n", r.Service)
	}
	if r.GuestClaim != "" {
		fmt.Fprintf(w, "To keep the music of that guest artist, open its claim link while signed in to your Soundroo account.\nSave it now: this computer no longer keeps it, and it is private:\n  %s\n", r.GuestClaim)
	}
	if r.EnvKeyActive {
		fmt.Fprintf(w, "%s is still set in your environment; unset it to stop using that key.\n", TokenEnv)
	}
}

func lookupEnv(f *rungrad.Factory, name string) (string, bool) {
	if f.LookupEnv != nil {
		return f.LookupEnv(name)
	}
	return os.LookupEnv(name)
}
