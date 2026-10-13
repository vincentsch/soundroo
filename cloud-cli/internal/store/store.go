// Package store keeps Soundroo keys per service origin. Keys live in rungrad's
// owner-only credentials file, one entry per origin, so a key made for a
// development server is never sent to soundroo.com and the other way round.
// Non-key account facts (artist, guest claim link, a pending device login) live
// in accounts.json beside it, also owner-only.
package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/vincentsch/rungrad/config"
)

// Kinds of stored keys.
const (
	KindGuest   = "guest"
	KindAccount = "account"
)

// Artist is the public identity a key publishes as.
type Artist struct {
	ID     string `json:"id,omitempty"`
	Handle string `json:"handle,omitempty"`
	Name   string `json:"name,omitempty"`
	URL    string `json:"url,omitempty"`
}

// Account describes the key stored for one origin. ClaimURL is sensitive:
// whoever opens it can claim the guest artist page.
type Account struct {
	Kind        string  `json:"kind"`
	Artist      Artist  `json:"artist"`
	ClaimURL    string  `json:"claimUrl,omitempty"`
	Claimed     bool    `json:"claimed,omitempty"`
	FormerGuest *Former `json:"formerGuest,omitempty"`
	CreatedAt   string  `json:"createdAt,omitempty"`
}

// Former remembers a guest page after logging in with an account key, so its
// claim link can still move that music into the account.
type Former struct {
	Artist   Artist `json:"artist"`
	ClaimURL string `json:"claimUrl,omitempty"`
}

// PendingLogin is a started device login. DeviceCode is secret.
type PendingLogin struct {
	DeviceCode              string `json:"deviceCode"`
	UserCode                string `json:"userCode"`
	VerificationURI         string `json:"verificationUri"`
	VerificationURIComplete string `json:"verificationUriComplete,omitempty"`
	ExpiresAt               string `json:"expiresAt"`
	Interval                int    `json:"interval"`
}

type sidecar struct {
	Version       int                     `json:"version"`
	Accounts      map[string]Account      `json:"accounts"`
	PendingLogins map[string]PendingLogin `json:"pendingLogins"`
}

type credentialsFile struct {
	Version int                          `json:"version"`
	Entries map[string]config.Credential `json:"entries"`
}

// Store is the key store for one origin.
type Store struct {
	Config    config.Store
	Origin    string
	EnvVar    string
	LookupEnv func(string) (string, bool)
	Now       func() time.Time
}

// Source labels.
const (
	SourceEnv  = "env"
	SourceFile = "file"
	SourceNone = "none"
)

// ErrNoKey means no key exists for the origin.
var ErrNoKey = config.ErrMissingCredential

func (s Store) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

func (s Store) lookup(name string) (string, bool) {
	if s.LookupEnv != nil {
		return s.LookupEnv(name)
	}
	return os.LookupEnv(name)
}

// Key returns the key to use: the environment variable first, then the stored
// key for this origin.
func (s Store) Key() (token, source string, err error) {
	if s.EnvVar != "" {
		if value, ok := s.lookup(s.EnvVar); ok && value != "" {
			return value, SourceEnv, nil
		}
	}
	cred, err := s.Config.LoadCredential(s.Origin)
	if err != nil {
		return "", SourceNone, err
	}
	if cred.Token == "" {
		return "", SourceNone, ErrNoKey
	}
	return cred.Token, SourceFile, nil
}

// StoredKey returns only the stored key, ignoring the environment.
func (s Store) StoredKey() (config.Credential, error) {
	return s.Config.LoadCredential(s.Origin)
}

// Save stores a key and its account facts for this origin.
func (s Store) Save(token string, account Account) error {
	if account.CreatedAt == "" {
		account.CreatedAt = s.now().Format(time.RFC3339)
	}
	display := account.Artist.Handle
	if display != "" {
		display = "@" + display
	}
	if err := s.Config.SaveCredential(s.Origin, config.Credential{Token: token, DisplayName: display, ValidatedAt: s.now().Format(time.RFC3339)}); err != nil {
		return fmt.Errorf("save the Soundroo key: %w", err)
	}
	return s.updateSidecar(func(sc *sidecar) { sc.Accounts[s.Origin] = account })
}

// Account returns the stored account facts for this origin.
func (s Store) Account() (Account, bool, error) {
	sc, err := s.readSidecar()
	if err != nil {
		return Account{}, false, err
	}
	account, ok := sc.Accounts[s.Origin]
	return account, ok, nil
}

// UpdateAccount changes stored account facts when an account exists.
func (s Store) UpdateAccount(change func(*Account)) error {
	return s.updateSidecar(func(sc *sidecar) {
		if account, ok := sc.Accounts[s.Origin]; ok {
			change(&account)
			sc.Accounts[s.Origin] = account
		}
	})
}

// Remove deletes the stored key and account facts for this origin only.
func (s Store) Remove() (bool, error) {
	path, err := s.Config.CredentialsPath()
	if err != nil {
		return false, err
	}
	removed := false
	data, err := os.ReadFile(path)
	switch {
	case errors.Is(err, os.ErrNotExist):
	case err != nil:
		return false, err
	default:
		var file credentialsFile
		if err := json.Unmarshal(data, &file); err != nil {
			return false, fmt.Errorf("the credentials file %s is not valid JSON", path)
		}
		if _, ok := file.Entries[s.Origin]; ok {
			delete(file.Entries, s.Origin)
			removed = true
			if file.Version == 0 {
				file.Version = 1
			}
			encoded, err := json.MarshalIndent(file, "", "  ")
			if err != nil {
				return false, err
			}
			if err := writeAtomic(path, encoded); err != nil {
				return false, err
			}
		}
	}
	err = s.updateSidecar(func(sc *sidecar) {
		if _, ok := sc.Accounts[s.Origin]; ok {
			removed = true
		}
		delete(sc.Accounts, s.Origin)
		delete(sc.PendingLogins, s.Origin)
	})
	return removed, err
}

// SavePendingLogin records a started device login for this origin.
func (s Store) SavePendingLogin(p PendingLogin) error {
	return s.updateSidecar(func(sc *sidecar) { sc.PendingLogins[s.Origin] = p })
}

// PendingLogin returns the started device login for this origin.
func (s Store) PendingLogin() (PendingLogin, bool, error) {
	sc, err := s.readSidecar()
	if err != nil {
		return PendingLogin{}, false, err
	}
	p, ok := sc.PendingLogins[s.Origin]
	return p, ok, nil
}

// ClearPendingLogin forgets the device login for this origin.
func (s Store) ClearPendingLogin() error {
	return s.updateSidecar(func(sc *sidecar) { delete(sc.PendingLogins, s.Origin) })
}

// SidecarPath is accounts.json beside the credentials file.
func (s Store) SidecarPath() (string, error) {
	path, err := s.Config.CredentialsPath()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(path), "accounts.json"), nil
}

func (s Store) readSidecar() (sidecar, error) {
	sc := sidecar{Version: 1, Accounts: map[string]Account{}, PendingLogins: map[string]PendingLogin{}}
	path, err := s.SidecarPath()
	if err != nil {
		return sc, err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return sc, nil
	}
	if err != nil {
		return sc, err
	}
	if err := json.Unmarshal(data, &sc); err != nil {
		return sc, fmt.Errorf("%s is not valid JSON; remove it to start again", path)
	}
	if sc.Accounts == nil {
		sc.Accounts = map[string]Account{}
	}
	if sc.PendingLogins == nil {
		sc.PendingLogins = map[string]PendingLogin{}
	}
	return sc, nil
}

func (s Store) updateSidecar(change func(*sidecar)) error {
	sc, err := s.readSidecar()
	if err != nil {
		return err
	}
	change(&sc)
	path, err := s.SidecarPath()
	if err != nil {
		return err
	}
	if len(sc.Accounts) == 0 && len(sc.PendingLogins) == 0 {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	sc.Version = 1
	data, err := json.MarshalIndent(sc, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomic(path, data)
}

// writeAtomic writes an owner-only file through a temporary file and rename.
func writeAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(append(data, '\n')); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}
