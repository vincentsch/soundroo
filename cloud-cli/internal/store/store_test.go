package store

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/vincentsch/rungrad/config"
)

func newStore(t *testing.T, origin string, env map[string]string) Store {
	t.Helper()
	dir := t.TempDir()
	return Store{
		Config:    config.Store{Tool: "soundroo-cloud", Override: filepath.Join(dir, "config.yaml")},
		Origin:    origin,
		EnvVar:    "SOUNDROO_TOKEN",
		LookupEnv: func(name string) (string, bool) { v, ok := env[name]; return v, ok },
	}
}

func TestKeysArePerOriginAndOwnerOnly(t *testing.T) {
	prod := newStore(t, "https://soundroo.com", nil)
	dev := prod
	dev.Origin = "http://127.0.0.1:8350"
	if _, _, err := prod.Key(); !errors.Is(err, ErrNoKey) {
		t.Fatalf("empty store: %v", err)
	}
	if err := prod.Save("1|prodkey000000", Account{Kind: KindGuest, Artist: Artist{Handle: "amber"}, ClaimURL: "https://soundroo.com/claim/abc"}); err != nil {
		t.Fatal(err)
	}
	if err := dev.Save("2|devkey0000000", Account{Kind: KindAccount, Artist: Artist{Handle: "mara"}}); err != nil {
		t.Fatal(err)
	}
	if token, source, err := prod.Key(); err != nil || token != "1|prodkey000000" || source != SourceFile {
		t.Fatalf("prod key: %q %q %v", token, source, err)
	}
	if token, _, _ := dev.Key(); token != "2|devkey0000000" {
		t.Fatalf("dev key: %q", token)
	}
	account, ok, err := prod.Account()
	if err != nil || !ok || account.ClaimURL != "https://soundroo.com/claim/abc" || account.CreatedAt == "" {
		t.Fatalf("account: %+v %v", account, err)
	}
	if runtime.GOOS != "windows" {
		for _, path := range []string{mustPath(prod.Config.CredentialsPath()), mustPath(prod.SidecarPath())} {
			info, err := os.Stat(path)
			if err != nil || info.Mode().Perm() != 0o600 {
				t.Fatalf("%s: %v %v", path, info, err)
			}
		}
	}
	removed, err := dev.Remove()
	if err != nil || !removed {
		t.Fatalf("remove: %v %v", removed, err)
	}
	if _, _, err := dev.Key(); !errors.Is(err, ErrNoKey) {
		t.Fatal("dev key survived removal")
	}
	if token, _, _ := prod.Key(); token != "1|prodkey000000" {
		t.Fatal("removing one origin touched another")
	}
	if removed, _ := dev.Remove(); removed {
		t.Fatal("second remove reported a removal")
	}
}

func TestEnvironmentKeyWinsAndIsNeverStored(t *testing.T) {
	s := newStore(t, "https://soundroo.com", map[string]string{"SOUNDROO_TOKEN": "3|envkey0000000"})
	if token, source, err := s.Key(); err != nil || token != "3|envkey0000000" || source != SourceEnv {
		t.Fatalf("env key: %q %q %v", token, source, err)
	}
	if _, err := s.StoredKey(); !errors.Is(err, ErrNoKey) {
		t.Fatal("the environment key must not be stored")
	}
}

func TestPendingLoginsAndCorruptFiles(t *testing.T) {
	s := newStore(t, "https://soundroo.com", nil)
	if err := s.SavePendingLogin(PendingLogin{DeviceCode: "secret-device", UserCode: "ABCD-EFGH", VerificationURI: "https://soundroo.com/link", ExpiresAt: "2026-10-13T12:00:00Z", Interval: 5}); err != nil {
		t.Fatal(err)
	}
	p, ok, err := s.PendingLogin()
	if err != nil || !ok || p.DeviceCode != "secret-device" {
		t.Fatalf("pending: %+v %v", p, err)
	}
	if err := s.ClearPendingLogin(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(mustPath(s.SidecarPath())); !os.IsNotExist(err) {
		t.Fatal("an empty accounts file should be removed")
	}
	if err := os.WriteFile(mustPath(s.Config.CredentialsPath()), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Key(); err == nil || errors.Is(err, ErrNoKey) {
		t.Fatalf("corrupt credentials must be an error, got %v", err)
	}
	if _, err := s.Remove(); err == nil {
		t.Fatal("removing from a corrupt file must not overwrite it")
	}
	if data, _ := os.ReadFile(mustPath(s.Config.CredentialsPath())); string(data) != "{not json" {
		t.Fatal("the corrupt credentials file was changed")
	}
}

func mustPath(path string, err error) string {
	if err != nil {
		panic(err)
	}
	return path
}
