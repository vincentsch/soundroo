// Package commands builds the soundroo-cloud command tree on rungrad.
package commands

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	rungrad "github.com/vincentsch/rungrad"
	"github.com/vincentsch/rungrad/output"
	"github.com/vincentsch/soundroo/cloud-cli/internal/cloud"
	"github.com/vincentsch/soundroo/cloud-cli/internal/store"
)

// Version is the soundroo-cloud release. Protocol is the JSON contract the
// Soundroo toolkit relies on; it changes only for incompatible output changes.
var Version = "0.2.1"

const Protocol = 1

// Name is the program name and config directory name.
const Name = "soundroo-cloud"

// TokenEnv carries a key for scripts and CI.
const TokenEnv = "SOUNDROO_TOKEN"

// ServiceEnv selects the service origin.
const ServiceEnv = "SOUNDROO_URL"

// Options injects clocks, waits and transports for tests.
type Options struct {
	Transport http.RoundTripper
	Now       func() time.Time
	Sleep     func(context.Context, time.Duration) error
	Hostname  func() (string, error)
}

type env struct {
	opts Options
}

// NewApp builds the CLI.
func NewApp(opts Options) *rungrad.App {
	e := &env{opts: opts}
	app := rungrad.New(rungrad.AppConfig{
		Name:    Name,
		Short:   "Share Soundroo music on soundroo.com",
		Long:    "soundroo-cloud publishes collections made with the Soundroo toolkit to a Soundroo service, reads their links and manages your keys.\n\nThe toolkit's share command prepares the scores and calls this tool; you rarely need to run it directly. Nothing is sent until you run publish without --dry-run.",
		Version: Version,
		EnvVar:  TokenEnv,
		Resolution: &rungrad.ResolutionConfig{
			Services: []rungrad.Service{{
				Name:      "api",
				Flag:      "service",
				EnvVar:    ServiceEnv,
				ConfigKey: "url",
				Default:   cloud.DefaultService,
				Usage:     "Soundroo service origin, such as https://soundroo.com",
				Validate:  cloud.ValidateServiceValue,
			}},
		},
		Auth:        originResolver{},
		ErrorPolicy: &rungrad.ErrorPolicy{Render: renderError},
	})
	app.Root().Example = "soundroo-cloud auth status\nsoundroo-cloud publish --payload release.json --rights-accepted --dry-run\nsoundroo-cloud release show 01JABCDEFGHJKMNPQRSTVWXYZ0 --wait"
	app.Root().Long += "\n\nRelated commands:\n  soundroo-cloud publish\n  soundroo-cloud auth status"
	app.AddModule(publishModule{e}, accountModule{e}, musicModule{e}, infoModule{e})
	return app
}

// originResolver loads the key for the resolved service origin: SOUNDROO_TOKEN
// first, then the key stored for exactly that origin.
type originResolver struct{}

func (originResolver) ResolveCredential(ac *rungrad.AuthContext) (rungrad.Credential, error) {
	svc, _ := ac.Service("api")
	origin, err := cloud.ParseOrigin(svc.Value)
	if err != nil {
		return rungrad.Credential{}, &cloud.Error{Code: "invalid_service", Exit: cloud.ExitUsage, Message: err.Error()}
	}
	s := store.Store{Config: ac.Store, Origin: origin, EnvVar: ac.EnvVar, LookupEnv: ac.LookupEnv}
	token, source, err := s.Key()
	if err != nil {
		return rungrad.Credential{}, keyError(origin, err)
	}
	ac.RegisterSecret(token)
	return rungrad.Credential{Token: token, Source: source, Profile: origin}, nil
}

func keyError(origin string, err error) error {
	if errors.Is(err, store.ErrNoKey) {
		return &cloud.Error{Code: "auth_required", Exit: cloud.ExitAuth, Message: fmt.Sprintf("No Soundroo key for %s.", origin), Hint: "Share once to create a guest artist, run login to use your account, or set " + TokenEnv + "."}
	}
	return &cloud.Error{Code: "credentials_unreadable", Exit: cloud.ExitUsage, Message: "The stored Soundroo keys could not be read: " + err.Error()}
}

func (e *env) now() time.Time {
	if e.opts.Now != nil {
		return e.opts.Now().UTC()
	}
	return time.Now().UTC()
}

func (e *env) sleep(ctx context.Context, d time.Duration) error {
	if e.opts.Sleep != nil {
		return e.opts.Sleep(ctx, d)
	}
	return cloud.SleepContext(ctx, d)
}

// origin returns the canonical service origin for this run.
func origin(f *rungrad.Factory) (string, error) {
	svc, _ := f.Service("api")
	o, err := cloud.ParseOrigin(svc.Value)
	if err != nil {
		return "", &cloud.Error{Code: "invalid_service", Exit: cloud.ExitUsage, Message: err.Error()}
	}
	return o, nil
}

func (e *env) store(f *rungrad.Factory, origin string) store.Store {
	return store.Store{Config: f.Store, Origin: origin, EnvVar: TokenEnv, LookupEnv: f.LookupEnv, Now: e.opts.Now}
}

func (e *env) client(f *rungrad.Factory, origin, token string) *cloud.Client {
	c := cloud.NewClient(origin, token, Version)
	if e.opts.Transport != nil {
		c.HTTP.Transport = e.opts.Transport
	}
	c.Sleep = e.sleep
	if token != "" {
		f.RegisterSecret(token)
	}
	return c
}

// requireKey loads the key for a handler-owned authenticated command after its
// dry-run preview, so previews never need a key.
func (e *env) requireKey(f *rungrad.Factory, origin string) (string, string, error) {
	token, source, err := e.store(f, origin).Key()
	if err != nil {
		return "", "", keyError(origin, err)
	}
	f.RegisterSecret(token)
	return token, source, nil
}

// optionalKey returns the key for origin when one exists, for reads that show
// more to the owner.
func (e *env) optionalKey(f *rungrad.Factory, origin string) string {
	token, _, err := e.store(f, origin).Key()
	if err != nil {
		return ""
	}
	f.RegisterSecret(token)
	return token
}

func runContext(cmd interface{ Context() context.Context }) context.Context {
	if c := cmd.Context(); c != nil {
		return c
	}
	return context.Background()
}

// renderError writes the stable error contract: a JSON object on stderr in
// machine mode, otherwise "Error:" with issues and a hint. Everything passes
// through rungrad's redaction.
func renderError(ctx rungrad.ErrorContext) error {
	var e *cloud.Error
	known := errors.As(ctx.Err, &e)
	code := "error"
	switch {
	case known:
		code = e.Code
	case ctx.ExitCode == cloud.ExitUsage:
		code = "usage"
	case ctx.ExitCode == cloud.ExitAuth:
		code = "auth_required"
	}
	if ctx.MachineOutput {
		body := map[string]any{"error": ctx.Err.Error(), "exit_code": ctx.ExitCode, "code": code}
		if known {
			for key, value := range e.ErrorDetails().(map[string]any) {
				body[key] = value
			}
		}
		data, err := output.StableJSON(body)
		if err != nil {
			return err
		}
		_, err = ctx.Stderr.Write(ctx.RedactJSON(data))
		return err
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Error: %s\n", ctx.Err.Error())
	if known {
		for _, issue := range e.Issues {
			if issue.Path != "" {
				fmt.Fprintf(&b, "  - %s: %s\n", issue.Path, issue.Message)
			} else {
				fmt.Fprintf(&b, "  - %s\n", issue.Message)
			}
		}
		if e.Hint != "" {
			fmt.Fprintf(&b, "%s\n", e.Hint)
		}
	}
	_, err := ctx.Stderr.Write(ctx.RedactText([]byte(b.String())))
	return err
}

// hostname names this device in login requests.
func (e *env) hostname() string {
	get := e.opts.Hostname
	if get == nil {
		get = os.Hostname
	}
	name, err := get()
	if err != nil || strings.TrimSpace(name) == "" {
		return "Soundroo toolkit"
	}
	if len(name) > 60 {
		name = name[:60]
	}
	return "Soundroo on " + name
}
