package commands

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/vincentsch/rungrad/conformance"
)

// TestConformsToRungradSpec builds the real binary, points its default service
// at a fake Laravel service and scores it with rungrad's own conformance
// runner, as rungrad scores its reference CLI.
func TestConformsToRungradSpec(t *testing.T) {
	if testing.Short() {
		t.Skip("builds the binary")
	}
	svc := newFakeService(t)
	// The scorer injects this sentinel as SOUNDROO_TOKEN for the secret probe.
	svc.addToken("SENTINEL-SECRET-do-not-print-7Q2", "mara", "active", "publish", "manage")
	bin := filepath.Join(t.TempDir(), "soundroo-cloud")
	if runtime.GOOS == "windows" {
		bin += ".exe"
	}
	build := exec.Command("go", "build", "-o", bin, "-ldflags", "-X github.com/vincentsch/soundroo/cloud-cli/internal/cloud.DefaultService="+svc.URL(), "../..")
	build.Env = append(os.Environ(), "GOFLAGS=-mod=readonly", "GOPROXY=off", "CGO_ENABLED=0")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, out)
	}
	payload := writePayload(t, samplePayload)
	rules, err := conformance.DefaultRuleset()
	if err != nil {
		t.Fatal(err)
	}
	runner, err := conformance.NewRunner(conformance.Target{
		Path:        bin,
		Read:        []string{"auth", "status"},
		Mutate:      []string{"publish", "--payload", payload, "--rights-accepted"},
		Auth:        []string{"me"},
		NotFound:    []string{"track", "show", "GHOST000000000000000000001"},
		APIError:    []string{"track", "show", "BROKEN00000000000000000001"},
		Forbidden:   []string{"track", "show", "FORBIDDEN00000000000000001"},
		RateLimited: []string{"track", "show", "THROTTLED00000000000000001"},
		Destructive: []string{"track", "delete", "01JABCDEFGHJKMNPQRSTVWXYZ0"},
		Secret:      []string{"me"},
		SecretEnv:   TokenEnv,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer runner.Close()
	if err := runner.DiscoverManifest(); err != nil {
		t.Fatal(err)
	}
	score := runner.Score(rules)
	t.Log("\n" + score.Report())
	if score.Manifest.Status != conformance.ManifestPresent {
		t.Fatalf("manifest status %q", score.Manifest.Status)
	}
	if fails := score.RequiredFailures(); len(fails) > 0 {
		t.Fatalf("required rules failed: %v", fails)
	}
	for _, r := range score.Rules {
		if r.Result == conformance.ResultFail {
			t.Errorf("FAIL %s: %s", r.ID, r.Reason)
		}
	}
	if svc.count("DELETE", "/api/v1/tracks/01JABCDEFGHJKMNPQRSTVWXYZ0") != 0 || svc.count("POST", "/api/v1/releases") != 0 || svc.count("POST", "/api/v1/guest-keys") != 0 {
		t.Fatalf("scoring changed the service: %+v", svc.calls())
	}
}
